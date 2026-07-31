// =============================================================================
// 수파베이스 Edge Function: verify-brn — 고객사 사업자번호 확인
//
// 역할:
//   앱(브라우저)이 보낸 사업자등록번호를 비공개 clients 테이블과 대조하고,
//   일치 여부 + 최소 정보(상호명/대표자명/업태/주소 힌트)만 돌려준다.
//   고객 명단 자체는 절대 브라우저로 내려가지 않는다.
//
// 보안:
//   · clients 테이블은 RLS 전체 잠금 상태 그대로 유지된다.
//   · 이 함수는 수파베이스가 자동 주입하는 service_role 키로 서버 안에서만 조회한다.
//   · 호출 자체는 anon 키(Authorization 헤더)가 있어야 가능하다.
//
// 배포 (프로젝트 루트에서, 최초 1회 supabase CLI 로그인 후):
//   supabase functions deploy verify-brn --project-ref <프로젝트REF>
//   자세한 절차: docs/supabase-setup.md
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { brn } = await req.json().catch(() => ({ brn: '' }));
    const digits = String(brn || '').replace(/[^0-9]/g, '');
    if (digits.length !== 10) {
      return json({ found: false });
    }
    // DB에 하이픈 포함(123-45-67890)으로 저장된 경우까지 함께 대조
    const hyphenated = `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data, error } = await admin
      .from('clients')
      .select('name, biz_type, address, customer_type, client_persons(relation_type, persons(name))')
      .in('biz_reg_no', [digits, hyphenated])
      .limit(5);

    if (error) throw error;

    // 수임 해지(해임)된 거래처는 고객사로 인정하지 않는다
    const match = (data ?? []).find((c: any) => c.customer_type !== '해임') ?? null;
    if (!match) {
      return json({ found: false });
    }

    const links: any[] = match.client_persons ?? [];
    const rep = links.find((cp) => cp.relation_type === '대표자') ?? links[0];
    const repPerson = Array.isArray(rep?.persons) ? rep?.persons[0] : rep?.persons;

    return json({
      found: true,
      companyName: match.name ?? '',
      ceoName: repPerson?.name ?? '',
      bizCategory: match.biz_type ?? '',   // 업태 (통합 스키마에선 biz_type 컬럼이 업태)
      regionHint: match.address ?? '',
    });
  } catch (err) {
    console.error('[verify-brn] 오류:', err);
    return json({ found: false, error: 'internal_error' }, 500);
  }
});
