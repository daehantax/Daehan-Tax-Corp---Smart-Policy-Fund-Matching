// =============================================================================
// 주간 신규 공고 리포트 — 그 주에 처음 본 공고를 거래처 전체와 대조해 집계한다
//
//   node scripts/run-ts.mjs scripts/weekly-report.ts               # 지난 주(월~일)
//   node scripts/run-ts.mjs scripts/weekly-report.ts --week 2026-11-02
//   node scripts/run-ts.mjs scripts/weekly-report.ts --dry-run     # 계산만, 쓰지 않음
//
// 어디로 가나:
//   `grant_weekly_grants` · `grant_weekly_matches` (shared-db 20261112_grant_weekly_report.sql).
//   디허브(`/support/weekly`)가 이 표를 **읽어서 그리기만** 한다.
//
// 왜 디허브가 직접 계산하지 않나:
//   지역·시군 판정(`services/geo.ts`)과 점수·경고(`services/matchingService.ts`)가
//   이 저장소에만 있다. CLAUDE.md 가 「geo.ts 가 지역 판정의 단일 출처다.
//   세 번째 복제본을 만들지 않는다」를 못 박았으므로, **계산은 여기서 하고 결과만 넘긴다.**
//
// ⚠ 개인정보 — 상호·사업자번호·대표자명을 **표에 담지 않는다.** 담는 것은 `client_id` 뿐이고
//   이름은 디허브가 clients 와 조인해서 읽는다. 화면에도 집계와 명단만 나간다.
//
// ⚠ 실패하면 기존 주차를 건드리지 않는다. 거래처를 한 곳도 못 읽으면 종료코드 1.
//   (CLAUDE.md 「동기화 실패 시 기존 데이터를 덮어쓰지 않는다」와 같은 취지)
// =============================================================================

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Grant, UserSession } from '../types';
import { scoreGrant } from '../services/matchingService';
import { mapSupabaseRow } from '../services/grantRow';
import { resolveAddress } from '../services/geo';
import { weekRangeFor } from '../services/weekRange';
import {
  businessYears,
  pickHeadcount,
  pickRevenue,
  type ClientFacts,
  type FilingRow,
  type ManualRevenueRow,
} from '../supabase/functions/_shared/companyProfile';

// ── 인자 ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const DRY_RUN = flag('dry-run');

// ── 주차 ─────────────────────────────────────────────────────────────────────
// 경계 계산은 services/weekRange.ts 에 두고 테스트로 묶었다 — 틀려도 눈에 안 보이고
// 한 주 뒤에야 드러나는 자리라서. 기본값은 **막 끝난 한 주**(지난 월~일)다.
const weekArg = value('week');
if (weekArg && !/^\d{4}-\d{2}-\d{2}$/.test(weekArg)) {
  console.error(`--week 는 YYYY-MM-DD 형식이어야 합니다: ${weekArg}`);
  process.exit(1);
}
const week = weekRangeFor(new Date(), weekArg);
const { start: weekStart, end: weekEnd, label: WEEK_LABEL } = week;

console.log(
  `\n[weekly-report] 주차 ${WEEK_LABEL} (KST ${WEEK_LABEL} ~ ${week.lastDay})`
  + (DRY_RUN ? ' · 계산만 하고 쓰지 않습니다' : ''),
);

// ── 접속 ─────────────────────────────────────────────────────────────────────
const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없습니다.');
  process.exit(1);
}
const db: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/**
 * PostgREST 는 한 번에 1000행이 상한이다. 반드시 페이징한다.
 *
 * ⚠ **정렬 키를 반드시 준다(기본키).** ORDER BY 없는 페이징은 Postgres 가 페이지마다
 *   같은 순서를 보장하지 않아 행이 겹치거나 빠진다. 2026-11-23 실측 — 같은 코드를 두 번
 *   돌렸는데 매출 온전 비율이 89.0% → 50.1% 로 달라졌다(filing_vat 행이 페이지 사이로 샜다).
 */
async function all<T = any>(
  table: string,
  cols: string,
  orderBy: string[],
  tune?: (q: any) => any,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q: any = db.from(table).select(cols);
    if (tune) q = tune(q);
    for (const col of orderBy) q = q.order(col, { ascending: true });
    q = q.range(from, from + 999);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data as T[]));
    if (!data || data.length < 1000) return out;
  }
}

