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
      .select('name, biz_type, biz_item, address, customer_type, client_persons(relation_type, persons(name, birth_date, gender))')
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

    // 대표자 속성은 서버에서 판정해 boolean 만 내려보낸다.
    // 생년월일·성별은 개인정보이므로 브라우저로 절대 내리지 않는다.
    // 값이 없으면 undefined — 앱은 "모른다"로 보고 주의를 표시하지 않는다.
    const youthAge = 39;   // 청년 기준 (중소벤처기업부 만 39세 이하)
    let isYouthOwner: boolean | undefined;
    if (repPerson?.birth_date) {
      const b = new Date(repPerson.birth_date);
      if (!Number.isNaN(b.getTime())) {
        const now = new Date();
        let age = now.getFullYear() - b.getFullYear();
        const m = now.getMonth() - b.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
        isYouthOwner = age <= youthAge;
      }
    }
    const isFemaleOwner = repPerson?.gender ? repPerson.gender === '여' : undefined;

    return json({
      found: true,
      companyName: match.name ?? '',
      ceoName: repPerson?.name ?? '',
      bizCategory: match.biz_type ?? '',   // 업태 (통합 스키마에선 biz_type 컬럼이 업태)
      bizItem: match.biz_item ?? '',       // 종목 — 산업 분야 판정에 함께 쓴다
      regionHint: match.address ?? '',
      isYouthOwner,
      isFemaleOwner,
    });
  } catch (err) {
    console.error('[verify-brn] 오류:', err);
    return json({ found: false, error: 'internal_error' }, 500);
  }
});
