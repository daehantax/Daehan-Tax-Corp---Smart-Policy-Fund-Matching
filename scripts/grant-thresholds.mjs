// =============================================================================
// 공고 본문에서 자격 기준선 숫자를 뽑는다 — 매출액 · 업력 · 근로자수
//
// 왜: A-6 으로 **우리 쪽 값**(매출 구간·업력·인원)은 들어왔는데 비교할 상대가 없다.
//   공고에는 「조건:매출액」 같은 꼬리표만 있고 **몇 억인지가 없다.**
//   중소벤처24가 구조화된 숫자를 줄 줄 알았으나 전부 빈 칸이었다(C-8).
//   남은 길은 본문뿐이다 — 본문은 99.8% 들어오고 중앙값 458자다.
//
// 설계 원칙 (CLAUDE.md 「깨뜨리면 안 되는 것」):
//   **확실하지 않으면 뽑지 않는다.** 숫자를 잘못 읽어 자격 있는 공고를 지우는 쪽이
//   훨씬 나쁘다. 그래서 **단위가 맞고 키워드에 붙어 있을 때만** 값을 낸다.
//   못 읽으면 지금처럼 「공고문 확인 필요」로 남는다 — 그게 안전한 기본값이다.
//
// 오탐(誤探)이 나기 쉬운 자리 — 실제 공고에서 관찰한 것들:
//   · 금액인데 매출이 아닌 것 — "공사금액 7억 미만", "월 임차료 30만원 이상"
//   · 햇수인데 업력이 아닌 것 — "대표자 연령이 만 55세 이상", "설립 10년 이상 노후 시설"
//   · 인원인데 근로자수가 아닌 것 — "만 15-34세", "40~64세 서울시민"
//   · 기준선이 아니라 계산식 — "연 매출액이 기준 피보험자 수x1,900만원 이상인 기업"
//   그래서 **키워드 바로 뒤 좁은 창**만 보고, 단위가 어긋나면 버린다.
// =============================================================================

/** 한글 금액 한 덩어리 → 원. '3억5천만' → 350000000, '1천2백만' → 12000000 */
function parseKoreanAmount(text) {
  const s = String(text).replace(/[\s,]/g, '');
  if (!s) return null;
  // 숫자만 있으면 그대로 원 단위로 본다 ('1900만' 같은 건 아래에서 처리)
  if (/^\d+$/.test(s)) return Number(s);

  const UNITS = [['조', 1e12], ['억', 1e8], ['만', 1e4]];
  let total = 0;
  let rest = s;
  let matched = false;

  for (const [unit, mul] of UNITS) {
    const i = rest.indexOf(unit);
    if (i < 0) continue;
    const head = rest.slice(0, i);
    rest = rest.slice(i + 1);
    // '3', '1천2백' 같은 앞부분
    const n = parseSmall(head);
    if (n == null) return null;
    total += n * mul;
    matched = true;
  }
  if (rest) {
    const n = parseSmall(rest);
    if (n == null) return null;
    total += n;
    matched = true;
  }
  return matched ? total : null;
}

/** '1천2백', '5천', '400', '' → 숫자. 빈 문자열은 1로 본다('억' 앞이 비면 1억) */
function parseSmall(text) {
  const s = String(text);
  if (!s) return 1;
  if (/^\d+$/.test(s)) return Number(s);
  const SMALL = [['천', 1000], ['백', 100], ['십', 10]];
  let total = 0;
  let rest = s;
  for (const [unit, mul] of SMALL) {
    const i = rest.indexOf(unit);
    if (i < 0) continue;
    const head = rest.slice(0, i);
    rest = rest.slice(i + 1);
    if (head && !/^\d+$/.test(head)) return null;
    total += (head ? Number(head) : 1) * mul;
  }
  if (rest) {
    if (!/^\d+$/.test(rest)) return null;
    total += Number(rest);
  }
  return total;
}

// ── 공통 ─────────────────────────────────────────────────────────────────────

/** 방향어 → 경계의 성격. '이하'·'이내'는 상한, '이상'은 하한 */
const UPPER = /^(이하|미만|이내|까지)/;
const LOWER = /^(이상|초과|부터)/;

/**
 * 창 안에서 「숫자 + 단위 + 방향어」를 전부 찾아 하한·상한으로 모은다.
 * @param window   키워드 뒤 좁은 문자열
 * @param numberRe 숫자+단위를 잡는 정규식. 첫 캡처가 숫자 덩어리여야 한다
 * @param toValue  숫자 덩어리 → 값
 */