// ── 1. 그 주에 처음 본 공고 ──────────────────────────────────────────────────
// 「처음 본 날」은 policy_grants.created_at 이다. 기본값 now() 이고 동기화 업서트 페이로드에
// 이 칸이 **없어서** 처음 insert 된 시각이 그대로 남는다(merge-duplicates 는 보낸 칸만 갱신한다).
//   2026-11-23 확인 — 7/31 첫 적재 1,573건 뒤로 주마다 109~313건씩 자연스럽게 쌓여 있고,
//   그날 새벽 동기화 뒤에도 「오늘 생성」은 1건뿐이었다(덮어써졌다면 전부 오늘이었을 것).
//   그래서 처음 계획한 first_seen_at 칸은 만들지 않았다 — 같은 값을 두 번 들 이유가 없고,
//   등록일 기반 소급(등록일 빈 공고 369건)이 「가짜 신규」를 만드는 문제도 피한다.
// 등록일자(registration_date)를 쓰지 않는 이유 — 출처마다 소급 등록이 있어 들쭉날쭉하다.
// active 로 거르지 않는다 — 그 주에 올라온 뒤 마감돼 내려간 공고도 **그 주의 기록**이다.
const weekRows = await all<any>('policy_grants', '*', ['id'], (q) =>
  q.gte('created_at', weekStart.toISOString()).lt('created_at', weekEnd.toISOString()));

// 같은 공고가 두 출처(기업마당·중소벤처24)로 따로 들어와, 한쪽은 살아 있고 한쪽은 내려간 경우가 있다.
// 동기화는 활성 공고 사이의 중복만 지우므로, 비활성까지 담는 이 리포트에서는 **같은 제목이 그 주에
// 살아 있으면 내려간 쪽을 뺀다.** 고객용 앱이 지금 보여 주는 바로 그 행을 쓰려는 것이다.
//   2026-11-23 실측(11-16 주) — 비활성 25건 중 23건은 마감이 지나 내려간 것(그 주의 기록으로 남긴다),
//   1건이 이런 중복이었다(「고양시 영상기업 활용 인센티브」가 기업마당·중소벤처24 두 판으로 두 번 잡혔다).
const titleKey = (t: unknown) => String(t ?? '').replace(/\s+/g, '');
const liveTitles = new Set(weekRows.filter((r) => r.active).map((r) => titleKey(r.title)));
const grantRows = weekRows.filter((r) => r.active || !liveTitles.has(titleKey(r.title)));
if (grantRows.length < weekRows.length) {
  console.log(`[weekly-report] 두 출처 중복 ${weekRows.length - grantRows.length}건은 살아 있는 쪽만 남겼습니다`);
}

if (grantRows.length === 0) {
  console.log('[weekly-report] 그 주에 새로 들어온 공고가 없습니다. 기존 주차는 그대로 둡니다.');
  process.exit(0);
}
const grants: Grant[] = grantRows.map(mapSupabaseRow);
const firstSeenOf = new Map<string, string | null>(
  grantRows.map((r) => [String(r.pblanc_id), r.created_at ?? null]),
);
console.log(`[weekly-report] 신규 공고 ${grants.length}건`);

// ── 2. 거래처 ────────────────────────────────────────────────────────────────
// 기장 + 신고대리. 해임·폐업은 뺀다. 사업자번호가 없으면 대조할 것이 없다.
//   고객용 앱은 기장만 보여 주지만(2026-11-04), 이 화면은 사내용이라 신고대리도 세어
//   담당자가 안내할지 정하게 한다. 둘은 집계에서 갈라 담는다.
type ClientRow = ClientFacts & {
  id: number;
  biz_reg_no: string | null;
  client_type: string | null;
  biz_type: string | null;
  biz_item: string | null;
  industry_code: string | null;
  address: string | null;
  customer_type: string | null;
  manager_staff_id: number | null;
  name: string | null;
  client_persons?: any[];
};

