import { BizCategory, Grant, UserSession } from '../types';
import {
  detectZone,
  EXCLUSIVE_ZONES,
  expandSigunguShort,
  isSigungu,
  pickSidoCodes,
  sigunguBelongsTo,
} from './geo';

// ==============================================================================
// 매칭 서비스 — 수파베이스 policy_grants 데이터 기반 공고 매칭
//
// 매칭 기준축 (DB에 저장된 데이터를 최대한 활용):
//   · 지역: region_codes 컬럼 (동기화 시 소관부처·수행기관·해시태그·제목에서 계산)
//   · 시·군: 공고 제목·해시태그에서 계산 (관내 기업만 신청 가능한 기초자치단체 사업)
//   · 분야: category / sub_category 컬럼 (기업마당 표준 분류 = 앱의 BizCategory)
//   · 키워드: 해시태그·사업개요·지원대상에서 계산한 스마트 태그
//   · 시기: end_date(마감일) — 신청 가능 기간이 임박한 공고 우선
//   · 인기: views(기업마당 조회수)
//
// 고객사 정보(업종·지역)는 로그인 시 Edge Function(verify-brn)이
// clients 테이블(업태 biz_type, 주소 address)에서 변환해 내려준 값을 사용합니다.
// ==============================================================================

// 행정구역 사전·판정은 services/geo.ts 로 통합했다 (data/administrative-divisions.json).

// 전국 공고 판정 기준 — 기업마당은 전국 사업의 해시태그에 17개 시도를 전부 나열한다.
// (예: "노사문화 우수기업 … #서울#부산#대구#인천#광주#…#경남#제주")
// 그래서 지역명을 그대로 긁으면 전국 사업이 '17개 지역 전용 공고'로 잡혀
// 카드 지역 배지가 '전국'이 아니라 "서울·부산·대구"로 표시된다.
// 실제 데이터 분포는 1~6개(정상 다지역: 대구·경북, 부산·울산·경남 등) 다음이
// 13개 이상(전국)으로 뚝 끊기므로, 13개 이상이면 전국으로 접는다.
// ※ scripts/sync-bizinfo.mjs 의 같은 규칙과 함께 수정할 것
const NATIONWIDE_MIN_CODES = 13;

/** 지역코드 목록 정리 — 비어 있거나 사실상 전 지역이면 '전국' 하나로 접는다 */
export function normalizeRegionCodes(codes: string[] | undefined): string[] {
  if (!codes || codes.length === 0) return ['전국'];
  if (codes.includes('전국')) return ['전국'];
  return codes.length >= NATIONWIDE_MIN_CODES ? ['전국'] : codes;
}

/**
 * 공고의 표준 지역코드를 판정한다. 판정 순서가 곧 신호의 신뢰도 순서다.
 *
 *  ① 제목·기관·해시태그에서 시도가 1~12개 → 그대로 믿는다
 *     (구체적인 시도 표기가 권역 표현보다 정확하다. "[경기] 수원시ㆍ용인시ㆍ화성시 …
 *      청년일자리도약장려금(수도권형)" 은 '수도권'이 아니라 경기다)
 *  ② 제목의 권역 표현 → 지역코드로 펼친다
 *     "[호남권] …" → 광주·전남·전북 / "[비수도권] …" → 수도권 제외
 *  ③ 해시태그가 전 지역을 나열해(13개 이상) 신뢰할 수 없으면 제목·기관만으로 다시 판정
 *     "강원 영동권 관광 가치이음"(해시태그 16개 시도) → 강원특별자치도경제진흥원 → 강원
 *  ④ 본문의 권역 표현 (제목·기관에 아무 단서가 없을 때만)
 *  ⑤ 전국
 *
 * ①을 ②보다 먼저 보는 이유와 ③을 ①보다 뒤에 두는 이유는 같다 — 기관명이나 권역을
 * 앞세우면 "[대전ㆍ충청]" 같은 권역 사업이 한 지역으로 좁혀져 인접 지역 고객사가
 * 자격 있는 공고를 못 본다(오탐).
 * ※ scripts/sync-bizinfo.mjs 의 extractRegionCodes 와 같은 규칙 — 함께 수정할 것
 */
