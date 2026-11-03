// =============================================================================
// 공고에서 「제외 업종」을 읽는다 (WORK_PLAN.md C-12)
//
// 왜: C-11 실측 — 첨부 글자로 **기준선 숫자는 한 건도** 더 못 읽었는데,
//   제외 업종 목록은 **140건**에서 나왔다. 그리고 이건 우리 거래처에 실제로 걸린다 —
//   영업 중인 1,483곳 중 **377곳(25.4%)** 이 어딘가의 제외 목록에 오르는 업종이다
//   (부동산임대 318 · 부동산중개 45). 넷 중 하나가 자격 없는 공고를 추천받고 있었다.
//
// 설계 원칙 (CLAUDE.md 「깨뜨리면 안 되는 것」):
//   **제외(`score 0`)는 하지 않는다.** 제외는 지역·시·군에서만 한다.
//   여기서 찾은 것은 **경고**로만 쓴다 — 「이 공고는 부동산 임대업을 제외합니다」.
//
// 오탐(誤探)이 나기 쉬운 자리 — 실제 공고에서 관찰한 것들:
//   · 「지원 제외 **대상**」은 업종 제외가 아니다 — 서류 미비·중복 수혜·허위 기재가 대부분
//   · 업종코드가 적혀 있어도 제외가 아닐 수 있다 — 「환경설비 건설업(41224)」은 지원 대상이다.
//     그래서 **제외 문단 안**에 있는 것만 가져온다
//   · ⭐ **제외 목록 안에 「단, ○○은 지원 가능」이라는 예외가 들어 있다.** 이게 제일 위험하다:
//       「금융 및 보험업(단, 핀테크 기업 중 그 외 기타 금융 지원 서비스업(66199)은 지원 가능)」
//       「단, 보건업(86) 중 유사의료업(86902)은 신청가능」
//     예외를 못 보면 **자격 있는 거래처에게 「제외 업종」 경고가 나간다.** 반드시 거른다
//   · 「도박기계 및 사행성 오락기구 **제조업**」은 사행시설업이 아니다 — 제조업이다
// =============================================================================

import { sectorsOfKsic, sectorsOfName, SECTORS } from './industry-sectors.mjs';

/** 제외 문단이 시작하는 자리 */
const EXCLUDE_START = /(제외\s*업종|지원\s*제외\s*(?:업종|대상)|융자\s*제외\s*(?:대상\s*)?업종|신청\s*제외\s*업종|제외\s*대상\s*업종|지원\s*불가\s*업종|신청\s*불가\s*업종|참여\s*제외|선정\s*제외|지원\s*제외|보조금\s*제외)/g;

/** 지원 **대상** 문단. 여기 있는 업종은 제외가 아니라 그 사업의 주제다 */
const TARGET_START = /(지원\s*대상|신청\s*자격|지원\s*자격|모집\s*대상|대상\s*기업)/g;

/** 다음 항목으로 넘어가는 표시 */
const SECTION_BREAK = /\n\s*(?:[0-9]{1,2}\s*[.)]|[□■◇◆▣Ⅰ-Ⅹ]|[가-하]\s*[.)])\s*\S/;

/** 제외 문단 하나의 최대 길이. 별표는 길지만 너무 길면 딴 장까지 먹는다 */
const WINDOW = 1200;

/** 표준 제외 목록을 참조하는 공고 — 목록 자체는 대개 별첨에 따로 있다 */
const STANDARD_LIST = /(중소기업|소상공인)\s*정책자금\s*융자\s*?제외\s*(?:대상\s*)?업종|융자제외\s*대상\s*업종/;

/**
 * 공고가 업종코드를 적는 두 가지 꼴. **둘 다 봐야 한다.**
 *   ① 「일반유흥주점업(56211)」 — 본문에 섞여 나올 때
 *   ② 「56211 일반유흥주점업」  — **별표의 표가 이 꼴이다.** 줄 맨 앞에 코드가 온다
 * ①만 보던 때는 괄호가 붙는 것이 대개 「단, …(68221)은 가능」인 **허용 항목**뿐이라,
 * 정작 제외된 코드는 하나도 못 모았다(실측).
 */
