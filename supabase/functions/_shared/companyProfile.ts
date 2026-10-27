// =============================================================================
// 고객사 수치 프로필 — 매출 구간 · 업력 · 근로 인원  (WORK_PLAN.md A-6)
//
// 왜 따로 떼어 놓나:
//   verify-brn(Deno)에서 쓰지만 판정 규칙은 테스트로 묶여 있어야 한다.
//   이 파일은 **순수 함수만** 둔다 — Deno API 도, 네트워크도, import 도 없다.
//   테스트: services/companyProfile.test.ts (vitest)
//
// ⚠ 원본 매출 금액은 이 모듈 밖으로 나가지 않는다. 브라우저로는 **구간만** 내려간다.
//   (A-6 원칙 — 사업자번호와 대표자 성명은 반쯤 공개된 값이라, 그 둘로 들어온 사람에게
//    정확한 매출액까지 알려주지는 않는다)
//
// ⚠ 컬럼 이름 함정: `clients.tax_type` 은 **과세유형**(일반/간이/면세)이고
//   `filings.tax_type` 은 **세목**(부가세/원천세/면세)이다. 글자는 같고 뜻이 다르다.
// =============================================================================

/** 매출 자료가 얼마나 온전한가. `partial`(반쪽)은 금액 판정에 쓰면 안 된다. */
export type RevenueCoverage = 'full' | 'partial' | 'none';

export interface FilingRow {
  id: string;
  /** 세목 — '부가세' | '면세' | '원천세' */
  tax_type: string | null;
  tax_year: number | null;
  /** 부가세는 '1기예정'·'2기확정', 원천세는 '01'~'12'·'연말정산' */
  period_code: string | null;
  /** false = 귀속을 아직 안 고른 줄(수정·기한후). 집계에서 뺀다 */
  period_chosen: boolean | null;
}

export interface ClientFacts {
  /** 과세유형 — '일반' | '간이' | '간이(계산서)' | '면세' … */
  tax_type?: string | null;
  open_date?: string | null;
  close_date?: string | null;
}

export interface RevenueBracket {
  label: string;
  /** 구간 하한(원, 포함) */
  min: number;
  /** 구간 상한(원, 미만). 최상단 구간은 null */
  max: number | null;
}

// ── 매출 구간 ────────────────────────────────────────────────────────────────
// 경계는 **공고가 실제로 거는 선**에서 가져왔다(3억·5억·10억·30억·50억·120억).
// 120억은 소상공인 업종별 상한의 최댓값이다.
// 우리 쪽 분포(2025 귀속 839곳 실측)도 이 선에서 고르게 갈린다 —
//   1억 미만 475 · 1~5억 242 · 5~10억 59 · 10~50억 54 · 50억+ 9
const 억 = 100_000_000;
const BRACKETS: RevenueBracket[] = [
  { label: '1억 미만', min: 0, max: 1 * 억 },
  { label: '1~3억', min: 1 * 억, max: 3 * 억 },
  { label: '3~5억', min: 3 * 억, max: 5 * 억 },
  { label: '5~10억', min: 5 * 억, max: 10 * 억 },
  { label: '10~30억', min: 10 * 억, max: 30 * 억 },
  { label: '30~50억', min: 30 * 억, max: 50 * 억 },
  { label: '50~120억', min: 50 * 억, max: 120 * 억 },
  { label: '120억 이상', min: 120 * 억, max: null },
];

/** 금액 → 구간. 음수·NaN 은 구간을 내지 않는다(모른다). */
export function revenueBracket(amount: number | null | undefined): RevenueBracket | undefined {
  if (amount == null || !Number.isFinite(amount) || amount < 0) return undefined;
  return BRACKETS.find((b) => b.max == null || amount < b.max);
}

// ── 업력 ─────────────────────────────────────────────────────────────────────

/**
 * 개업일 → 만 년수. 개업일이 없거나 이상하면 undefined(= 모른다).
 * 미래 날짜도 undefined — 잘못 들어간 값으로 "업력 0년"을 만들지 않는다.
 */
export function businessYears(openDate: string | null | undefined, now: Date = new Date()): number | undefined {
  if (!openDate) return undefined;
  const d = new Date(String(openDate));
  if (Number.isNaN(d.getTime())) return undefined;
  let years = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years--;
  return years < 0 ? undefined : years;
}

