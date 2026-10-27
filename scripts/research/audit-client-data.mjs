// =============================================================================
// [조사용] C-2 고객사 데이터 충족률 — 매칭에 쓸 수 있는 값이 실제로 얼마나 채워져 있나
//
// ⚠ 조사(research) 전용. 운영 파이프라인·앱에 연결하지 않는다. → docs/WORK_PLAN.md C-2 / §7
//   앱에서 고객사 값을 읽는 길은 `verify-brn` Edge Function 하나뿐이다(A-6).
//   이 스크립트는 **서비스 키로 RLS를 우회해** 공용 DB를 직접 센다. 로컬에서 손으로만 돌린다.
//
// ⚠ 개인정보는 출력하지 않는다. 거래처명·사업자번호·대표자명은 읽어도 **세기만** 하고
//   화면에 찍지 않는다. 출력은 전부 집계값이다. 결과를 파일로 저장하지도 않는다.
//
// 왜 저장소에 두나 — 근로자수는 원천세 입력이 쌓이면서 매달 올라가고, 매출은 신고철마다
//   바뀐다. 「값이 바뀌면 다시 돌린다」는 자리가 필요하다. §7 실측 기록의 출처가 이 파일이다.
//
// 사용법:
//   node scripts/research/audit-client-data.mjs
//   node scripts/research/audit-client-data.mjs --rev-year 2025 --wh-year 2026
//
// 자격증명 (둘 중 하나):
//   1) 환경변수 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//   2) 없으면 dh-platform 의 .env.local 에서 읽는다
//      기본 경로 ../dh-platform/.env.local — 다르면 DH_PLATFORM_ENV 로 지정
//
// 출력은 §7에 그대로 옮겨 적을 수 있는 모양이다. 옮길 때 **측정일을 함께 적는다.**
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ── 인자 ─────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
};
// 매출은 **직전연도**가 자격 기준이고, 원천세 인원은 **올해**가 최신이다.
// 해가 바뀌면 기본값을 올리거나 인자로 넘긴다.
const REV_YEAR = arg('rev-year', 2025);
const WH_YEAR = arg('wh-year', 2026);

// ── 접속 ─────────────────────────────────────────────────────────────────────
function credentials() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  }
  const envPath = process.env.DH_PLATFORM_ENV
    ?? path.resolve(ROOT, '..', 'dh-platform', '.env.local');
  let text;
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    console.error(
      `자격증명을 찾지 못했다.\n` +
      `  · 환경변수 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 를 넣거나\n` +
      `  · dh-platform 의 .env.local 경로를 DH_PLATFORM_ENV 로 지정한다 (찾아본 곳: ${envPath})`,
    );
    process.exit(1);
  }
  const env = Object.fromEntries(
    text.split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      }),
  );
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(`${envPath} 에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없다.`);
    process.exit(1);
  }
  return { url, key };
}

const { url, key } = credentials();
const db = createClient(url, key, { auth: { persistSession: false } });

/** PostgREST 는 한 번에 1000행이 상한이다. 반드시 페이징한다 */
async function all(table, cols) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');
const row = (label, n, d) => console.log(`  ${label.padEnd(28)} ${String(n).padStart(5)} / ${d}  ${pct(n, d).padStart(7)}`);
const 억 = 1e8;
const tally = (xs, keyOf) => Object.entries(
  xs.reduce((a, x) => ((a[keyOf(x)] = (a[keyOf(x)] ?? 0) + 1), a), {}),
).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');

console.log(`\n측정일 ${new Date().toISOString().slice(0, 10)} · 매출 귀속 ${REV_YEAR}년 · 원천세 ${WH_YEAR}년`);

// ── 모수 ─────────────────────────────────────────────────────────────────────
// 「매칭 앱에 로그인할 수 있는 곳」 = 사업자번호가 있고, 해임되지 않았고, 폐업하지 않은 곳
const clients = await all('clients',
  'id, biz_reg_no, client_type, tax_type, biz_type, biz_item, industry_code, sub_industry_code, '
  + 'open_date, close_date, customer_type, address, road_address');

const active = clients.filter((c) => c.biz_reg_no && c.customer_type !== '해임' && !c.close_date);
const byId = new Map(active.map((c) => [c.id, c]));
const N = active.length;

