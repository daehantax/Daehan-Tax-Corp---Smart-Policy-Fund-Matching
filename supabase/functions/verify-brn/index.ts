// =============================================================================
// 수파베이스 Edge Function: verify-brn — 고객사 확인 (사업자등록번호 + 대표자 성명)
//
// 역할:
//   앱(브라우저)이 보낸 사업자등록번호와 대표자 성명을 비공개 clients 테이블과 대조하고,
//   일치 여부 + 최소 정보(상호명/업태/종목/주소 힌트)만 돌려준다.
//   고객 명단 자체는 절대 브라우저로 내려가지 않는다.
//
// 왜 2단계인가:
//   사업자등록번호는 공개 정보다(세금계산서·홈페이지 사업자정보·국세청 조회).
//   번호 하나만 관문으로 두면 "이 회사가 대한세무법인 고객사다"라는 거래관계가
//   기계적인 번호 대입으로 새어나간다. 대표자 성명은 고객사라면 당연히 아는 값이라
//   실무 부담 없이 무작위 대입을 사실상 막아준다.
//
// 보안 원칙:
//   · clients 테이블은 RLS 전체 잠금 상태 그대로 유지된다.
//   · 이 함수는 수파베이스가 자동 주입하는 service_role 키로 서버 안에서만 조회한다.
//   · 호출 자체는 anon 키(Authorization 헤더)가 있어야 가능하다.
//   · 번호가 틀렸는지 이름이 틀렸는지 절대 구분해서 알려주지 않는다({ found: false } 하나).
//     구분해 주면 "번호는 맞다"는 사실이 새어나가 고객사 명단 확인 수단이 된다.
//   · 대표자 성명은 입력 대조용으로만 쓰고 응답에 담지 않는다(화면에서 쓰지 않는 개인정보).
//
// 배포 (프로젝트 루트에서, 최초 1회 supabase CLI 로그인 후):
//   supabase functions deploy verify-brn --project-ref <프로젝트REF>
//   호출 제한 테이블(verify_attempts)과 VERIFY_IP_SALT 설정이 함께 필요하다.
//   자세한 절차: docs/supabase-setup.md
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

// 허용 오리진 — 서비스 도메인과 로컬 개발 주소만. 목록에 없으면 CORS 헤더를 주지 않아
// 다른 사이트에 심어놓은 스크립트가 브라우저에서 이 함수를 호출할 수 없다.
//   ※ CORS 는 브라우저에서만 적용된다. curl·서버에서 직접 호출하는 것은 막지 못하므로
//     실질적인 방어선은 아래 호출 제한(RATE_LIMIT)이다. CORS 는 보조 수단이다.
// 환경변수 ALLOWED_ORIGINS(쉼표 구분)로 덮어쓸 수 있다 — 도메인이 바뀌면 재배포 없이 대응.
const DEFAULT_ALLOWED_ORIGINS = [
  'https://fund.daehantax.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const allowList = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : DEFAULT_ALLOWED_ORIGINS;

function corsFor(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',   // 오리진마다 응답이 달라지므로 캐시가 섞이지 않게 한다
  };
  if (allowList.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

// 호출 제한: 같은 IP 로 1분에 5회까지
const RATE_LIMIT_COUNT = 5;
const RATE_LIMIT_WINDOW_SEC = 60;
// 시도 기록 보관 기간 — 이 기간이 지난 행은 함수 실행 중 확률적으로 정리한다
const ATTEMPT_RETENTION_HOURS = 24;
const CLEANUP_PROBABILITY = 0.05;

const YOUTH_AGE = 39;   // 청년 기준 (중소벤처기업부 만 39세 이하)

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsFor(req), 'Content-Type': 'application/json' },
  });
}

/** 이름 비교용 정규화 — 앞뒤 및 문자열 내부 공백을 모두 제거 ('홍 길동' → '홍길동').
 *  부분 일치·앞글자 일치는 쓰지 않는다. 보안이 약해진다. */
function normalizeName(name: unknown): string {
  return String(name ?? '').replace(/\s+/g, '');
}