// ── 매출 「온전함」 판정 ──────────────────────────────────────────────────────
// ⚠ 이 규칙은 dh-platform `src/lib/filings.ts` 의 **`incomeCoverageMap()` 과 같은 규칙**이다.
//   (저장소가 달라 import 할 수 없다.) **두 곳이 어긋나면 dh-platform 쪽이 맞다.**
//   근거: shared-db `supabase/migrations/20260917_client_annual_revenue.sql` 주석
//     · 일반과세 — 1기·2기가 둘 다 있어야 온전. 예정·확정 중 아무거나 있으면 그 반기는 있는 것
//     · 간이과세 — 연 1건이 정상 (부가가치세법 제5조 제1항 제1호, 과세기간 1/1~12/31)
//     · 면세     — 연 1건. 단 **부가세 신고가 하나도 없을 때만** 온전 (겸영 때문)
//     · 그 해 개업 전·폐업 후인 반기는 비어 있는 게 정상이라 「빠졌다」고 세지 않는다

/** 그 해 그 반기에 신고가 있어야 정상인가 (개업 전·폐업 후면 없는 게 정상) */
function halfExpected(c: ClientFacts, year: number, half: 1 | 2): boolean {
  const from = half === 1 ? `${year}-01-01` : `${year}-07-01`;
  const to = half === 1 ? `${year}-06-30` : `${year}-12-31`;
  if (c.open_date && c.open_date > to) return false;
  if (c.close_date && c.close_date < from) return false;
  return true;
}

export interface RevenueFromFilings {
  coverage: RevenueCoverage;
  /** 과세표준 + 면세수입금액 합계(원). coverage 가 'none' 이면 undefined */
  amount?: number;
}

/**
 * 한 해의 신고자료에서 매출과 그 온전함을 낸다.
 * @param vatBase    filing_id → filing_vat.tax_base
 * @param exemptBase filing_id → filing_exempt.income_amount
 */
export function revenueFromFilings(
  year: number,
  client: ClientFacts,
  filings: FilingRow[],
  vatBase: Map<string, number | null>,
  exemptBase: Map<string, number | null>,
): RevenueFromFilings {
  const halves = new Set<1 | 2>();
  let sum = 0;
  let hasVat = false;
  let hasExempt = false;

  for (const f of filings) {
    if (f.tax_year !== year) continue;
    if (f.period_chosen === false) continue;   // 귀속 미확정 줄은 뺀다
    if (f.tax_type === '부가세') {
      const amount = vatBase.get(f.id);
      if (amount == null) continue;
      hasVat = true;
      sum += Number(amount);
      const code = String(f.period_code ?? '');
      if (code.startsWith('1기')) halves.add(1);
      else if (code.startsWith('2기')) halves.add(2);
    } else if (f.tax_type === '면세') {
      const amount = exemptBase.get(f.id);
      if (amount == null) continue;
      hasExempt = true;
      sum += Number(amount);
    }
  }

  // 면세 — 부가세 신고가 하나도 없을 때만 한 건으로 온전
  if (!hasVat && hasExempt) return { coverage: 'full', amount: sum };
  // 간이 — 연 1건이 정상
  if ((client.tax_type ?? '').startsWith('간이')) {
    return halves.size > 0 ? { coverage: 'full', amount: sum } : { coverage: 'none' };
  }
  if (halves.size === 0) return { coverage: 'none' };
  const expected: (1 | 2)[] = ([1, 2] as const).filter((h) => halfExpected(client, year, h));
  const missing = expected.filter((h) => !halves.has(h));
  return missing.length === 0 ? { coverage: 'full', amount: sum } : { coverage: 'partial', amount: sum };
}

export interface ManualRevenueRow {
  tax_year: number | null;
  revenue_amount: number | null;
  source: string | null;
}

export interface RevenueResult {
  year?: number;
  bracket?: RevenueBracket;
  coverage: RevenueCoverage;
  /** '신고' = 부가세·면세 신고자료 계산값, '수기' = client_annual_revenue 보충분 */
  basis?: '신고' | '수기';
}