console.log(`\n■ 모수 — 사업자번호 있고 해임·폐업 아닌 거래처: ${N}곳 (전체 ${clients.length})`);
console.log(`  수임상태: ${tally(clients, (c) => c.customer_type ?? '(빈값)')}`);

// ── clients 테이블 자체 값 ───────────────────────────────────────────────────
console.log(`\n■ clients 테이블 자체 값`);
row('사업자형태 client_type', active.filter((c) => c.client_type).length, N);
row('업태 biz_type', active.filter((c) => c.biz_type).length, N);
row('종목 biz_item', active.filter((c) => c.biz_item).length, N);
row('업종코드 industry_code', active.filter((c) => c.industry_code).length, N);
row('부업종코드 sub_industry_code', active.filter((c) => c.sub_industry_code).length, N);
row('개업일 open_date', active.filter((c) => c.open_date).length, N);
row('주소 address', active.filter((c) => c.address).length, N);
row('도로명주소 road_address', active.filter((c) => c.road_address).length, N);
console.log(`  사업자형태: ${tally(active, (c) => c.client_type ?? '(빈값)')}`);
console.log(`  과세유형:   ${tally(active, (c) => c.tax_type ?? '(빈값)')}`);
// ⚠ industry_code 는 국세청 6자리다. 공고의 업종 조건은 통계청 KSIC 5자리를 쓴다.
//   두 체계는 서로 변환되지 않는다 → WORK_PLAN A-11 / §8 리스크

// ── 신고 ─────────────────────────────────────────────────────────────────────
const filings = await all('filings', 'id, client_id, tax_type, tax_year, period_code, period_chosen, service_type');
const vat = new Map((await all('filing_vat', 'filing_id, tax_base')).map((r) => [r.filing_id, r]));
const wh = new Map((await all('filing_withholding', 'filing_id, cnt_wage, cnt_daily, cnt_business')).map((r) => [r.filing_id, r]));
const ex = new Map((await all('filing_exempt', 'filing_id, income_amount')).map((r) => [r.filing_id, r]));
const manual = await all('client_annual_revenue', 'client_id, tax_year, revenue_amount, source');

// ── 매출액 — 「온전함」 판정 ──────────────────────────────────────────────────
// ⚠ 이 규칙은 dh-platform `src/lib/filings.ts` 의 **`incomeCoverageMap()` 을 옮겨 적은 것**이다.
//   (TS 라 여기서 import 할 수 없다.) **두 곳이 어긋나면 dh-platform 쪽이 맞다.**
//   근거: shared-db `supabase/migrations/20260917_client_annual_revenue.sql` 주석
//     · 일반과세 — 1기·2기가 둘 다 있어야 온전. 예정·확정 중 아무거나 있으면 그 반기는 있는 것
//     · 간이과세 — 연 1건이 정상 (부가가치세법 제5조 제1항 제1호). 한 건이면 온전
//     · 면세     — 연 1건. 단 **부가세 신고가 하나도 없을 때만** 한 건으로 온전 (겸영 때문)
//     · 그 해 개업 전·폐업 후인 반기는 비어 있는 게 정상이라 「빠졌다」고 세지 않는다
//     · period_chosen = false 인 줄(귀속을 아직 안 고른 수정·기한후)은 뺀다
function halfExpected(c, year, half) {
  const from = half === 1 ? `${year}-01-01` : `${year}-07-01`;
  const to = half === 1 ? `${year}-06-30` : `${year}-12-31`;
  if (c.open_date && c.open_date > to) return false;
  if (c.close_date && c.close_date < from) return false;
  return true;
}

