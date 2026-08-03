import { BizCategory, BizRegions, Grant, UserSession } from '../types';

// ==============================================================================
// 매칭 서비스 — 수파베이스 policy_grants 데이터 기반 공고 매칭
//
// 매칭 기준축 (DB에 저장된 데이터를 최대한 활용):
//   · 지역: region_codes 컬럼 (동기화 시 소관부처·수행기관·해시태그·제목에서 계산)
//   · 분야: category / sub_category 컬럼 (기업마당 표준 분류 = 앱의 BizCategory)
//   · 키워드: 해시태그·사업개요·지원대상에서 계산한 스마트 태그
//   · 시기: end_date(마감일) — 신청 가능 기간이 임박한 공고 우선
//   · 인기: views(기업마당 조회수)
//
// 고객사 정보(업종·지역)는 로그인 시 Edge Function(verify-brn)이
// clients 테이블(업태 biz_type, 주소 address)에서 변환해 내려준 값을 사용합니다.
// ==============================================================================

// 축약 지역코드가 원문에 그대로 안 나오는 표기 보정 (충청북도→충북 등)
// ※ scripts/sync-bizinfo.mjs 의 extractRegionCodes 와 같은 규칙 — 함께 수정할 것
// ※ 고객사 주소 → 지역코드 변환(CsvService.mapRegion)도 이 표를 함께 사용한다
export const REGION_ALIASES: Record<string, string> = {
  '충청북': '충북', '충청남': '충남',
  '전라북': '전북', '전라남': '전남',
  '경상북': '경북', '경상남': '경남',
};

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

/** 공고 텍스트에서 표준 지역코드(서울/부산/…/제주)를 추출. 없거나 전 지역이면 전국으로 간주 */
export function extractRegionCodes(...texts: (string | undefined)[]): string[] {
  const text = texts.filter(Boolean).join(' ');
  const found = new Set<string>();
  for (const code of BizRegions) {
    if (code === '전국') continue;
    if (text.includes(code)) found.add(code);
  }
  for (const [alias, code] of Object.entries(REGION_ALIASES)) {
    if (text.includes(alias)) found.add(code);
  }
  return normalizeRegionCodes([...found]);
}

/** 공고의 지역코드. DB(region_codes)에 있으면 그 값을, 없으면(CSV 폴백 등) 즉석 계산 */
// DB 값도 normalizeRegionCodes를 거친다 — 동기화 스크립트 수정 전에 저장된
// '17개 지역' 행이 그대로 남아 있어도 화면에서는 전국으로 보이게 하기 위함.
export function getGrantRegions(g: Grant): string[] {
  if (g.regionCodes && g.regionCodes.length > 0) return normalizeRegionCodes(g.regionCodes);
  return extractRegionCodes(g.department, g.agency, (g.hashtags || []).join(' '), g.title);
}

/** 지역 필터: 전국 사업이거나, 공고 지역에 선택 지역이 포함되면 통과 */
export function matchesRegion(g: Grant, region: string): boolean {
  if (region === '전체' || region === '전국') return true;
  const regions = getGrantRegions(g);
  return regions.includes('전국') || regions.includes(region);
}

/** 분야 필터: 대분류(category)에 더해 중분류(subCategory)까지 확인 */
export function matchesCategory(g: Grant, cat: string): boolean {
  if (cat === '전체') return true;
  return g.category.includes(cat) || (g.subCategory || '').includes(cat);
}

export interface MatchResult {
  score: number;      // 0 = 매칭 대상 아님 (다른 지역 전용 등)
  reasons: string[];  // 카드에 표시할 매칭 근거
}

/**
 * 고객사 맞춤 점수 계산.
 * "너무 상관없는 것"(다른 지역 전용 공고)은 score 0 으로 제외하고,
 * 나머지는 지역 > 분야 > 관심 키워드 > 마감 임박 > 인기 순 가중치로 점수화한다.
 */
export function scoreGrant(g: Grant, session: UserSession, interests: string[]): MatchResult {
  let score = 0;
  const reasons: string[] = [];
  const regions = getGrantRegions(g);
  const userRegion = session.region && session.region !== '전체' ? session.region : null;

  // 1) 지역 (가중치 최대 40)
  if (userRegion) {
    if (regions.includes(userRegion)) {
      score += 40;
      reasons.push(`${userRegion} 지역 사업`);
    } else if (regions.includes('전국')) {
      score += 15;
      reasons.push('전국 사업');
    } else {
      // 다른 지역 전용 공고 — 우리 회사와 무관하므로 매칭에서 제외
      return { score: 0, reasons: [`${regions.join('·')} 지역 전용`] };
    }
  } else if (regions.includes('전국')) {
    score += 15;
    reasons.push('전국 사업');
  }

  // 2) 업종/분야 (가중치 25)
  const userIndustry = session.industry && session.industry !== '전체' ? session.industry : null;
  if (userIndustry && matchesCategory(g, userIndustry)) {
    score += 25;
    reasons.push(`${userIndustry} 분야`);
  }

  // 3) 선택한 관심 키워드와 스마트 태그 일치 (키워드당 10, 최대 20)
  const tagOverlap = (g.tags || []).filter(t => interests.includes(t)).length;
  if (tagOverlap > 0) {
    score += Math.min(tagOverlap * 10, 20);
    reasons.push('관심 키워드 일치');
  }

  // 4) 마감 임박 (30일 이내 마감이면 가산 — 지나간 공고는 감점)
  if (g.endDate) {
    const daysLeft = Math.ceil((new Date(g.endDate).getTime() - Date.now()) / 86400000);
    if (daysLeft >= 0 && daysLeft <= 30) {
      score += 10;
      reasons.push(`마감 ${daysLeft === 0 ? '오늘' : `D-${daysLeft}`}`);
    } else if (daysLeft < 0) {
      score -= 20; // 데이터 지연으로 남아있는 마감 공고는 뒤로
    }
  }

  // 5) 기업마당 조회수(인기) 소폭 가산
  if ((g.views || 0) >= 1000) score += 5;

  return { score: Math.max(score, 1), reasons };
}

/** 전체 공고에 대해 매칭 점수를 계산해 Map(공고ID → 결과)으로 반환 */
export function scoreAllGrants(grants: Grant[], session: UserSession, interests: string[]): Map<string, MatchResult> {
  const map = new Map<string, MatchResult>();
  for (const g of grants) {
    map.set(g.id, scoreGrant(g, session, interests));
  }
  return map;
}