const clientRows = await all<ClientRow>(
  'clients',
  'id, name, biz_reg_no, client_type, tax_type, biz_type, biz_item, industry_code, '
  + 'open_date, close_date, address, customer_type, manager_staff_id, '
  + 'client_persons(relation_type, persons(birth_date, gender))',
  ['id'],
);
const clients = clientRows.filter(
  (c) => c.biz_reg_no && !c.close_date && (c.customer_type === '기장' || c.customer_type === '신고대리'),
);
if (clients.length === 0) {
  console.error('[weekly-report] ⚠ 거래처를 한 곳도 읽지 못했습니다. 기존 주차를 건드리지 않고 멈춥니다.');
  process.exit(1);
}
const mainCount = clients.filter((c) => c.customer_type === '기장').length;
console.log(`[weekly-report] 거래처 ${clients.length}곳 (기장 ${mainCount} · 신고대리 ${clients.length - mainCount})`);

// ── 3. 수치 프로필 재료 ──────────────────────────────────────────────────────
// verify-brn 은 거래처 한 곳씩 읽지만 여기서는 1,000곳을 한꺼번에 돌리므로 **통째로 받아** 나눈다.
// 판정 규칙 자체는 `_shared/companyProfile.ts` 를 그대로 쓴다 — 화면과 어긋나지 않게.
const now = new Date();
const revenueYears = [now.getFullYear() - 1, now.getFullYear() - 2];
const whYears = [now.getFullYear(), now.getFullYear() - 1];
const years = [...new Set([...revenueYears, ...whYears])];

const filings = await all<FilingRow & { client_id: number }>(
  'filings',
  'id, client_id, tax_type, tax_year, period_code, period_chosen',
  ['id'],
  (q) => q.in('tax_year', years),
);
const vatRows = await all<any>('filing_vat', 'filing_id, tax_base', ['filing_id']);
const exemptRows = await all<any>('filing_exempt', 'filing_id, income_amount', ['filing_id']);
const whRows = await all<any>('filing_withholding', 'filing_id, cnt_wage', ['filing_id']);
const manualRows = await all<any>(
  'client_annual_revenue', 'client_id, tax_year, revenue_amount, source', ['client_id', 'tax_year'],
);

const vatBase = new Map<string, number | null>(vatRows.map((r) => [r.filing_id, r.tax_base]));
const exemptBase = new Map<string, number | null>(exemptRows.map((r) => [r.filing_id, r.income_amount]));
const wageCount = new Map<string, number | null>(whRows.map((r) => [r.filing_id, r.cnt_wage]));

const filingsByClient = new Map<number, FilingRow[]>();
for (const f of filings) {
  const list = filingsByClient.get(f.client_id);
  if (list) list.push(f);
  else filingsByClient.set(f.client_id, [f]);
}
const manualByClient = new Map<number, ManualRevenueRow[]>();
for (const m of manualRows) {
  const list = manualByClient.get(m.client_id);
  if (list) list.push(m);
  else manualByClient.set(m.client_id, [m]);
}

// 업종 꼬리표 (C-12) — 국세청 6자리 코드를 미리 꼬리표로 바꿔 둔 표
const tagRows = await all<any>('industry_code_tags', 'code, tags', ['code']);
const tagsByCode = new Map<string, string[]>(
  tagRows.map((r) => [String(r.code), Array.isArray(r.tags) ? r.tags : []]),
);