function boundsIn(window, numberRe, toValue) {
  let min = null, max = null;
  const re = new RegExp(numberRe.source, 'g');
  const hits = [];
  let m;
  while ((m = re.exec(window)) !== null) {
    const value = toValue(m[1]);
    if (value == null) continue;
    const after = window.slice(m.index + m[0].length).replace(/^[\s)\]」』]*/, '');
    hits.push({ value, after, index: m.index });
  }
  if (hits.length === 0) return null;

  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (UPPER.test(h.after)) { max = max == null ? h.value : Math.min(max, h.value); continue; }
    if (LOWER.test(h.after)) { min = min == null ? h.value : Math.max(min, h.value); continue; }
    // 'A~B 미만' / 'A ~ B 이하' — 방향어가 뒤쪽 숫자에만 붙는다. 앞 숫자는 하한이다
    if (/^\s*[~∼-]/.test(h.after) && hits[i + 1]) {
      const next = hits[i + 1];
      if (UPPER.test(next.after)) {
        min = min == null ? h.value : Math.max(min, h.value);
      }
    }
  }
  if (min == null && max == null) return null;
  if (min != null && max != null && min > max) return null;   // 읽기를 잘못한 것이다. 버린다
  return { min, max };
}

/**
 * 키워드가 나오는 자리마다 그 뒤 창을 잘라 준다.
 *
 * ⚠ 창은 **절 경계에서 끊는다.** 안 끊으면 다음 항목의 숫자가 딸려 들어온다 —
 *   "매출액 5천만원 이하 - 월 임차료 30만원 이상" 에서 30만원이 매출 하한이 돼 버렸다.
 *   끊는 자리: 띄어쓴 붙임표( - ), ※, 줄바꿈, 다음 항목을 여는 ①②③.
 *   범위의 물결표(~)와 '5-300' 처럼 붙여 쓴 붙임표는 끊지 않는다.
 */
const CLAUSE_BREAK = /\s[-–—]\s|※|\n|[①②③④⑤⑥⑦⑧⑨⑩]/;
/**
 * 읽지 말아야 할 자리.
 *
 * ① 우대·가점 — "(창업 7년 미만 기업 **우대**)" 는 자격이 아니라 가점이다.
 *    조건으로 읽으면 7년 넘은 기업에게 자격 없다는 신호가 간다.
 * ② 선택 조건 뒤 — "아래 조건 중 **한가지 이상** 해당 - … - 새일센터를 통해 창업한
 *    기업(창업 후 1년 이내)" 에서 1년은 **여러 갈래 중 하나**지 모두에게 걸리는 조건이 아니다.
 *    키워드가 이 말 **뒤에** 나오면 읽지 않는다(앞에 나오면 공통 조건이므로 읽는다).
 */
const PREFERENCE = /우대|가점|우선\s*선정|권장|우선지원\s*대상/;
const ANY_OF_BEFORE = /한\s*가지\s*이상|어느\s*하나에\s*해당|다음\s*중\s*하나|중\s*하나에\s*해당|택\s*1/;

function* windowsAfter(text, keywordRe, size) {
  const re = new RegExp(keywordRe.source, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    if (ANY_OF_BEFORE.test(text.slice(0, m.index))) continue;
    const raw = text.slice(m.index + m[0].length, m.index + m[0].length + size);
    if (PREFERENCE.test(raw)) continue;
    const cut = raw.search(CLAUSE_BREAK);
    yield cut >= 0 ? raw.slice(0, cut) : raw;
  }
}

/**
 * 여러 창에서 나온 경계를 하나로 — **넓은 쪽**을 택한다(하한은 작은 값, 상한은 큰 값).
 *
 * ⚠ 좁은 쪽을 택하면 오탐(誤探)이 난다. 실제로 그랬다:
 *   "광업ㆍ제조업ㆍ건설업ㆍ운수업 : 상시종업원 10인 미만 / 그 외의 업종 : 5인 미만"
 *   → 좁게 합치면 상한 5가 되어, **직원 7명인 제조업체에게 자격 없다는 신호**가 간다.
 *   업종별로 기준이 갈리는 공고가 흔하므로 넓게 잡고, 나머지는 공고문을 보게 한다.
 *   (CLAUDE.md — "확실하지 않으면 제외하지 않는다")
 *
 * 한 창 안에서는 좁게 모은다 — 같은 절의 "5인 이상 300인 미만"은 하나의 조건이다.
 */
function mergeBounds(list) {
  const got = list.filter(Boolean);
  if (got.length === 0) return null;
  let min = null, max = null;
  for (const b of got) {
    if (b.min != null) min = min == null ? b.min : Math.min(min, b.min);
    if (b.max != null) max = max == null ? b.max : Math.max(max, b.max);
  }
  // 하한이 상한 이상이면 읽기를 잘못한 것이다. 실제 사례:
  //   "근로자 5인 미만 기업(70%), 5인 이상 기업(30%)" → 배분 비율이지 기준선이 아니다
  if (min != null && max != null && min >= max) return null;
  return { min, max };
}

