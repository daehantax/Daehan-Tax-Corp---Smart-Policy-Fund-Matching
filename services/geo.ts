import { BizRegionType, BizRegions } from '../types';
import divisions from '../data/administrative-divisions.json';

// ==============================================================================
// 행정구역 판정 — 지역 관련 로직의 단일 출처
//
// 이 파일이 생기기 전에는 같은 판정이 다섯 군데에 흩어져 있었고(types.ts의
// BizRegions, matchingService의 REGION_ALIASES, constants의 SIGUNGU_NAMES,
// csvService의 mapRegion/mapSigungu, 그리고 sync-bizinfo.mjs의 복제본)
// 사전이 불완전해서 계속 놓치는 시·군이 나왔다(공식 목록 대조 시 43종 누락).
//
// 데이터: data/administrative-divisions.json
//   행정안전부 법정동코드 전체자료에서 생성 (scripts/gen-divisions.mjs).
//   행정구역이 바뀌면 파일을 새로 받아 스크립트를 재실행하면 된다.
//
// ※ scripts/sync-bizinfo.mjs 가 같은 규칙을 복제하고 있다 — 함께 수정할 것.
//   (동기화 스크립트는 Node 단독 실행이라 TS 모듈을 불러올 수 없다)
// ==============================================================================

type SidoEntry = { code: string; name: string; short: string; appCodes: string[] };
type SigunguEntry = { sido: string; name: string; code: string; parent?: string; short?: string; retired?: boolean };
type ZoneEntry = { include?: string[]; exclude?: string[] };

const SIDO: SidoEntry[] = divisions.sido;
const SIGUNGU: SigunguEntry[] = divisions.sigungu;
const ZONES: Record<string, ZoneEntry> = divisions.zones;
const LEGACY_ALIASES: Record<string, string[]> = divisions.legacyAliases;

/** 앱의 지역 필터 코드(서울/부산/…/제주) — '전국' 제외 */
const APP_CODES = BizRegions.filter((r): r is Exclude<BizRegionType, '전국'> => r !== '전국');

/**
 * 지역이 아니라 "그 지역을 제외한 전국"을 뜻하는 권역.
 * 예) "[비수도권] 메인비즈 현장방문 맞춤 코칭" — 수도권 기업은 신청 자격이 없다.
 * regionCodes 에 이 이름이 그대로 담기고, 매칭 함수가 제외 규칙으로 해석한다.
 */
export const EXCLUSIVE_ZONES: Record<string, string[]> = Object.fromEntries(
  Object.entries(ZONES).filter(([, z]) => z.exclude).map(([name, z]) => [name, z.exclude!]),
);

// 시도 판정용 검색어 목록 (긴 것부터 — '전남광주통합특별시'가 '전남'보다 먼저 걸려야 한다)
const SIDO_TOKENS: Array<{ token: string; codes: string[] }> = [
  ...SIDO.map(s => ({ token: s.name, codes: s.appCodes })),
  ...SIDO.map(s => ({ token: s.short, codes: s.appCodes })),
  ...Object.entries(LEGACY_ALIASES).map(([token, codes]) => ({ token, codes })),
  ...APP_CODES.map(c => ({ token: c as string, codes: [c as string] })),
].sort((a, b) => b.token.length - a.token.length);

/** 텍스트에서 앱 지역코드를 추출 (전국 판정은 하지 않음) */
export function pickSidoCodes(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const { token, codes } of SIDO_TOKENS) {
    if (text.includes(token)) for (const c of codes) found.add(c);
  }
  return [...found];
}

/** 텍스트의 권역 표현을 찾아 지역코드로 펼친다. exclude형 권역은 이름 그대로 돌려준다 */
export function detectZone(text: string): string[] | null {
  if (!text) return null;
  // '비수도권'이 '수도권'보다 먼저 걸려야 하므로 긴 이름부터 본다
  for (const name of Object.keys(ZONES).sort((a, b) => b.length - a.length)) {
    if (!text.includes(name)) continue;
    const z = ZONES[name];
    if (z.exclude) return [name];
    if (z.include) return [...z.include];
  }
  return null;
}

// ── 시·군·구 ────────────────────────────────────────────────────────────────
// SIGUNGU 에는 폐지된 시·군·구도 retired: true 로 함께 담겨 있다 — 고객사 주소와 공고
// 원문에 옛 표기가 남아 있기 때문이다(예: 인천 서구·중구는 2026년 재편됐지만 주소 26건이
// 아직 옛 이름). 동명 판정은 상위 시도로 교차 검증하므로 옛 이름이 엉뚱한 시도에 붙지 않는다.
const SIGUNGU_BY_NAME = new Map<string, SigunguEntry[]>();
for (const s of SIGUNGU) {
  const list = SIGUNGU_BY_NAME.get(s.name) ?? [];
  list.push(s);
  SIGUNGU_BY_NAME.set(s.name, list);
}
// 접미사 없는 표기('강릉'→강릉시). 단 시도 이름과 겹치는 것은 제외한다 —
// 해시태그의 '제주'·'광주'는 시도를 뜻하는 경우가 압도적이라 시·군으로 보면 오탐이 난다.
const SIDO_WORDS = new Set<string>([...SIDO.map(s => s.short), ...APP_CODES.map(String)]);
const SIGUNGU_BY_SHORT = new Map<string, SigunguEntry[]>();
for (const s of SIGUNGU) {
  if (!s.short || SIDO_WORDS.has(s.short)) continue;
  const list = SIGUNGU_BY_SHORT.get(s.short) ?? [];
  list.push(s);
  SIGUNGU_BY_SHORT.set(s.short, list);
}

