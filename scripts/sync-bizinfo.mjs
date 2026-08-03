// =============================================================================
// 기업마당(Bizinfo) 지원사업정보 API → 정적 데이터 동기화 스크립트
//
// 사용법:
//   BIZINFO_API_KEY=발급받은키 node scripts/sync-bizinfo.mjs
//
// 동작:
//   1. 기업마당 오픈 API(JSON)를 호출해 최신 공고 목록을 받는다.
//   2. 기존 CSV 스키마(번호,소관부처,...)로 변환해 public/data/policy_fund_latest.csv 저장
//   3. 동기화 시각/건수를 public/data/grants_meta.json 에 기록
//   4. SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 가 설정되어 있으면
//      수파베이스 policy_grants 테이블에도 업서트하고, 이번 동기화에 없는
//      기존 공고는 active=false 로 숨긴다 (삭제하지 않음 — 이력 보존).
//      수파베이스 업로드가 실패해도 CSV 폴백이 있으므로 작업 전체는 실패시키지 않는다.
//
// 안전장치: API 실패 또는 결과 0건이면 기존 파일을 절대 덮어쓰지 않고 종료코드 1로 끝난다.
//           (GitHub Pages에는 직전 데이터가 그대로 남아 서비스에 영향 없음)
// =============================================================================

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_URL = 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do';
const API_KEY = process.env.BIZINFO_API_KEY;
// 기업마당이 GitHub 서버의 직접 접속을 차단할 때 사용하는 우회 경로.
// docs/google-apps-script-bizinfo-relay.gs 를 웹앱으로 배포한 URL을
// 저장소 시크릿 BIZINFO_RELAY_URL 로 등록하면 직접 호출 실패 시 자동 사용된다.
const RELAY_URL = process.env.BIZINFO_RELAY_URL || '';
const SEARCH_CNT = Number(process.env.BIZINFO_SEARCH_CNT || 1000); // 1회 조회 건수
const DROP_EXPIRED = process.env.BIZINFO_KEEP_EXPIRED !== '1';     // 마감 지난 공고 제외(기본)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_CSV = path.join(ROOT, 'public/data/policy_fund_latest.csv');
const OUT_META = path.join(ROOT, 'public/data/grants_meta.json');

// --- 유틸 --------------------------------------------------------------------