// ── 매출액 ───────────────────────────────────────────────────────────────────
// '연매출 10억원 이하' · '매출액 3억5천만원 이하' · '총매출액 5억 이하'
// '1천2백만원 이상 6억원 이하' · '매출액 120억원 미만'
//
// ⚠ '매출' 바로 뒤만 본다. '공사금액 7억 미만', '월 임차료 30만원 이상' 같은 다른 금액이
//   같은 문장에 흔히 섞여 있다.
const REVENUE_KEY = /(?:연\s*)?(?:총|평균)?\s*매출(?:액)?(?:이|은|가)?/;
const REVENUE_NUM = /([\d,]+(?:억|조)?(?:\s*[\d,]*(?:천|백|십)?)*(?:만)?)\s*원?/;

/** 금액 토큰 → 원. '원'이 없고 '억/만'도 없는 맨숫자는 버린다(연도·점수와 구분이 안 된다) */
function toWon(token) {
  const s = String(token).replace(/\s/g, '');
  if (!/[억조만천백십]/.test(s)) return null;   // '2025' 같은 맨숫자는 금액으로 읽지 않는다
  return parseKoreanAmount(s);
}

/**
 * ⚠ **기간이 한정된 매출은 쓰지 않는다.** 우리 쪽 값은 연매출(1년치)이라 바로 비교하면
 *   오탐(誤探)이 난다. 실제 사례 — "2026년 상반기(1~6월) 매출액 5천만원 이하" 를 연매출로
 *   읽으면 연 8천만원(반기 4천만원)인 가게가 자격 없다고 걸러진다.
 */
//   앞 조각이 '월' 로 끝나는 경우까지 본다 — 키워드가 '평균 매출액'부터 잡혀
//   "월 평균 매출액" 의 앞에는 '월 ' 만 남기 때문이다
const PARTIAL_PERIOD = /상반기|하반기|분기|개월|월\s*평균|월\s*매출|월\s*$/;

export function extractRevenue(text) {
  const t = String(text || '');
  // 계산식은 기준선이 아니다 — "기준 피보험자 수x1,900만원 이상"
  if (/매출[^.]{0,40}[x×]\s*[\d,]/.test(t)) return null;
  const out = [];
  const re = new RegExp(REVENUE_KEY.source, 'g');
  let m;
  while ((m = re.exec(t)) !== null) {
    // ⚠ 키워드 앞 25자에 기간 한정이 있으면 연매출이 아니다
    if (PARTIAL_PERIOD.test(t.slice(Math.max(0, m.index - 25), m.index))) continue;
    if (ANY_OF_BEFORE.test(t.slice(0, m.index))) continue;
    const raw = t.slice(m.index + m[0].length, m.index + m[0].length + 40);
    if (PREFERENCE.test(raw)) continue;
    const cut = raw.search(CLAUSE_BREAK);
    out.push(boundsIn(cut >= 0 ? raw.slice(0, cut) : raw, REVENUE_NUM, toWon));
  }
  return mergeBounds(out);
}

// ── 업력 ─────────────────────────────────────────────────────────────────────
// '업력 3년 이상' · '창업 7년 미만' · '창업 3년 이내' · '업력 6개월 이상' · '창업 후 1년이상'
//
// ⚠ '설립 10년 이상 노후 시설'(시설 나이), '대표자 연령이 만 55세 이상'(사람 나이)과
//   섞이지 않게 **단위가 년·개월일 때만** 받는다. '세'는 받지 않는다.
const AGE_KEY = /(?:업력|창업(?:\s*후)?|설립(?:\s*후)?|개업(?:\s*후)?|영업)(?:이|은|을|한지)?(?:\s*만)?/;
const AGE_NUM = /([\d,]+)\s*(년|개월)/;

/** 방향어 바로 뒤가 이것들이면 기업의 업력이 아니라 **물건의 나이**다 */
const AGE_THING = /시설|설비|건물|장비|기계|차량|선박|점포/;
const AGE_NOISE = /^(?:이상|이하|미만|이내|초과)?\s*(?:된\s*)?(?:노후\s*)?(?:시설|설비|건물|장비|기계|차량|선박|점포)/;