function revenueFor(year) {
  const halves = new Map();   // client_id -> Set(1|2)
  const exemptOnly = new Set();
  const sum = new Map();      // client_id -> 과표+수입금액 합
  const hasVatRow = new Set();

  for (const f of filings) {
    if (f.tax_year !== year || !byId.has(f.client_id)) continue;
    if (f.period_chosen === false) continue;          // 귀속 미확정 줄은 뺀다
    if (f.tax_type === '부가세') {
      const amount = vat.get(f.id)?.tax_base;
      if (amount == null) continue;
      hasVatRow.add(f.client_id);
      sum.set(f.client_id, (sum.get(f.client_id) ?? 0) + Number(amount));
      const half = String(f.period_code ?? '').startsWith('1기') ? 1
        : String(f.period_code ?? '').startsWith('2기') ? 2 : null;
      if (half == null) continue;
      if (!halves.has(f.client_id)) halves.set(f.client_id, new Set());
      halves.get(f.client_id).add(half);
    } else if (f.tax_type === '면세') {
      const amount = ex.get(f.id)?.income_amount;
      if (amount == null) continue;
      exemptOnly.add(f.client_id);
      sum.set(f.client_id, (sum.get(f.client_id) ?? 0) + Number(amount));
    }
  }

  const state = new Map();
  for (const c of active) {
    const got = halves.get(c.id) ?? new Set();
    // 면세 — 부가세 신고가 하나도 없을 때만 한 건으로 온전
    if (!hasVatRow.has(c.id) && exemptOnly.has(c.id)) { state.set(c.id, 'full'); continue; }
    // 간이 — 연 1건이 정상
    if ((c.tax_type ?? '').startsWith('간이')) { state.set(c.id, got.size > 0 ? 'full' : 'none'); continue; }
    const expected = [1, 2].filter((h) => halfExpected(c, year, h));
    const missing = expected.filter((h) => !got.has(h));
    state.set(c.id, got.size === 0 ? 'none' : missing.length === 0 ? 'full' : 'partial');
  }

  const full = [...state.values()].filter((s) => s === 'full').length;
  const partial = [...state.values()].filter((s) => s === 'partial').length;
  const man = new Set(manual.filter((m) => m.tax_year === year && byId.has(m.client_id)).map((m) => m.client_id));
  // 쓸 수 있는 곳 = 온전한 계산값이 있거나, 수기 보충분이 있는 곳
  const covered = new Set([...[...state].filter(([, s]) => s === 'full').map(([c]) => c), ...man]);
  return { state, full, partial, manual: man.size, covered, sum };
}

console.log(`\n■ 매출액 — 부가세 과세표준 + 면세 수입금액`);
for (const y of [REV_YEAR, REV_YEAR - 1]) {
  const r = revenueFor(y);
  console.log(`  ${y}년 귀속`);
  row('  온전', r.full, N);
  row('  반쪽 (한 반기가 빔)', r.partial, N);
  row('  수기 보충분', r.manual, N);
  row('  → 쓸 수 있는 곳', r.covered.size, N);
}

// 금액 분포 — 숫자가 제정신인지 눈으로 본다 (0원·극단값이 섞이면 구간 판정이 틀어진다)
const rev = revenueFor(REV_YEAR);
const amounts = [...rev.state].filter(([, s]) => s === 'full')
  .map(([cid]) => rev.sum.get(cid) ?? 0).sort((a, b) => a - b);
if (amounts.length) {
  const band = (lo, hi) => amounts.filter((a) => a >= lo && (hi == null || a < hi)).length;
  console.log(`  ${REV_YEAR}년 금액 분포 (온전한 ${amounts.length}곳)`);
  console.log(`     1억 미만 ${band(0, 억)} · 1~5억 ${band(억, 5 * 억)} · 5~10억 ${band(5 * 억, 10 * 억)}`
    + ` · 10~50억 ${band(10 * 억, 50 * 억)} · 50억+ ${band(50 * 억, null)}`);
  console.log(`     중앙값 ${(amounts[Math.floor(amounts.length / 2)] / 억).toFixed(2)}억`
    + ` · 최대 ${(amounts[amounts.length - 1] / 억).toFixed(1)}억 · 0원 ${amounts.filter((a) => a === 0).length}곳`);
}

// ── 상시근로자 수 — 원천세 근로 인원 ─────────────────────────────────────────
// ⚠ 공고가 말하는 「상시근로자」와 원천세 근로 인원은 같지 않다. 대략값으로만 쓴다.
function headcountFor(year) {
  const per = new Map();     // client_id -> { max, months }
  const rows = new Set();    // 원천세 신고 행이 있는 거래처
  const daily = new Set();
  const biz = new Set();
  const months = {};
  for (const f of filings) {
    if (f.tax_type !== '원천세' || f.tax_year !== year || !byId.has(f.client_id)) continue;
    rows.add(f.client_id);
    const w = wh.get(f.id);
    if (!w) continue;
    if (w.cnt_daily != null) daily.add(f.client_id);
    if (w.cnt_business != null) biz.add(f.client_id);
    if (w.cnt_wage == null) continue;
    months[f.period_code] = (months[f.period_code] ?? 0) + 1;
    const cur = per.get(f.client_id) ?? { max: 0, months: 0 };
    cur.max = Math.max(cur.max, w.cnt_wage);
    cur.months++;
    per.set(f.client_id, cur);
  }
  return { per, rows, daily, biz, months };
}