/** 여러 후보 키 중 값이 있는 첫 번째를 반환 (API 필드명 변형 대비) */
function pick(item, keys) {
  for (const k of keys) {
    const v = item?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

/** HTML 태그 제거 + 기본 엔티티 복원 */
function stripHtml(s) {
  return s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "20260201 ~ 20260228" / "2026-02-01~2026-02-28" 등에서 시작/종료일 추출 */
function parsePeriod(raw) {
  const digits = (raw || '').match(/\d{4}[-.]?\d{2}[-.]?\d{2}/g) || [];
  const norm = digits.map(d => {
    const n = d.replace(/[-.]/g, '');
    return `${n.slice(0, 4)}-${n.slice(4, 6)}-${n.slice(6, 8)}`;
  });
  return {
    start: norm[0] || '',
    end: norm.length > 1 ? norm[norm.length - 1] : (norm[0] || ''),
    raw: (raw || '').trim(), // '상시', '예산 소진시까지' 등 원문 보존용
  };
}

/** CSV 필드 이스케이프 */
function csvField(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// --- 수파베이스 연동 ----------------------------------------------------------

/** 앱 화면의 지역 필터와 동일한 표준 지역코드 17개 */
const REGION_CODES = ['서울','부산','대구','인천','광주','대전','울산','세종','경기','강원','충북','충남','전북','전남','경북','경남','제주'];
/** 축약 코드가 원문에 그대로 안 나오는 표기 보정 (충청북도→충북 등) */
const REGION_ALIASES = { '충청북': '충북', '충청남': '충남', '전라북': '전북', '전라남': '전남', '경상북': '경북', '경상남': '경남' };

// 전국 공고 판정 — 기업마당은 전국 사업의 해시태그에 17개 시도를 전부 나열하므로,
// 지역명을 그대로 긁으면 전국 사업이 '17개 지역 전용'으로 잡힌다.
// 실제 분포가 1~6개(정상 다지역) → 13개 이상(전국)으로 끊기므로 13개 이상은 전국으로 접는다.
// ※ services/matchingService.ts 의 NATIONWIDE_MIN_CODES 와 같은 값을 유지할 것
const NATIONWIDE_MIN_CODES = 13;

/** 공고의 소관부처·수행기관·해시태그·제목에서 표준 지역코드를 추출 (없거나 전 지역이면 전국) */
function extractRegionCodes(...texts) {
  const text = texts.filter(Boolean).join(' ');
  const found = new Set();
  for (const code of REGION_CODES) if (text.includes(code)) found.add(code);
  for (const [alias, code] of Object.entries(REGION_ALIASES)) if (text.includes(alias)) found.add(code);
  if (found.size === 0 || found.size >= NATIONWIDE_MIN_CODES) return ['전국'];
  return [...found];
}

// --- 시·군·구 추출 -----------------------------------------------------------
// ※ services/matchingService.ts 의 extractSigunguCodes 와 같은 규칙 — 함께 수정할 것.
//   사전은 data/sigungu-names.json 을 앱과 공유한다 (복사본을 두지 않는다).
let SIGUNGU_SET = new Set();

const TITLE_SIGUNGU = /^\[[^\]]*\]\s*([가-힣]{1,4}(?:시|군|구)(?:\s*[ㆍ·,\/]\s*[가-힣]{1,4}(?:시|군|구))*)(?=[\s0-9([]|$)/;
const TAG_SIGUNGU_MAX = 2;   // 태그에 시·군이 3개 이상 나열되면 광역 사업으로 보고 무시

/** 공고의 시·군·구. 관내 기업만 신청 가능한 기초자치단체 사업이 아니면 빈 배열 */
function extractSigunguCodes(title, hashtagsText) {
  const found = new Set();

  const m = String(title || '').match(TITLE_SIGUNGU);
  if (m) {
    for (const raw of m[1].split(/[ㆍ·,\/]/)) {
      const tok = raw.trim();
      if (SIGUNGU_SET.has(tok)) found.add(tok);
    }
  }

  // 해시태그에만 시·군이 있는 공고 보강. 2글자 자치구(중구/서구 등)는 무관한 태그와
  // 겹치기 쉬워('강소특구'→'서구') 태그 경로에서는 인정하지 않는다.
  const fromTags = String(hashtagsText || '')
    .split(/[,#\/\s]+/)
    .map(t => t.trim())
    .filter(t => t && SIGUNGU_SET.has(t));
  if (new Set(fromTags).size <= TAG_SIGUNGU_MAX) {
    for (const tok of fromTags) if (tok.length > 2) found.add(tok);
  }

  return [...found];
}

// --- 자격 조건 태그 추출 -----------------------------------------------------
// 공고의 실제 신청 자격은 사업개요 본문에 자연어로 들어 있다. 여기서 뽑은 태그를
// policy_grants.target_flags 에 저장하고, 앱은 짧은 요약 + 이 태그만 받아 판정한다.
//
// ⚠ 이 태그는 "그 조건이 언급됐다"는 표시일 뿐, "그 조건만 신청 가능"이라는 확정이
//   아니다. 어떤 태그를 자격 제외(hard)로 쓰고 어떤 것을 가점(soft)으로 쓸지는
//   앱의 판정 로직에서 결정한다. 여기서 제외 판단까지 하면 오탐 시 되돌리기 어렵다.
//
// 새 태그가 필요하면 이 표에 한 줄 추가하면 된다 (컬럼이 text[]라 마이그레이션 불필요).
const FLAG_RULES = [
  ['관내전용',   ['관내', '소재 기업', '소재한 기업', '소재 중소기업', '본사 소재']],
  ['제조업',     ['제조업', '제조기업', '제조 기업', '소공인']],
  ['공장보유',   ['공장등록증', '공장 등록증', '공장을 보유', '공장 보유']],
  ['청년',       ['청년', '만 39세', '만39세']],
  ['업력제한',   ['업력', '창업 3년', '창업 5년', '창업 7년', '창업3년', '창업7년']],
  ['수출실적',   ['수출실적', '수출 실적', '무역업 고유번호', '무역업고유번호']],
  ['여성기업',   ['여성기업', '여성 기업']],
  ['장애인기업', ['장애인기업', '장애인 기업']],
  ['사회적기업', ['사회적기업', '사회적 기업', '사회적경제']],
  ['협동조합',   ['협동조합']],
  ['재창업',     ['재창업']],
  // 앱이 자동 판정할 수 없는 조건 — 사람이 공고문을 봐야 한다는 표시
  ['KSIC명시',   ['한국표준산업분류', '표준산업분류', 'KSIC']],
];

/** 지원대상 표준값(기업마당이 직접 분류한 값)은 그대로 태그로 쓴다 — 신뢰도가 높다 */
const TARGET_STANDARD = ['중소기업', '소상공인', '창업벤처', '사회적기업', '여성기업', '장애인기업', '마을기업', '협동조합', '제조업'];

function extractTargetFlags(title, target, summaryFull) {
  const flags = new Set();

  const t = String(target || '').trim();
  if (TARGET_STANDARD.includes(t)) flags.add(t);

  const text = [title, target, summaryFull].filter(Boolean).join(' ');
  for (const [flag, keywords] of FLAG_RULES) {
    if (keywords.some(k => text.includes(k))) flags.add(flag);
  }
  return [...flags];
}

// --- 지원금액 추출 -----------------------------------------------------------
// 기업마당 API 응답에는 금액 필드가 없어서(확인한 필드 22개 중 없음) 본문에서 뽑는다.
// 다만 "매출 10억원 이상 기업" 같은 자격 조건 금액을 지원금액으로 잘못 표시하면
// 사장님이 오해하므로, 지원을 뜻하는 말 뒤에 붙은 금액만 인정한다.
// 애매하면 비워 둔다 — 틀린 금액을 보여주는 것보다 안 보여주는 게 낫다.
// 금액 하나를 "지원금액"으로 인정하는 조건 — 앞뒤 어느 한쪽에 단서가 있어야 한다.
//   · 앞 단서: "업체당 5억원", "최대 300만원", "사업화자금 2,000만원"
//   · 뒤 단서: "3억원 이내", "5천만원 한도"  ← 한도 표현은 금액 뒤에 온다
//   · 자격 기준 배제: "연매출 20억원 미만", "매출액 3,000억원 이상인 기업 제외"
// 앞 단서만 쓰면 "소상공인 5천만원 이내 융자"를 놓치고(미탐),
// '이내'를 앞 단서로 넣으면 "업력 10년 이내)스타트업 - 연매출 20억원"을 잡는다(오탐).
// 그래서 양쪽을 따로 본다. 어느 단서도 없으면 비워 둔다 — 틀린 금액보다 빈 값이 낫다.
const AMOUNT_PREFIX = '(?:최대|한도|지원금|지원 금액|지원금액|융자|보조금|바우처|업체당|업체 당|업소당|업소 당|업체별|기업당|기업 당|기업별|인당|1인당|사업화자금)';
const AMOUNT_NUM = '[\\d,]+(?:\\.\\d+)?\\s*(?:억|천만|백만|만)\\s*원';
const AMOUNT_SCAN = new RegExp(`${AMOUNT_NUM}(?:\\s*(?:~|∼|～|-|부터)\\s*${AMOUNT_NUM})?`, 'g');
// '이하'는 뒤 단서에서 제외한다 — "연매출액 3억원 이하 사업자"처럼 자격 기준에 훨씬 자주 쓰인다.
// 지원 한도는 실제 데이터에서 '이내'·'한도'가 압도적이다.
const AMOUNT_SUFFIX_CUE = /^\s*(?:이내|한도|까지|지원|융자|보조)/;
const CONDITION_SUFFIX = /^\s*(?:미만|이상|초과|이하)/;
// 금액 앞이 매출·자본금이면 지원금액이 아니라 자격 기준이다 ("2025년 매출액 4억원 이하")
const CONDITION_PREFIX = /(?:매출|매출액|연매출|평균매출|자본금|자산|부채)[^☞.。\n]{0,15}$/;
const AMOUNT_PREFIX_RE = new RegExp(`${AMOUNT_PREFIX}[^.。\\n]{0,20}$`);

function extractSupportAmount(summaryFull) {
  const text = String(summaryFull || '');
  const hits = [];
  for (const m of text.matchAll(AMOUNT_SCAN)) {
    const after = text.slice(m.index + m[0].length);
    if (CONDITION_SUFFIX.test(after)) continue;                   // 자격 기준 금액
    const before = text.slice(Math.max(0, m.index - 30), m.index);
    if (CONDITION_PREFIX.test(before)) continue;                  // 자격 기준 금액
    if (!AMOUNT_SUFFIX_CUE.test(after) && !AMOUNT_PREFIX_RE.test(before)) continue;
    const v = m[0].replace(/\s+/g, ' ').trim();
    if (!hits.includes(v)) hits.push(v);
  }
  if (hits.length === 0) return null;
  // 여러 개면 가장 먼저 나온 것 (보통 "☞ 지원내용" 문단의 대표 금액)
  return hits[0].slice(0, 60);
}

/**
 * policy_grants 테이블 업서트 (수파베이스 REST API 직접 호출 — 별도 패키지 불필요)
 * 실패 시 예외를 던지지 않고 false 반환 (CSV 폴백이 있으므로 전체 작업은 계속)
 */
async function syncToSupabase(records) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!base || !key) {
    console.log('[sync-bizinfo] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 미설정 → 수파베이스 업로드 건너뜀 (CSV만 갱신)');
    return false;
  }

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  const runStart = new Date().toISOString();
  const rows = records
    .filter(r => r.pblanc_id)
    .map(r => ({ ...r, active: true, synced_at: runStart }));
  const skipped = records.length - rows.length;
  if (skipped > 0) console.warn(`[sync-bizinfo] 공고 ID(pblancId) 없는 ${skipped}건은 수파베이스 업서트에서 제외`);

  try {
    // 1) 500건씩 나눠 업서트 (pblanc_id 충돌 시 갱신)
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const res = await fetch(`${base}/rest/v1/policy_grants?on_conflict=pblanc_id`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) throw new Error(`업서트 실패 HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }

    // 2) 이번 동기화에 나타나지 않은 공고는 active=false 로 숨김 (삭제 안 함)
    const res = await fetch(
      `${base}/rest/v1/policy_grants?synced_at=lt.${encodeURIComponent(runStart)}&active=eq.true`,
      { method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify({ active: false }) },
    );
    if (!res.ok) throw new Error(`비활성화 실패 HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);

    console.log(`[sync-bizinfo] 수파베이스 policy_grants 업서트 완료: ${rows.length}건`);
    return true;
  } catch (err) {
    console.error('[sync-bizinfo] ⚠ 수파베이스 업로드 실패 (앱은 CSV 폴백으로 계속 동작):', err.message || err);
    return false;
  }
}

// --- 메인 --------------------------------------------------------------------

async function main() {
  if (!API_KEY) {
    console.error('[sync-bizinfo] 환경변수 BIZINFO_API_KEY가 설정되지 않았습니다.');
    process.exit(1);
  }

  // 일시적 네트워크 오류(접속 타임아웃 등) 대비: 최대 4회, 점점 길게 기다리며 재시도
  async function fetchWithRetry(url, attempts = 4) {
    for (let i = 1; i <= attempts; i++) {
      try {
        return await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(60_000),
        });
      } catch (err) {
        if (i === attempts) throw err;
        const waitSec = 15 * i;
        console.warn(`[sync-bizinfo] 호출 실패(${i}/${attempts}): ${err.cause?.code || err.name}. ${waitSec}초 후 재시도...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      }
    }
  }

  async function fetchItems(cnt) {
    const query = `crtfcKey=${encodeURIComponent(API_KEY)}&dataType=json&searchCnt=${cnt}`;
    console.log(`[sync-bizinfo] API 호출: ${API_URL} (searchCnt=${cnt})`);

    let res;
    try {
      res = await fetchWithRetry(`${API_URL}?${query}`);
    } catch (err) {
      if (!RELAY_URL) throw err;
      console.warn(`[sync-bizinfo] 직접 호출 실패(${err.cause?.code || err.name}) → 구글 중계(RELAY) 경유로 재시도`);
      const sep = RELAY_URL.includes('?') ? '&' : '?';
      res = await fetchWithRetry(`${RELAY_URL}${sep}${query}`);
    }
    if (!res.ok) {
      console.error(`[sync-bizinfo] API 응답 오류: HTTP ${res.status}`);
      console.error(await res.text().catch(() => ''));
      process.exit(1);
    }

    const bodyText = await res.text();
    let data;
    try {
      data = JSON.parse(bodyText);
    } catch {
      console.error('[sync-bizinfo] JSON 파싱 실패. 응답 앞부분:');
      console.error(bodyText.slice(0, 1000));
      console.error('※ 인증키 오류(HTML 오류 페이지) 또는 dataType 미지원일 수 있습니다.');
      process.exit(1);
    }

    // 응답 구조 방어적 탐색: 문서상 jsonArray 이지만 변형 대비
    const found =
      data?.jsonArray ??
      data?.item ??
      data?.items ??
      data?.body?.items ??
      (Array.isArray(data) ? data : null);

    if (!Array.isArray(found) || found.length === 0) {
      console.error('[sync-bizinfo] 공고 목록을 찾지 못했습니다. 응답 최상위 키:', Object.keys(data ?? {}));
      console.error('응답 앞부분:', bodyText.slice(0, 1000));
      process.exit(1);
    }
    return found;
  }

  let items = await fetchItems(SEARCH_CNT);

  // API가 알려주는 전체 건수(totCnt)가 이번 조회보다 많으면 전체를 다시 조회
  const totCnt = Number(items[0]?.totCnt || 0);
  if (totCnt > items.length) {
    console.log(`[sync-bizinfo] 전체 ${totCnt}건 중 ${items.length}건만 수신 → 전체 재조회`);
    items = await fetchItems(totCnt);
  }

  // 첫 항목의 실제 필드명을 로그로 남겨 스펙 검증에 활용
  console.log(`[sync-bizinfo] 수신 ${items.length}건. 첫 항목 필드:`, Object.keys(items[0]).join(', '));

  // 시·군·구 사전 로드 (앱과 같은 파일을 읽는다 — 복사본을 두면 반드시 어긋난다)
  const sigunguNames = JSON.parse(await readFile(path.join(ROOT, 'data/sigungu-names.json'), 'utf8'));
  SIGUNGU_SET = new Set(sigunguNames);
  console.log(`[sync-bizinfo] 시·군·구 사전 ${SIGUNGU_SET.size}종 로드`);

  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set();
  const rows = [];
  const grantRecords = []; // 수파베이스 policy_grants 업서트용 (CSV와 동일 데이터)
  let expired = 0;
  let no = 0;
  let amountFound = 0;

  for (const item of items) {
    const id = pick(item, ['pblancId', 'pblancSn', 'id']);
    const title = stripHtml(pick(item, ['pblancNm', 'title', 'pblancNmKr']));
    if (!title) continue;
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);

    const period = parsePeriod(pick(item, ['reqstBeginEndDe', 'reqstDe', 'rceptEngnHmpgUrl_period']));
    if (DROP_EXPIRED && period.end && period.end < today) { expired++; continue; }

    let detailUrl = pick(item, ['pblancUrl', 'url', 'link']);
    if (detailUrl && detailUrl.startsWith('/')) detailUrl = `https://www.bizinfo.go.kr${detailUrl}`;

    const registered = pick(item, ['creatPnttm', 'creatDe', 'registDe', 'pubDate']).slice(0, 10).replace(/\./g, '-');

    const department = pick(item, ['jrsdInsttNm', 'jrsdInsttNmKr', 'department']) || '관계부처'; // 소관부처
    const agency = pick(item, ['excInsttNm', 'operInsttNm', 'agency']);                          // 사업수행기관
    const category = stripHtml(pick(item, ['pldirSportRealmLclasCodeNm', 'lclasNm', 'category'])) || '기타'; // 지원분야
    const target = stripHtml(pick(item, ['trgetNm']));                                           // 지원대상
    // 사업개요: 화면 표시용 요약(300자)과 자격 판정용 원문을 따로 둔다.
    // CSV는 매일 git 커밋되므로 저장소가 불필요하게 커지지 않도록 요약만 담고,
    // 원문은 수파베이스(summary_full)에만 저장한다.
    const summaryFull = stripHtml(pick(item, ['bsnsSumryCn'])).slice(0, 5000);
    const summary = summaryFull.slice(0, 300);                                                   // 사업개요(요약)
    const hashtagsText = stripHtml(pick(item, ['hashtags']));                                    // 해시태그
    const subCategory = stripHtml(pick(item, ['pldirSportRealmMlsfcCodeNm']));                   // 지원분야 중분류
    const views = pick(item, ['inqireCo']);                                                      // 조회수
    const periodText = period.start ? '' : period.raw;  // 날짜 파싱 불가 시 '상시' 등 표시용

    rows.push([
      ++no,           // 번호
      department,     // 소관부처
      agency,         // 사업수행기관
      category,       // 지원분야
      title,          // 공고명
      period.start,   // 신청시작일자
      period.end,     // 신청종료일자
      registered,     // 등록일자
      detailUrl || '#', // 공고상세URL
      periodText,     // 신청기간(원문)
      target,         // 지원대상
      summary,        // 사업개요(요약)
      hashtagsText,   // 해시태그 (지역/분야 정밀 매칭용)
      subCategory,    // 지원분야 중분류
      views,          // 조회수 (기업마당 실제 조회수)
    ]);

    const hashtags = hashtagsText.split(/[,#/\s]+/).map(t => t.trim()).filter(Boolean);
    const supportAmount = extractSupportAmount(summaryFull);
    if (supportAmount) amountFound++;

    grantRecords.push({
      pblanc_id: id,
      title,
      department,
      agency: agency || null,
      category,
      sub_category: subCategory || null,
      start_date: period.start || null,   // date 컬럼은 빈 문자열 대신 NULL
      end_date: period.end || null,
      registration_date: registered || null,
      period_text: periodText || null,
      detail_url: detailUrl || null,
      target: target || null,
      summary: summary || null,
      summary_full: summaryFull || null,  // 자격 판정 근거 (앱은 조회하지 않음)
      hashtags,
      region_codes: extractRegionCodes(department, agency, hashtagsText, title),
      sigungu_codes: extractSigunguCodes(title, hashtagsText),
      target_flags: extractTargetFlags(title, target, summaryFull),
      support_amount: supportAmount,
      views: Number(views) || 0,
    });
  }

  if (rows.length === 0) {
    console.error('[sync-bizinfo] 변환 후 공고가 0건입니다. 필드 매핑을 확인하세요. (기존 파일 유지)');
    process.exit(1);
  }

  const header = ['번호', '소관부처', '사업수행기관', '지원분야', '공고명', '신청시작일자', '신청종료일자', '등록일자', '공고상세URL', '신청기간', '지원대상', '사업개요', '해시태그', '지원분야중분류', '조회수'];
  const csv = '﻿' + [header, ...rows].map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n';

  await mkdir(path.dirname(OUT_CSV), { recursive: true });
  await writeFile(OUT_CSV, csv, 'utf8');

  // 수파베이스에도 업서트 (환경변수 미설정/실패 시 false — CSV 폴백으로 서비스 유지)
  const supabaseSynced = await syncToSupabase(grantRecords);

  await writeFile(
    OUT_META,
    JSON.stringify({ syncedAt: new Date().toISOString(), count: rows.length, expiredDropped: expired, source: 'bizinfo-api', supabaseSynced }, null, 2),
    'utf8',
  );

  // 추출 결과 요약 — 규칙을 바꿨을 때 건수가 급변하면 로그에서 바로 보인다
  const sigunguCount = grantRecords.filter(r => r.sigungu_codes.length > 0).length;
  const flagCount = grantRecords.filter(r => r.target_flags.length > 0).length;
  const flagTally = {};
  for (const r of grantRecords) for (const f of r.target_flags) flagTally[f] = (flagTally[f] || 0) + 1;
  console.log(`[sync-bizinfo] 시·군 전용 판정 ${sigunguCount}건 / 자격태그 보유 ${flagCount}건 / 지원금액 추출 ${amountFound}건`);
  console.log('[sync-bizinfo] 자격태그 분포:', Object.entries(flagTally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));

  console.log(`[sync-bizinfo] 완료: ${rows.length}건 저장 (마감 제외 ${expired}건, 수파베이스 ${supabaseSynced ? '동기화됨' : '건너뜀'}) → ${path.relative(ROOT, OUT_CSV)}`);
}

main().catch(err => {
  console.error('[sync-bizinfo] 실패:', err);
  process.exit(1);
});