/** 접속 IP 를 솔트와 함께 해시한다. 원문 IP 는 저장하지 않는다(개인정보 최소화). */
async function hashIp(ip: string): Promise<string> {
  const salt = Deno.env.get('VERIFY_IP_SALT') ?? '';
  if (!salt) console.warn('[verify-brn] VERIFY_IP_SALT 미설정 — 솔트 없이 해시합니다.');
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 만 나이. 생년월일이 없거나 이상하면 undefined(= 모른다). */
function ageOf(birthDate: unknown): number | undefined {
  if (!birthDate) return undefined;
  const b = new Date(String(birthDate));
  if (Number.isNaN(b.getTime())) return undefined;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsFor(req) });
  }

  try {
    const { brn, ceoName } = await req.json().catch(() => ({ brn: '', ceoName: '' }));
    const digits = String(brn ?? '').replace(/[^0-9]/g, '');
    const inputName = normalizeName(ceoName);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── 호출 제한 ─────────────────────────────────────────────────────────────
    // Edge Function 은 호출마다 새로 뜰 수 있어 메모리 변수로는 셀 수 없다.
    // 시도 기록을 테이블(verify_attempts, RLS 전체 잠금)에 남겨 IP 기준으로 센다.
    // 형식이 틀린 요청도 함께 세어야 한다 — 안 세면 그쪽으로 무한 시도가 가능하다.
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
    const ipHash = await hashIp(ip);
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_SEC * 1000).toISOString();

    const { count, error: countError } = await admin
      .from('verify_attempts')
      .select('*', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('attempted_at', since);

    if (countError) {
      // 테이블 미생성 등. 제한을 못 걸었다고 조회 자체를 막지는 않되 로그로 남긴다.
      console.error('[verify-brn] 호출 제한 확인 실패(계속 진행):', countError);
    } else if ((count ?? 0) >= RATE_LIMIT_COUNT) {
      return json(req, { found: false, error: 'rate_limited' }, 429);
    }

    await admin.from('verify_attempts').insert({ ip_hash: ipHash });

    // 오래된 기록 정리 — pg_cron 없이도 쌓이지 않게 확률적으로 실행한다
    if (Math.random() < CLEANUP_PROBABILITY) {
      const cutoff = new Date(Date.now() - ATTEMPT_RETENTION_HOURS * 3600 * 1000).toISOString();
      await admin.from('verify_attempts').delete().lt('attempted_at', cutoff);
    }
    // ─────────────────────────────────────────────────────────────────────────

    if (digits.length !== 10 || !inputName) {
      return json(req, { found: false });
    }
    // DB에 하이픈 포함(123-45-67890)으로 저장된 경우까지 함께 대조
    const hyphenated = `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;

    const { data, error } = await admin
      .from('clients')
      .select('name, client_type, biz_type, biz_item, address, customer_type, client_persons(relation_type, persons(name, birth_date, gender))')
      .in('biz_reg_no', [digits, hyphenated])
      .limit(5);

    if (error) throw error;

    // 수임 해지(해임)된 거래처는 고객사로 인정하지 않는다
    const match = (data ?? []).find((c: any) => c.customer_type !== '해임') ?? null;
    if (!match) {
      return json(req, { found: false });
    }

    // ── 대표자 성명 대조 ──────────────────────────────────────────────────────
    // 공동사업자: relation_type='대표자' 인 사람이 여러 명일 수 있다.
    // 그 중 한 명의 이름만 일치하면 통과다.
    const links: any[] = match.client_persons ?? [];
    const asPerson = (cp: any) => (Array.isArray(cp?.persons) ? cp.persons[0] : cp?.persons);
    const repLinks = links.filter((cp) => cp.relation_type === '대표자');
    // '대표자' 관계가 하나도 없으면 연결된 전체 인물로 폴백한다(기존 links[0] 폴백과 같은 취지)
    const reps = (repLinks.length > 0 ? repLinks : links).map(asPerson).filter(Boolean);

    const authenticated = reps.find((p: any) => normalizeName(p?.name) === inputName);
    if (!authenticated) {
      // 번호는 맞지만 이름이 틀린 경우 — 없는 번호와 응답이 완전히 같아야 한다
      return json(req, { found: false });
    }

    // ── 대표자 속성 판정 ──────────────────────────────────────────────────────
    // 공동사업자는 "대표자 중 한 명이라도 해당하면 인정"한다 (2026-08-10 확인).
    //   근거: 이 값은 자격을 만들지 않고 카드에 주의 문구를 띄울지만 결정한다
    //   (services/matchingService.ts 의 OWNER_MISMATCH_RULES). 이 방식이면 경고는
    //   대표자 전원이 미충족일 때만 떠서 틀린 경고가 생기지 않는다.
    //   실제 요건은 우리 DB로 판정할 수 없다 — 여성기업 확인은 출자지분 기준이고,
    //   청년 요건의 공동대표 처리는 공고마다 다르다(전원 청년 요구 / 단독만 지원).
    // 값을 하나도 모르면 undefined 로 두어 "판단하지 않음"으로 넘긴다.
    const ages = reps.map((p: any) => ageOf(p?.birth_date)).filter((a): a is number => a !== undefined);
    const isYouthOwner = ages.length > 0 ? ages.some((a) => a <= YOUTH_AGE) : undefined;

    const genders = reps.map((p: any) => p?.gender).filter(Boolean);
    const isFemaleOwner = genders.length > 0 ? genders.some((g: string) => g === '여') : undefined;

    // 대표자 성명(ceoName)은 응답에 담지 않는다 — 화면에서 쓰지 않는 개인정보다.
    return json(req, {
      found: true,
      companyName: match.name ?? '',
      clientType: match.client_type ?? '', // 법인 / 개인 / 비사업자 — 사업자 형태 전용 사업 판정용
      bizCategory: match.biz_type ?? '',   // 업태 (통합 스키마에선 biz_type 컬럼이 업태)
      bizItem: match.biz_item ?? '',       // 종목 — 산업 분야 판정에 함께 쓴다
      regionHint: match.address ?? '',
      isYouthOwner,
      isFemaleOwner,
    });
  } catch (err) {
    console.error('[verify-brn] 오류:', err);
    return json(req, { found: false, error: 'internal_error' }, 500);
  }
});