// ── 4. 거래처 → UserSession ──────────────────────────────────────────────────
const YOUTH_AGE = 39;
function ageOf(birthDate: unknown): number | undefined {
  if (!birthDate) return undefined;
  const b = new Date(String(birthDate));
  if (Number.isNaN(b.getTime())) return undefined;
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

function sessionOf(c: ClientRow): UserSession {
  const links: any[] = c.client_persons ?? [];
  const asPerson = (cp: any) => (Array.isArray(cp?.persons) ? cp.persons[0] : cp?.persons);
  const repLinks = links.filter((cp) => cp.relation_type === '대표자');
  const reps = (repLinks.length > 0 ? repLinks : links).map(asPerson).filter(Boolean);

  // 공동사업자는 「대표자 중 한 명이라도 해당하면 인정」 — verify-brn 과 같은 규칙
  const ages = reps.map((p: any) => ageOf(p?.birth_date)).filter((a): a is number => a !== undefined);
  const genders = reps.map((p: any) => p?.gender).filter(Boolean);

  const fl = filingsByClient.get(c.id) ?? [];
  const revenue = pickRevenue(revenueYears, c, fl, vatBase, exemptBase, manualByClient.get(c.id) ?? []);
  const head = pickHeadcount(fl, wageCount);
  const place = resolveAddress(c.address ?? '');

  return {
    type: 'CLIENT',
    identifier: String(c.biz_reg_no ?? ''),
    clientType: c.client_type ?? undefined,
    bizType: c.biz_type ?? undefined,
    bizItem: c.biz_item ?? undefined,
    isYouthOwner: ages.length > 0 ? ages.some((a) => a <= YOUTH_AGE) : undefined,
    isFemaleOwner: genders.length > 0 ? genders.some((g: string) => g === '여') : undefined,
    revenueBracket: revenue.bracket?.label,
    revenueMin: revenue.bracket?.min,
    revenueMax: revenue.bracket?.max ?? undefined,
    revenueYear: revenue.year,
    revenueCoverage: revenue.coverage,
    revenueBasis: revenue.basis,
    businessYears: businessYears(c.open_date),
    employeeCount: head.count,
    employeeYear: head.year,
    employeeMonth: head.month,
    employeeMonths: head.months,
    industryCode: c.industry_code ?? undefined,
    // 빈 배열은 「해당 없음」이 아니라 「모른다」다 — matchingService 가 경고를 띄우지 않는다
    industryTags: tagsByCode.get(String(c.industry_code ?? '')) ?? [],
    region: place.region,
    sigungu: place.sigungu,
    companyName: c.name ?? undefined,
  };
}

const everyone = clients.map((c) => ({ client: c, session: sessionOf(c) }));

// 주소로 **시도조차 판정하지 못한** 거래처는 이 집계에서 뺀다.
//
//   고객용 앱에서는 이런 거래처에게 지역 공고를 숨기지 않는다 — 「확실하지 않으면 제외하지
//   않는다」(CLAUDE.md). 그 원칙은 **고객에게 보이는 공고**를 지키려는 것이다.
//   이 리포트는 사내 집계라 사정이 다르다. 지역을 모르는 거래처 한 곳이 **모든 지역 공고에
//   「1곳 해당」으로** 붙어서, 정작 아무도 안 걸리는 공고를 가려낼 수 없게 된다.
//   2026-11-23 실측 — 그런 거래처가 1곳뿐인데 시군 전용 공고 59건 중 **29건**이
//   「해당 없음」 대신 「1곳」으로 나왔다. 이 화면의 쓸모(볼 것 / 안 볼 것)가 통째로 사라진다.
//
//   빼는 대신 **숨기지 않는다** — client_id 를 로그에 남겨 주소를 고칠 수 있게 한다.
//   주소가 고쳐지면 다음 주부터 저절로 다시 들어온다.
const unplaced = everyone.filter(({ session }) => !session.region || session.region === '전체');
const sessions = everyone.filter(({ session }) => session.region && session.region !== '전체');
if (unplaced.length > 0) {
  console.warn(
    `[weekly-report] ⚠ 주소로 시도를 판정하지 못한 거래처 ${unplaced.length}곳은 대조에서 뺐습니다 — `
    + `디허브 거래처 관리에서 주소를 확인하세요. client_id: ${unplaced.map(({ client }) => client.id).join(', ')}`,
  );
}

// ── 5. 대조 ──────────────────────────────────────────────────────────────────
// 관심 키워드는 고객사 브라우저(localStorage)에만 있다 — 서버에는 없으므로 빈 배열로 둔다.
// 키워드는 가점일 뿐이라 **자격 판정에는 영향이 없다**(scoreGrant 4번 항목).
type MatchRow = { week_start: string; pblanc_id: string; client_id: number; verdict: 'pass' | 'check'; notes: string[] };

const grantStats: any[] = [];
const matches: MatchRow[] = [];

for (const g of grants) {
  let mainTotal = 0, mainClean = 0, proxyTotal = 0, proxyClean = 0;
  // 담당자별 같은 집계 — 디허브 「내 담당」 토글이 매칭 줄을 다 받지 않고 쓰게 (by_staff 칸)
  const byStaff: Record<string, { mt: number; mc: number; pt: number; pc: number }> = {};

  for (const { client, session } of sessions) {
    const r = scoreGrant(g, session, []);
    // score 0 은 **지역·시군 자격이 없다**는 뜻이다(scoreGrant 의 이른 return 두 곳).
    // 그 밖의 축은 감점·경고일 뿐 자격을 없애지 않는다 — §1 원칙.
    if (r.score <= 0) continue;

    // 판정은 **경고(실제로 어긋난 점)만** 본다.
    //   「공고문 확인 필요」(unverifiableConditions)는 우리가 못 읽은 조건이라 어긋남이 아니다.
    //   그것까지 check 로 치면 거의 모든 공고가 check 가 되어 pass 가 뜻을 잃는다.
    const notes = r.warnings ?? [];
    const verdict: 'pass' | 'check' = notes.length > 0 ? 'check' : 'pass';

    const key = client.manager_staff_id == null ? 'none' : String(client.manager_staff_id);
    const mine = (byStaff[key] ??= { mt: 0, mc: 0, pt: 0, pc: 0 });
    if (client.customer_type === '기장') {
      mainTotal++;
      mine.mt++;
      if (verdict === 'pass') { mainClean++; mine.mc++; }
    } else {
      proxyTotal++;
      mine.pt++;
      if (verdict === 'pass') { proxyClean++; mine.pc++; }
    }
    matches.push({ week_start: WEEK_LABEL, pblanc_id: g.id, client_id: client.id, verdict, notes });
  }

  grantStats.push({
    week_start: WEEK_LABEL,
    pblanc_id: g.id,
    first_seen_at: firstSeenOf.get(g.id) ?? null,
    main_total: mainTotal,
    main_clean: mainClean,
    main_warn: mainTotal - mainClean,
    proxy_total: proxyTotal,
    proxy_clean: proxyClean,
    proxy_warn: proxyTotal - proxyClean,
    by_staff: byStaff,
    computed_at: new Date().toISOString(),
  });
}

const withHits = grantStats.filter((s) => s.main_total > 0 || s.proxy_total > 0).length;
console.log(
  `[weekly-report] 대조 끝 — 거래처가 걸리는 공고 ${withHits}건 · 해당 없음 ${grants.length - withHits}건`
  + ` · 걸린 줄 ${matches.length.toLocaleString()}개`,
);

// 가장 많이 걸린 공고 다섯 개를 로그에 남긴다 (Actions 로그만 보고도 이상을 알아채게)
for (const s of [...grantStats].sort((a, b) => b.main_clean - a.main_clean).slice(0, 5)) {
  const g = grants.find((x) => x.id === s.pblanc_id);
  console.log(`   기장 ${String(s.main_clean).padStart(5)} + 주의 ${String(s.main_warn).padStart(5)}  ${g?.title.slice(0, 50)}`);
}

if (DRY_RUN) {
  console.log('[weekly-report] --dry-run 이라 쓰지 않고 끝냅니다.');
  process.exit(0);
}

// ── 6. 저장 ──────────────────────────────────────────────────────────────────
// 여기까지 왔으면 계산은 끝났다. 그 주차만 지우고 다시 넣는다(다시 돌려도 같은 결과).
async function wipe(table: string) {
  const { error } = await db.from(table).delete().eq('week_start', WEEK_LABEL);
  if (error) throw new Error(`${table} 비우기 실패: ${error.message}`);
}
async function insert(table: string, rows: any[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table} 저장 실패: ${error.message}`);
  }
}

try {
  await wipe('grant_weekly_matches');
  await wipe('grant_weekly_grants');
  await insert('grant_weekly_grants', grantStats);
  await insert('grant_weekly_matches', matches);
  console.log(`[weekly-report] 저장 완료 — 공고 ${grantStats.length}줄 · 매칭 ${matches.length.toLocaleString()}줄\n`);
} catch (err: any) {
  console.error(`[weekly-report] ⚠ 저장 실패: ${err?.message ?? err}`);
  process.exit(1);
}