export function extractRegionCodes(
  department?: string,
  agency?: string,
  hashtagsText?: string,
  title?: string,
  bodyText?: string,
): string[] {
  const all = pickSidoCodes([department, agency, hashtagsText, title].filter(Boolean).join(' '));
  if (all.length > 0 && all.length < NATIONWIDE_MIN_CODES) return all;

  const titleZone = detectZone(title || '');
  if (titleZone) return titleZone;

  const trusted = pickSidoCodes([department, agency, title].filter(Boolean).join(' '));
  if (trusted.length > 0 && trusted.length < NATIONWIDE_MIN_CODES) return trusted;

  const bodyZone = detectZone(bodyText || '');
  if (bodyZone) return bodyZone;

  return ['전국'];
}

/** 공고의 지역코드. DB(region_codes)에 있으면 그 값을, 없으면(CSV 폴백 등) 즉석 계산 */
// DB 값도 normalizeRegionCodes를 거친다 — 동기화 스크립트 수정 전에 저장된
// '17개 지역' 행이 그대로 남아 있어도 화면에서는 전국으로 보이게 하기 위함.
export function getGrantRegions(g: Grant): string[] {
  if (g.regionCodes && g.regionCodes.length > 0) return normalizeRegionCodes(g.regionCodes);
  return extractRegionCodes(g.department, g.agency, (g.hashtags || []).join(' '), g.title);
}