console.log(`\n■ 상시근로자 수 — filing_withholding.cnt_wage`);
for (const y of [WH_YEAR, WH_YEAR - 1]) {
  const h = headcountFor(y);
  console.log(`  ${y}년`);
  row('  근로 인원 값 있음', h.per.size, N);
  row('  3개월 이상 기록', [...h.per.values()].filter((v) => v.months >= 3).length, N);
  if (h.per.size) {
    const maxes = [...h.per.values()].map((v) => v.max).sort((a, b) => a - b);
    const band = (lo, hi) => maxes.filter((m) => m >= lo && (hi == null || m <= hi)).length;
    console.log(`     인원: 0명 ${band(0, 0)} · 1~4명 ${band(1, 4)} · 5~9명 ${band(5, 9)}`
      + ` · 10~49명 ${band(10, 49)} · 50명+ ${band(50, null)} (중앙값 ${maxes[Math.floor(maxes.length / 2)]})`);
  }
}

// 「값이 왜 비는가」 — 입력 공백인지, 애초에 신고가 없는 곳인지 가른다.
// ⚠ 이 구분이 A-6 의 함정이다. 신고 행이 없는 곳을 「직원 0명」으로 읽으면 안 된다.
const h = headcountFor(WH_YEAR);
const filled = new Set([...h.per.keys()]);
const noRows = active.filter((c) => !h.rows.has(c.id));
console.log(`\n■ ${WH_YEAR}년 근로 인원이 비는 까닭`);
row('원천세 신고 행이 있는 곳', h.rows.size, N);
row('  그중 인원이 채워진 곳', filled.size, h.rows.size);
row('  행은 있는데 인원이 빔', h.rows.size - filled.size, N);
row('원천세 행 자체가 없는 곳', noRows.length, N);
console.log(`  행 없는 곳의 수임구분: ${tally(noRows, (c) => filings.find((f) => f.client_id === c.id)?.service_type ?? '(신고행 없음)')}`);
console.log(`     ← 「직원 0명」으로 읽으면 안 된다. 우리가 그 신고를 안 맡았을 뿐일 수 있다`);
row('일용직 인원(cnt_daily) 있음', h.daily.size, N);
row('사업소득 인원(cnt_business) 있음', h.biz.size, N);
console.log(`  인원이 채워진 달: ${Object.entries(h.months).sort().map(([k, v]) => `${k} ${v}`).join(' · ') || '(없음)'}`);

// ── 업력 ─────────────────────────────────────────────────────────────────────
const withOpen = active.filter((c) => c.open_date);
console.log(`\n■ 업력 — open_date 로 계산`);
row('계산 가능', withOpen.length, N);
if (withOpen.length) {
  const years = withOpen.map((c) => (Date.now() - new Date(c.open_date)) / (365.25 * 864e5));
  console.log(`     3년 미만 ${years.filter((y) => y < 3).length}`
    + ` · 3~7년 ${years.filter((y) => y >= 3 && y < 7).length}`
    + ` · 7년 이상 ${years.filter((y) => y >= 7).length}`);
  const noOpen = active.filter((c) => !c.open_date);
  console.log(`     없는 ${noOpen.length}곳: ${tally(noOpen, (c) => c.client_type ?? '(빈값)')}`);
}

// ── 네 축을 모두 갖춘 곳 ─────────────────────────────────────────────────────
const manualYear = new Set(manual.filter((m) => m.tax_year === REV_YEAR).map((m) => m.client_id));
const allFour = active.filter((c) =>
  c.industry_code && c.open_date && (rev.covered.has(c.id) || manualYear.has(c.id)) && filled.has(c.id)).length;
console.log(`\n■ 업종코드 + 업력 + 매출 + 근로자수 네 축을 모두 갖춘 곳: ${allFour}곳 (${pct(allFour, N)})\n`);