/** 공식 시·군·구 이름인가 */
export function isSigungu(name: string): boolean {
  return SIGUNGU_BY_NAME.has(name);
}

/** 그 시·군·구가 속한 앱 지역코드들 (동명이 여러 시도에 있으면 여러 개) */
export function sigunguSidoCodes(name: string): string[] {
  const entries = SIGUNGU_BY_NAME.get(name);
  if (!entries) return [];
  const out = new Set<string>();
  for (const e of entries) {
    const sido = SIDO.find(s => s.short === e.sido);
    for (const c of sido?.appCodes ?? []) out.add(c);
  }
  return [...out];
}

/**
 * 시·군·구 이름이 주어진 지역코드에 속할 수 있는지.
 * 같은 이름이 여러 시도에 있으므로(중구=서울·부산·대구·대전·울산) 시도로 교차 검증한다.
 */
export function sigunguBelongsTo(name: string, regionCodes: string[]): boolean {
  if (regionCodes.length === 0) return true;
  const codes = sigunguSidoCodes(name);
  if (codes.length === 0) return true;
  return codes.some(c => regionCodes.includes(c));
}

/**
 * 접미사 없는 표기를 정식 이름으로 (강릉→강릉시). 모호하거나 시도명과 겹치면 null.
 * 폐지된 항목과 겹칠 때는 현행을 택한다 — '화성'은 화성시(현행)와 화성군(폐지)에
 * 모두 걸리는데, 포기하면 "경기 화성 팔탄 …" 같은 옛 지번주소를 못 읽는다.
 */
export function expandSigunguShort(token: string, regionCodes: string[] = []): string | null {
  const entries = SIGUNGU_BY_SHORT.get(token);
  if (!entries || entries.length === 0) return null;

  const prefer = (list: SigunguEntry[]): SigunguEntry[] => {
    const current = list.filter(e => !e.retired);
    return current.length > 0 ? current : list;
  };

  if (regionCodes.length > 0) {
    const inRegion = prefer(entries.filter(e => {
      const sido = SIDO.find(s => s.short === e.sido);
      return (sido?.appCodes ?? []).some(c => regionCodes.includes(c));
    }));
    if (inRegion.length === 1) return inRegion[0].name;
    if (inRegion.length > 1) return null;   // 같은 시도 안에서도 모호하면 포기
  }
  const pool = prefer(entries);
  const names = new Set(pool.map(e => e.name));
  return names.size === 1 ? pool[0].name : null;
}

// ── 고객사 주소 판정 ────────────────────────────────────────────────────────
/**
 * 사업장 주소 → 지역코드 + 시·군·구.
 * 실제 주소는 형태가 제각각이다:
 *   "(13559 ) 경기도 성남시 분당구 성남대로 295"   ← 우편번호가 앞에
 *   "경기 성남 분당 야탑 382 3"                   ← 접미사 없는 옛 지번주소
 *   "전남광주통합특별시북구 양산택지로51번길 2"      ← 시도명과 구가 붙어 있음
 */
export function resolveAddress(address: string): { region: BizRegionType | '전체'; sigungu: string[] } {
  if (!address) return { region: '전체', sigungu: [] };

  const cleaned = address
    .replace(/\([^)]*\)/g, ' ')   // "(13559 )", "(정자동, 대림아크로텔)"
    .replace(/^[^가-힣]+/, '')     // 남은 우편번호·기호
    .trim();
  if (!cleaned) return { region: '전체', sigungu: [] };

  // 1) 시도 — 주소 맨 앞에서 가장 먼저 나온 것 (뒤쪽 도로명 오인 방지)
  const head = cleaned.slice(0, 15);
  let region: BizRegionType | '전체' = '전체';
  let bestAt = -1;
  for (const { token, codes } of SIDO_TOKENS) {
    const at = head.indexOf(token);
    if (at < 0) continue;
    if (bestAt < 0 || at < bestAt || (at === bestAt && token.length > 2)) {
      bestAt = at;
      region = codes[0] as BizRegionType;
    }
  }
  const regionCodes = region === '전체' ? [] : [region as string];

  // 2) 시·군·구 — 시도명을 떼고 남은 앞부분에서 찾는다 (붙여 쓴 주소까지 대응)
  const afterSido = bestAt >= 0 ? cleaned.slice(bestAt).replace(/^[가-힣]*?(?=\s|$)/, '') : cleaned;
  const sigungu: string[] = [];
  const push = (n: string | null) => { if (n && !sigungu.includes(n)) sigungu.push(n); };

  for (const token of `${cleaned} ${afterSido}`.split(/\s+/).slice(0, 8)) {
    if (!token) continue;
    if (isSigungu(token) && sigunguBelongsTo(token, regionCodes)) { push(token); continue; }
    push(expandSigunguShort(token, regionCodes));
  }
  // 붙여 쓴 경우: "전남광주통합특별시북구" 처럼 시도명 뒤에 곧바로 구가 오는 형태
  if (sigungu.length === 0 && bestAt >= 0) {
    const glued = cleaned.slice(bestAt).split(/\s+/)[0];
    for (const [name] of SIGUNGU_BY_NAME) {
      if (glued.endsWith(name) && sigunguBelongsTo(name, regionCodes)) { push(name); break; }
    }
  }

  return { region, sigungu };
}