/** '3년' → 3, '6개월' → 0.5 */
function toYears(token, unit) {
  const n = Number(String(token).replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return unit === '개월' ? n / 12 : n;
}

/**
 * 숫자가 키워드 **앞**에 오는 꼴 — "7년 미만 **창업**기업", "7 년 이내 **창업**자".
 * 흔한 표현이라 놓치면 업력 회수율이 크게 떨어진다.
 * 숫자-방향어-키워드가 **붙어 있을 때만** 받는다. 떨어져 있으면 남의 숫자일 수 있다.
 */
//   "7년 미만 **기술기반** 창업기업" 처럼 수식어가 끼는 일이 흔해 한 덩어리까지 허용한다.
//   대신 그 틈에 물건 이름이 있으면 버린다 — "10년 이상 노후 시설" 의 10년은 업력이 아니다.
const AGE_BEFORE = /([\d,]+)\s*(년|개월)\s*(이내|미만|이상|초과)\s*((?:[가-힣A-Za-z·ㆍ]{1,10}\s+)?)(?:창업|업력|설립|개업)/g;

export function extractBusinessYears(text) {
  const t = String(text || '');
  const out = [];
  const pre = new RegExp(AGE_BEFORE.source, 'g');
  let pm;
  while ((pm = pre.exec(t)) !== null) {
    if (ANY_OF_BEFORE.test(t.slice(0, pm.index))) continue;
    if (PREFERENCE.test(t.slice(pm.index, pm.index + pm[0].length + 12))) continue;
    if (AGE_THING.test(pm[4] ?? '')) continue;
    const v = toYears(pm[1], pm[2]);
    if (v == null) continue;
    out.push(UPPER.test(pm[3]) ? { min: null, max: v } : { min: v, max: null });
  }
  for (const w of windowsAfter(t, AGE_KEY, 24)) {
    // 단위를 함께 봐야 해서 boundsIn 을 쓰지 않고 직접 훑는다
    let min = null, max = null;
    const re = new RegExp(AGE_NUM.source, 'g');
    let m;
    while ((m = re.exec(w)) !== null) {
      const v = toYears(m[1], m[2]);
      if (v == null) continue;
      const after = w.slice(m.index + m[0].length).replace(/^[\s)\]]*/, '');
      // ⚠ "설립 10년 이상 **노후 시설**을 보유한" — 시설의 나이지 기업의 업력이 아니다
      if (AGE_NOISE.test(after)) continue;
      if (UPPER.test(after)) max = max == null ? v : Math.min(max, v);
      else if (LOWER.test(after)) min = min == null ? v : Math.max(min, v);
    }
    out.push(min == null && max == null ? null : { min, max });
  }
  return mergeBounds(out);
}

// ── 근로자수 ─────────────────────────────────────────────────────────────────
// '상시근로자 5인 이상 300인 미만' · '상시근로자 수 5~300인 미만' · '상시종업원 10인 미만'
// '고용 10인미만' · '고용보험 피보험자 10인 이상' · '근로자수가 5인 이상'
//
// ⚠ 단위가 '인·명'일 때만 받는다. '만 15-34세', '40~64세' 같은 나이와 섞이면 안 된다.
const EMP_KEY = /(?:상시\s*)?(?:근로자|종업원|피보험자|고용(?:보험)?(?:\s*피보험자)?|직원)\s*(?:수|인원)?(?:가|는|이|은)?/;
const EMP_NUM = /([\d,]+)\s*(?:인|명)/;

/** '5~300인 미만' 처럼 **앞 숫자에 단위가 없는** 범위꼴. 앞이 하한, 뒤가 상한이다 */
const EMP_RANGE = /([\d,]+)\s*[~∼]\s*([\d,]+)\s*(?:인|명)\s*(?:이하|미만)/;

export function extractEmployees(text) {
  const t = String(text || '');
  const out = [];
  for (const w of windowsAfter(t, EMP_KEY, 28)) {
    const r = w.match(EMP_RANGE);
    if (r) out.push({ min: Number(r[1].replace(/,/g, '')), max: Number(r[2].replace(/,/g, '')) });
  }
  for (const w of windowsAfter(t, EMP_KEY, 28)) {
    out.push(boundsIn(w, EMP_NUM, (x) => {
      const n = Number(String(x).replace(/,/g, ''));
      return Number.isFinite(n) ? n : null;
    }));
  }
  return mergeBounds(out);
}

// ── 묶음 ─────────────────────────────────────────────────────────────────────

/**
 * 자격 문단에서 세 축의 기준선을 뽑는다.
 * 못 읽은 축은 키가 없다 — **못 읽은 것과 「제한 없음」은 다르다.**
 *
 * @returns {{ revenue?: {min:number|null,max:number|null},
 *             years?:   {min:number|null,max:number|null},
 *             employees?: {min:number|null,max:number|null} }}
 */
export function extractThresholds(eligibilityText) {
  const out = {};
  const revenue = extractRevenue(eligibilityText);
  const years = extractBusinessYears(eligibilityText);
  const employees = extractEmployees(eligibilityText);
  if (revenue) out.revenue = revenue;
  if (years) out.years = years;
  if (employees) out.employees = employees;
  return out;
}