/**
 * 쓸 수 있는 매출을 고른다. 최근 연도부터 훑어, **온전한 해를 먼저** 쓴다.
 *
 * 순서가 중요하다 — 2025년이 반쪽이고 2024년이 온전하면 2024년을 쓰는 게 낫다.
 * 반쪽 금액으로 「매출 10억 미만」을 통과시키면 그대로 틀린 안내가 나간다.
 * 어느 해도 온전하지 않으면 가장 최근의 반쪽을 `partial` 로 돌려준다 —
 * 화면에서 「확인 필요」로 표시하라는 뜻이지, 거르라는 뜻이 아니다.
 */
export function pickRevenue(
  years: number[],
  client: ClientFacts,
  filings: FilingRow[],
  vatBase: Map<string, number | null>,
  exemptBase: Map<string, number | null>,
  manual: ManualRevenueRow[] = [],
): RevenueResult {
  let fallback: RevenueResult | undefined;

  for (const year of years) {
    // 수기 보충분이 있으면 그 해는 그것으로 온전하다 — 신고자료가 없는 해를 채우려고 만든 표다
    const hand = manual.find((m) => m.tax_year === year && m.revenue_amount != null);
    if (hand) {
      return { year, bracket: revenueBracket(hand.revenue_amount), coverage: 'full', basis: '수기' };
    }
    const r = revenueFromFilings(year, client, filings, vatBase, exemptBase);
    if (r.coverage === 'full') {
      return { year, bracket: revenueBracket(r.amount), coverage: 'full', basis: '신고' };
    }
    if (r.coverage === 'partial' && !fallback) {
      fallback = { year, bracket: revenueBracket(r.amount), coverage: 'partial', basis: '신고' };
    }
  }
  return fallback ?? { coverage: 'none' };
}

// ── 근로 인원 ────────────────────────────────────────────────────────────────

export interface HeadcountResult {
  /** 가장 최근 달의 근로소득 원천징수 인원. **모르면 undefined — 0 으로 채우지 않는다** */
  count?: number;
  /** 그 값이 어느 해 몇 월치인가 */
  year?: number;
  month?: number;
  /** 그 해에 인원이 기록된 달 수. 1~2달뿐이면 대표값으로 보기 약하다 */
  months?: number;
}

/**
 * 가장 최근 달의 근로 인원.
 *
 * ⚠ **원천세 신고 행이 없는 것을 「직원 0명」으로 읽지 않는다.** 신고대리 거래처는
 *   우리가 원천세를 맡지 않았을 뿐이다(382곳 중 236곳). **모르는 것과 없는 것은 다르다.**
 *   그래서 행이 없거나 인원 칸이 비면 `{}` 를 돌려준다 — `count` 가 undefined 다.
 *
 * ⚠ 공고가 말하는 「상시근로자」와 원천세 근로소득 인원은 같은 정의가 아니다. 대략값이다.
 *
 * 연평균이 아니라 **가장 최근 달**을 쓴다 — 반기만 사람을 쓰는 업체에서 평균은 왜곡된다.
 */
export function pickHeadcount(
  filings: FilingRow[],
  wageCount: Map<string, number | null>,
): HeadcountResult {
  let best: { year: number; month: number; count: number } | undefined;
  const monthsByYear = new Map<number, Set<number>>();

  for (const f of filings) {
    if (f.tax_type !== '원천세' || f.tax_year == null) continue;
    if (f.period_chosen === false) continue;
    // '01'~'12' 만 본다. '연말정산' 은 달이 아니다
    const code = String(f.period_code ?? '');
    if (!/^\d{1,2}$/.test(code)) continue;
    const month = Number(code);
    if (month < 1 || month > 12) continue;
    const count = wageCount.get(f.id);
    if (count == null) continue;

    if (!monthsByYear.has(f.tax_year)) monthsByYear.set(f.tax_year, new Set());
    monthsByYear.get(f.tax_year)!.add(month);

    if (!best || f.tax_year > best.year || (f.tax_year === best.year && month > best.month)) {
      best = { year: f.tax_year, month, count: Number(count) };
    }
  }

  if (!best) return {};
  return { count: best.count, year: best.year, month: best.month, months: monthsByYear.get(best.year)?.size };
}