const NAMED_KSIC = /([가-힣][가-힣\s·ㆍ,]{1,24}업)\s*\(\s*(\d{5})\s*\)/g;
const KSIC_NAMED = /(?:^|\n)[\s*\-·]*(\d{5})\s*(?:중|中)?\s*([가-힣][가-힣\s·ㆍ,]{1,24}업)/g;

/**
 * **예외 조항** — 제외 목록 안인데도 「지원 가능」하다고 적힌 자리.
 * 코드·업종명 바로 뒤 40자 안에 나오면 그건 제외가 아니라 **허용**이다.
 */
const ALLOWED_AFTER = /^[^.。\n]{0,40}?(?:지원|신청|융자)?\s*가능/;

/**
 * 허용 목록이 **앞에서** 시작하는 꼴 — 이게 제일 흔하고 제일 위험하다:
 *
 *   68
 *   부동산업                                   ← 제외
 *   * 단, 아래의 업종은 신청 가능                 ← 여기서 허용 목록이 열린다
 *   - 부동산관리업(6821)                        ← 허용
 *   - 신청일 기준 … 부동산 중개·대리업(68221)      ← 허용
 *   - 비거주용건물임대업(68112) 중 공유오피스…      ← 허용
 *   76390 中 도박기계 … 임대업                   ← 다시 제외
 *
 * 「가능」이 목록 **앞**에 있어서 뒤만 보는 검사로는 못 잡는다.
 * 그렇다고 앞쪽을 글자 수로 되돌아보면 목록이 끝난 뒤의 제외 항목까지 허용으로 읽는다
 * (실측 — 그렇게 했더니 「부동산업 제외」가 통째로 사라졌다).
 *
 * **줄 구조를 쓴다.** 실제 추출 글자에 줄바꿈이 살아 있고, 허용 항목은 `-`·`*` 로
 * 시작하거나 앞 줄에서 이어지는 반면, 제외 항목은 **숫자(분류코드)로 시작한다.**
 * 그래서 허용 목록은 머리글 줄부터 **숫자로 시작하는 줄 직전까지**다.
 */
const ALLOW_HEADER = /(?:단,?|다만|※|\*)[^\n]{0,40}?(?:지원|신청|융자)?\s*가능/g;
/** 다음 제외 항목이 시작하는 줄 — 분류코드(숫자)나 글머리 기호 */
const NEXT_EXCLUSION_LINE = /^\s*(?:\d|[□■◇◆▣])/;

/** 허용 목록이 차지하는 구간들을 [시작, 끝) 로 돌려준다 */
function allowSpans(chunk) {
  const spans = [];
  ALLOW_HEADER.lastIndex = 0;
  for (const m of chunk.matchAll(ALLOW_HEADER)) {
    let cursor = chunk.indexOf('\n', m.index + m[0].length);
    if (cursor < 0) { spans.push([m.index, chunk.length]); continue; }
    let end = cursor;
    while (cursor >= 0) {
      const next = chunk.indexOf('\n', cursor + 1);
      const line = chunk.slice(cursor + 1, next < 0 ? chunk.length : next);
      if (NEXT_EXCLUSION_LINE.test(line)) break;
      end = next < 0 ? chunk.length : next;
      if (next < 0) break;
      cursor = next;
    }
    spans.push([m.index, end]);
  }
  return spans;
}

const insideAllowList = (spans, index) => spans.some(([a, b]) => index >= a && index < b);

/**
 * **매출 기준표** — 업종 이름이 나와도 제외 목록이 아니다.
 *   「부동산업, 전문·과학 및 기술 서비스업 등 **10억원 이하**」는 소상공인 범위 기준이다.
 * 업종 이름 둘레에 금액 기준이 붙어 있으면 버린다(실측 — 14건 검수 중 1건이 이것이었다).
 */
const SIZE_TABLE = /\d+\s*억원?\s*(?:이하|미만|이상)|매출액?\s*(?:기준|규모)/;

/** 표시한 자리부터 다음 항목 전까지(최대 WINDOW)를 잘라 낸다 */
function windowsAt(text, re) {
  const out = [];
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    const from = m.index + m[0].length;
    const rest = text.slice(from, from + WINDOW);
    const n = rest.search(SECTION_BREAK);
    out.push(rest.slice(0, n > 40 ? n : WINDOW));
  }
  return out;
}