// ── 시·군·구(기초자치단체) 축 ────────────────────────────────────────────────
// 지자체 공고의 상당수는 "관내 소재 기업"만 신청할 수 있는 시·군 전용 사업이다.
//   예) "[경기] 화성시 2026년 중소기업 노동자 기숙사 임차비 지원사업"
//       → 사업개요: "화성시 관내 중소기업 노동자의 …  ☞ 관내 소재 중소 제조기업"
// 같은 경기도라도 성남시 기업은 신청 자격이 없으므로 추천에서 제외해야 한다.
// 제목 맨 앞 "[경기] 화성시 …" / 복수 병기 "[경남] 창원시ㆍ진주시ㆍ거제시 …" 패턴.
// 뒤에 공백·숫자·괄호가 와야 인정한다 ("[경기] 광주시니어…" 같은 오탐 방지)
const TITLE_SIGUNGU = /^\[[^\]]*\]\s*([가-힣]{1,4}(?:시|군|구)(?:\s*[ㆍ·,\/]\s*[가-힣]{1,4}(?:시|군|구))*)(?=[\s0-9([]|$)/;

// 해시태그로 시·군을 인정할 때의 안전장치 (제목 패턴은 신뢰도가 높아 그대로 쓴다).
//   · 태그에 시·군이 3개 이상 나열되면 특정 시·군 전용이 아니라 광역 사업이다.
//     예) [광주] …RISE사업단… → 태그에 동구·서구·남구·북구·광산구 = 광주 전역
//         [경북] 지식재산 긴급지원 → 태그에 경북 8개 시군 나열
//   · '중구·동구·서구·남구·북구'는 여러 도시에 있고 무관한 태그와도 겹치기 쉽다.
//     예) "강소특구" 관련 공고가 '서구' 전용으로 잡히는 오탐 → 태그 경로에서는 제외.
//     이런 공고는 보통 제목에 "[대구] 중구 …"로 적혀 제목 패턴이 잡아준다.
const TAG_SIGUNGU_MAX = 2;

/**
 * 공고의 시·군·구를 추출. 시·군 전용 사업이 아니면 빈 배열.
 * regionCodes 를 넘기면 동명 시·군·구를 시도로 교차 검증한다
 * (중구=서울·부산·대구·대전·울산, 고성군=경남·강원).
 */
export function extractSigunguCodes(
  title?: string,
  hashtagsText?: string,
  regionCodes: string[] = [],
): string[] {
  const found = new Set<string>();
  const accept = (name: string) => {
    if (isSigungu(name) && sigunguBelongsTo(name, regionCodes)) found.add(name);
  };

  const m = (title || '').match(TITLE_SIGUNGU);
  if (m) {
    for (const raw of m[1].split(/[ㆍ·,\/]/)) accept(raw.trim());
  }

  // 해시태그에만 시·군이 있는 공고 보강 (예: 제목엔 없고 태그에 '남양주시').
  // 접미사 없는 표기('강릉'→강릉시)도 인정하되, 시도명과 겹치는 '제주'·'광주'는 geo에서 배제된다.
  const tagTokens = (hashtagsText || '').split(/[,#\/\s]+/).map(t => t.trim()).filter(Boolean);
  const fromTags: string[] = [];
  for (const tok of tagTokens) {
    if (isSigungu(tok)) { fromTags.push(tok); continue; }
    const full = expandSigunguShort(tok, regionCodes);
    if (full) fromTags.push(full);
  }
  if (new Set(fromTags).size <= TAG_SIGUNGU_MAX) {
    for (const tok of fromTags) {
      if (tok.length > 2) accept(tok);  // 2글자 자치구는 태그 경로에서 인정하지 않음
    }
  }

  return [...found];
}

/** 공고의 시·군·구. 매핑 시 계산해 둔 값이 있으면 그 값을, 없으면 즉석 계산 */
export function getGrantSigungu(g: Grant): string[] {
  if (g.sigunguCodes) return g.sigunguCodes;
  return extractSigunguCodes(g.title, (g.hashtags || []).join(' '), getGrantRegions(g));
}

/**
 * 지역코드 하나가 그 공고에 해당하는지.
 * '비수도권'처럼 "그 지역을 제외한 전국"을 뜻하는 권역을 함께 해석한다.
 */
function regionAllows(regions: string[], region: string): boolean {
  if (regions.includes('전국') || regions.includes(region)) return true;
  for (const zone of regions) {
    const excluded = EXCLUSIVE_ZONES[zone];
    if (excluded && !excluded.includes(region)) return true;
  }
  return false;
}

/** 그 공고가 특정 지역 전용이 아니라 "○○ 제외 전국"인지 (배지·근거 표시용) */
function exclusiveZoneOf(regions: string[]): string | null {
  return regions.find(r => EXCLUSIVE_ZONES[r]) ?? null;
}

/** 지역 필터: 전국 사업이거나, 공고 지역에 선택 지역이 포함되면 통과 */
export function matchesRegion(g: Grant, region: string): boolean {
  if (region === '전체' || region === '전국') return true;
  return regionAllows(getGrantRegions(g), region);
}

/** 분야 필터: 대분류(category)에 더해 중분류(subCategory)까지 확인 */
export function matchesCategory(g: Grant, cat: string): boolean {
  if (cat === '전체') return true;
  return g.category.includes(cat) || (g.subCategory || '').includes(cat);
}

export interface MatchResult {
  score: number;       // 0 = 매칭 대상 아님 (다른 지역 전용 등)
  reasons: string[];   // 카드에 표시할 매칭 근거
  warnings?: string[]; // 자격이 의심되는 점 (제외하지는 않고 카드에 주의 표시)
}

// ── 업종 적합성 ─────────────────────────────────────────────────────────────
// 기업마당의 category(금융/기술/경영…)는 업종이 아니라 '지원 성격' 분류다.
// 그래서 예전처럼 업태를 여기에 매핑해 가점하면(부동산업 → '경영') 근거 없는 점수가 붙는다.
// 실제로 부동산 임대업 고객사에게 "스마트제조 AXㆍDX 우수사례 공모전", "경기게임오디션"이
// '경영 분야 +25'로 추천 1·2위에 올라왔다. 그 가점은 제거했다.
//
// 대신 동기화 때 사업개요에서 뽑은 target_flags 로 "업종이 안 맞는다"를 표시한다.
// ⚠ 플래그는 "그 조건이 언급됐다"는 표시일 뿐 "그 업종만 신청 가능"이라는 확정이 아니다.
// 그래서 제외(score 0)하지 않고 감점 + 주의 배지로만 처리한다 — 잘못 제외하면
// 자격 있는 공고가 조용히 사라진다.
const INDUSTRY_MISMATCH_RULES: Array<{ flag: string; fits: RegExp; warning: string }> = [
  { flag: '제조업', fits: /제조/, warning: '제조업 대상 사업' },
  { flag: '공장보유', fits: /제조|건설/, warning: '공장 보유 필요' },
];
const INDUSTRY_MISMATCH_PENALTY = 20;

/** 공고가 우리 업태와 안 맞아 보이는 점들 (제외하지 않고 표시만) */
export function industryWarnings(g: Grant, bizType?: string): string[] {
  const flags = g.targetFlags ?? [];
  if (flags.length === 0) return [];
  const type = (bizType || '').trim();
  if (!type) return [];   // 업태를 모르면 판단하지 않는다
  return INDUSTRY_MISMATCH_RULES
    .filter(r => flags.includes(r.flag) && !r.fits.test(type))
    .map(r => r.warning);
}

/**
 * 고객사 맞춤 점수 계산.
 * "신청 자격이 없는 것"(다른 시·도 / 다른 시·군 전용 공고)은 score 0 으로 제외하고,
 * 나머지는 지역 > 시·군 > 관심 키워드 > 마감 임박 > 인기 순 가중치로 점수화한다.
 * 업종은 가점이 아니라 "안 맞아 보이면 감점 + 주의 표시"로 다룬다 (INDUSTRY_MISMATCH_RULES 참고).
 */
export function scoreGrant(g: Grant, session: UserSession, interests: string[]): MatchResult {
  let score = 0;
  const reasons: string[] = [];
  const regions = getGrantRegions(g);
  const userRegion = session.region && session.region !== '전체' ? session.region : null;

  // 1) 지역 (가중치 최대 40)
  const zone = exclusiveZoneOf(regions);   // '비수도권' 등 "○○ 제외 전국"
  if (userRegion) {
    if (regions.includes(userRegion)) {
      score += 40;
      reasons.push(`${userRegion} 지역 사업`);
    } else if (zone) {
      if (!regionAllows(regions, userRegion)) {
        // 예: 비수도권 사업 + 경기 고객사 — 신청 자격이 없다
        return { score: 0, reasons: [`${zone} 전용`] };
      }
      score += 15;
      reasons.push(`${zone} 사업`);
    } else if (regions.includes('전국')) {
      score += 15;
      reasons.push('전국 사업');
    } else {
      // 다른 지역 전용 공고 — 우리 회사와 무관하므로 매칭에서 제외
      return { score: 0, reasons: [`${regions.join('·')} 지역 전용`] };
    }
  } else if (zone) {
    score += 15;
    reasons.push(`${zone} 사업`);
  } else if (regions.includes('전국')) {
    score += 15;
    reasons.push('전국 사업');
  }

  // 2) 시·군·구 (가중치 20) — 관내 기업만 신청 가능한 기초자치단체 사업 처리
  const grantSigungu = getGrantSigungu(g);
  if (grantSigungu.length > 0) {
    const mySigungu = session.sigungu || [];
    if (mySigungu.length === 0) {
      // 우리 회사 시·군을 모르면(주소가 부실한 경우) 이 축은 적용하지 않는다.
      // 잘못 제외해서 자격 있는 공고를 숨기는 쪽이 더 나쁘다.
    } else if (grantSigungu.some(s => mySigungu.includes(s))) {
      score += 20;
      reasons.push(`${grantSigungu.join('·')} 사업`);
    } else {
      // 다른 시·군 관내 기업 전용 — 신청 자격이 없으므로 제외
      return { score: 0, reasons: [`${grantSigungu.join('·')} 전용`] };
    }
  }

  // 3) 업종 적합성 — 안 맞아 보이면 감점하고 주의 표시 (제외는 하지 않는다)
  const warnings = industryWarnings(g, session.bizType);
  if (warnings.length > 0) score -= INDUSTRY_MISMATCH_PENALTY;

  // 4) 선택한 관심 키워드와 스마트 태그 일치 (키워드당 10, 최대 20).
  //    화면에서는 키워드 일치 공고를 별도 묶음으로 먼저 보여주므로(Dashboard),
  //    이 가점은 묶음 안에서의 순서를 정하는 역할이다.
  const tagOverlap = (g.tags || []).filter(t => interests.includes(t)).length;
  if (tagOverlap > 0) {
    score += Math.min(tagOverlap * 10, 20);
    reasons.push('관심 키워드 일치');
  }

  // 5) 마감 임박 (30일 이내 마감이면 가산 — 지나간 공고는 감점)
  if (g.endDate) {
    const daysLeft = Math.ceil((new Date(g.endDate).getTime() - Date.now()) / 86400000);
    if (daysLeft >= 0 && daysLeft <= 30) {
      score += 10;
      reasons.push(`마감 ${daysLeft === 0 ? '오늘' : `D-${daysLeft}`}`);
    } else if (daysLeft < 0) {
      score -= 20; // 데이터 지연으로 남아있는 마감 공고는 뒤로
    }
  }

  // 6) 기업마당 조회수(인기) 소폭 가산
  if ((g.views || 0) >= 1000) score += 5;

  return { score: Math.max(score, 1), reasons, warnings: warnings.length ? warnings : undefined };
}

/** 선택한 관심 키워드에 해당하는 공고인가 (화면에서 묶음을 나누는 기준) */
export function matchesInterests(g: Grant, interests: string[]): boolean {
  if (interests.length === 0) return false;
  return (g.tags || []).some(t => interests.includes(t));
}

/** 전체 공고에 대해 매칭 점수를 계산해 Map(공고ID → 결과)으로 반환 */
export function scoreAllGrants(grants: Grant[], session: UserSession, interests: string[]): Map<string, MatchResult> {
  const map = new Map<string, MatchResult>();
  for (const g of grants) {
    map.set(g.id, scoreGrant(g, session, interests));
  }
  return map;
}