/**
 * 글 한 덩어리에서 꼬리표를 모은다.
 * 꼬리표마다 어떤 KSIC 코드에서 왔는지 함께 들고 다닌다 —
 * 나중에 꼬리표를 버릴 때 **코드도 같이 버려야** 둘이 어긋나지 않는다.
 */
function sectorsIn(chunk) {
  const found = new Map();   // tag -> Set(ksic)
  const spans = allowSpans(chunk);
  const add = (tag, code) => {
    if (!found.has(tag)) found.set(tag, new Set());
    if (code) found.get(tag).add(code);
  };

  // 「업종명(코드)」와 「코드 업종명」 둘 다 — 앞의 것은 [1]=이름 [2]=코드, 뒤는 그 반대다
  for (const [re, nameAt, codeAt] of [[NAMED_KSIC, 1, 2], [KSIC_NAMED, 2, 1]]) {
    for (const m of chunk.matchAll(re)) {
      // 코드 바로 뒤가 「…은 지원 가능」이면 **제외가 아니라 허용**이다
      if (ALLOWED_AFTER.test(chunk.slice(m.index + m[0].length))) continue;
      if (insideAllowList(spans, m.index)) continue;
      const byCode = sectorsOfKsic(m[codeAt]);
      const byName = sectorsOfName(m[nameAt]);
      // 코드와 이름이 같은 것을 가리킬 때만 코드를 믿는다. 어긋나면 이름이 잘린 것이다
      for (const t of (byCode.length ? byCode : byName)) add(t, m[codeAt]);
    }
  }

  // 코드 없이 이름만 적힌 목록 — 「유흥·사치향락·투기업종, 부동산임대업」
  // 별표는 대분류로 적는 일이 많아(「부동산업 68 부동산업 전부」) division 도 함께 본다
  for (const s of SECTORS) {
    // ⚠ **모든 자리를** 본다. 첫 자리만 보면 그게 허용 목록 안일 때 뒤의 진짜 제외를 놓친다
    //   (실측 — 긴 별표에서 「부동산업」이 허용 단서에 먼저 걸려 제외가 통째로 사라졌다).
    for (const re of [s.name, s.division]) {
      if (!re) continue;
      for (const hit of chunk.matchAll(new RegExp(re.source, 'g'))) {
        const after = chunk.slice(hit.index + hit[0].length);
        if (ALLOWED_AFTER.test(after)) continue;
        if (SIZE_TABLE.test(chunk.slice(Math.max(0, hit.index - 40), hit.index + hit[0].length + 40))) continue;
        if (insideAllowList(spans, hit.index)) continue;
        add(s.tag, null);
        break;
      }
      if (found.has(s.tag)) break;
    }
  }
  return found;
}

/**
 * 공고 글에서 제외 업종을 읽는다.
 *
 * @param {string} text 공고 본문 + 첨부에서 뽑은 글자를 이어 붙인 것
 * @returns {{tags: string[], ksic: string[], standardList: boolean} | null}
 *   읽어낸 것이 없으면 **null** — 「제외 업종이 없다」가 아니라 **「모른다」**다.
 */
export function extractExclusions(text) {
  const s = String(text ?? '');
  if (!s.trim()) return null;

  const found = new Map();   // tag -> Set(ksic)
  for (const chunk of windowsAt(s, EXCLUDE_START)) {
    for (const [tag, codes] of sectorsIn(chunk)) {
      if (!found.has(tag)) found.set(tag, new Set());
      for (const c of codes) found.get(tag).add(c);
    }
  }

  // 지원 대상 문단에도 같은 꼬리표가 있으면 버린다.
  // ⚠ 단, 대상 문단은 **첫 「제외」 앞에서 끊는다.** 긴 별표에서는 「지원대상」이라는 말
  //   바로 뒤에 제외표가 이어져서, 창을 그대로 쓰면 제외 업종이 통째로 지워진다(실측).
  for (const chunk of windowsAt(s, TARGET_START)) {
    const cut = chunk.search(/제외|불가/);
    const head = cut >= 0 ? chunk.slice(0, cut) : chunk;
    for (const tag of sectorsIn(head).keys()) found.delete(tag);
  }

  if (found.size === 0) return null;
  const ksic = new Set();
  for (const codes of found.values()) for (const c of codes) ksic.add(c);
  return { tags: [...found.keys()].sort(), ksic: [...ksic].sort(), standardList: STANDARD_LIST.test(s) };
}
