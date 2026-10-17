// =============================================================================
// 기업마당 외 추가 공고 출처 — 수동 등록 파일 + 중소벤처24 API
//
// 왜 필요한가:
//   · 시·군 육성자금(이차보전·특례보증) 공고 중 기업마당에 안 올라오는 것이 있다.
//     (2026-10 확인: 경기 광주시 0건, 용인시 이차보전 누락)
//     성남·용인 시청 누리집은 robots.txt 로 자동 수집을 막고 있어 긁지 않는다.
//     이런 공고는 1년에 1~2번 나오므로 data/manual-grants.json 에 사람이 등록한다.
//   · 중소벤처24 는 중기부 산하 기관 공고를 모으는 곳이라 기업마당과 대부분 겹치지만
//     일부 빠진 공고를 메울 수 있다. SMES24_API_KEY 가 없으면 조용히 건너뛴다.
//
// 출력: 기업마당 API 응답과 같은 모양의 항목 배열 → sync-bizinfo.mjs 의 변환 루프를
//       그대로 탄다(지역·시군·자격태그·금액 추출 규칙을 한 곳에서만 관리하기 위해).
//
// 공고 ID 접두어로 출처를 구분한다 (DB에 출처 컬럼을 새로 만들지 않기 위해).
//   기업마당 PBLN_… / 수동 MANUAL-… / 중소벤처24 SMES24-…
// =============================================================================

import { readFile } from 'node:fs/promises';

export const SOURCE_PREFIX = { manual: 'MANUAL-', smes24: 'SMES24-' };

/**
 * 공고명 비교용 정규화 — 대괄호 지역 머리말, 공백, 문장부호, '공고' 꼬리를 걷어낸다.
 * "[경기] 성남시 2026년 중소기업육성자금 이차보전금 지원계획 공고"
 *   → "성남시2026년중소기업육성자금이차보전금지원계획"
 */
export function normalizeTitle(title) {
  return String(title || '')
    .replace(/^\s*(\[[^\]]*\]\s*)+/, '')
    .replace(/[\s\-_.,·ㆍ()（）「」『』<>〈〉"'“”‘’:;!?~]/g, '')
    .replace(/(모집)?(재|추가|변경)?공고(문)?$/, '')
    .toLowerCase();
}

/**
 * 기업마당에 이미 있는 공고와 겹치는 추가 출처 항목을 뺀다. 기업마당 쪽을 남기는 이유:
 * 해시태그·지원분야 중분류·조회수 같은 매칭 신호가 기업마당에만 있다.
 * 같은 판정: 정규화한 제목이 같거나, 긴 쪽이 짧은 쪽(10자 이상)을 통째로 포함.
 */
export function dropDuplicates(baseItems, extraItems, titleOf = (it) => it.pblancNm) {
  const baseTitles = baseItems.map(it => normalizeTitle(titleOf(it))).filter(Boolean);
  const exact = new Set(baseTitles);
  const kept = [];
  const dropped = [];
  const keptTitles = new Set();
  for (const it of extraItems) {
    const t = normalizeTitle(titleOf(it));
    if (!t) continue;
    const dup = exact.has(t) || keptTitles.has(t) || baseTitles.some(b => {
      const [short, long] = b.length <= t.length ? [b, t] : [t, b];
      return short.length >= 10 && long.includes(short);
    });
    if (dup) dropped.push(it);
    else { kept.push(it); keptTitles.add(t); }
  }
  return { kept, dropped };
}

// --- 수동 등록 ------------------------------------------------------------------

/**
 * manual-grants.json 한 건 → 기업마당 응답 모양.
 * 필수: id, title, url. 날짜는 YYYY-MM-DD. 마감일이 없으면 periodText('예산 소진 시까지' 등).
 */
export function manualToItem(m) {
  if (!m || !m.id || !m.title || !m.url) throw new Error(`수동 공고에 id/title/url 이 없습니다: ${JSON.stringify(m)}`);
  const period = m.startDate || m.endDate
    ? `${m.startDate || ''} ~ ${m.endDate || ''}`
    : (m.periodText || '');
  return {
    pblancId: `${SOURCE_PREFIX.manual}${m.id}`,
    pblancNm: m.title,
    reqstBeginEndDe: period,
    pblancUrl: m.url,
    creatPnttm: m.registeredDate || '',
    jrsdInsttNm: m.department || '',
    excInsttNm: m.agency || '',
    pldirSportRealmLclasCodeNm: m.category || '금융',
    pldirSportRealmMlsfcCodeNm: m.subCategory || '',
    trgetNm: m.target || '중소기업',
    bsnsSumryCn: m.summary || '',
    hashtags: (m.hashtags || []).join(','),
    inqireCo: 0,
  };
}

/**
 * hideAfter(YYYY-MM-DD)가 지난 수동 공고는 뺀다. 마감일 없이 '예산 소진 시까지'인
 * 육성자금 공고가 해가 바뀌어도 계속 떠 있지 않도록, 등록할 때 그해 12-31 을 넣는다.
 */
export async function loadManualItems(file, today = new Date().toISOString().slice(0, 10)) {
  let raw;
  try {
    raw = await readFile(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const data = JSON.parse(raw);
  const list = Array.isArray(data) ? data : data.grants;
  if (!Array.isArray(list)) throw new Error('manual-grants.json 에 grants 배열이 없습니다');
  const ids = new Set();
  const items = [];
  for (const m of list) {
    if (ids.has(m.id)) throw new Error(`수동 공고 id 중복: ${m.id}`);
    ids.add(m.id);
    const item = manualToItem(m);
    if (m.hideAfter && m.hideAfter < today) continue;
    items.push(item);
  }
  return items;
}

// --- 중소벤처24 ------------------------------------------------------------------
// 응답: { resultCd: "0"(정상) | "9"(허용되지 않은 키) | "10"(다른 API 키) …, resultMsg, data: [공고…] }

const pick = (item, keys) => {
  for (const k of keys) {
    const v = item?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

// 응답 필드는 중소벤처24 「공고정보 API」 안내 페이지(2026-10-17 확인)의 응답 명세를 따른다.
//   pblancSeq 공고SEQ / pblancNm 공고명 / detailBsnsNm 세부사업명 / creatDt 등록일(yyyy-MM-dd HH:mm:ss)
//   pblancBgnDt·pblancEndDt 신청 시작·마감(yyyy-MM-dd) / pblancDtlUrl 상세 URL
//   policyCnts 사업개요 · sportMg 지원규모 · sportCnts 지원내용 · sportTrget 지원대상 (HTML 포함)
//   sportInsttNm 지원기관명 / cntcInsttNm 연계기관명 / sportType 지원유형 / areaNm 지역명('|' 구분)
export function smes24ToItem(it) {
  const id = pick(it, ['pblancSeq']);
  const title = pick(it, ['pblancNm']);
  if (!id || !title) return null;
  const start = pick(it, ['pblancBgnDt']);
  const end = pick(it, ['pblancEndDt']);
  const detail = pick(it, ['detailBsnsNm']);
  // 본문은 사업개요 → 지원대상 → 지원내용·규모 순으로 붙인다. 동기화 쪽 자격 판정이
  // "첫 ☞ 구간 = 지원대상"으로 읽으므로 기업마당과 같은 표시를 넣어 둔다.
  const body = [
    pick(it, ['policyCnts']),
    pick(it, ['sportTrget']) && `☞ 지원대상 ${pick(it, ['sportTrget'])}`,
    pick(it, ['sportCnts']) && `☞ 지원내용 ${pick(it, ['sportCnts'])}`,
    pick(it, ['sportMg']) && `지원규모 ${pick(it, ['sportMg'])}`,
  ].filter(Boolean).join(' ');
  return {
    pblancId: `${SOURCE_PREFIX.smes24}${id}`,
    pblancNm: detail && !title.includes(detail) ? `${title} (${detail})` : title,
    reqstBeginEndDe: start || end ? `${start} ~ ${end}` : '',
    pblancUrl: pick(it, ['pblancDtlUrl']),
    creatPnttm: pick(it, ['creatDt']).slice(0, 10),
    jrsdInsttNm: pick(it, ['cntcInsttNm']) || '중소벤처기업부',
    excInsttNm: pick(it, ['sportInsttNm']),
    pldirSportRealmLclasCodeNm: pick(it, ['sportType', 'bizType']) || '기타',
    pldirSportRealmMlsfcCodeNm: '',
    trgetNm: '',
    bsnsSumryCn: body,
    // 지역명('서울|경기')을 해시태그로 넘겨 기업마당 공고와 같은 지역 판정을 받게 한다
    hashtags: pick(it, ['areaNm']).split('|').map(s => s.trim()).filter(Boolean).join(','),
    inqireCo: 0,
  };
}

/**
 * 응답에서 공고 배열을 찾는다. data 가 배열이면 그대로, 객체면 그 안의 첫 배열
 * (예: data.list / data.items / data.pblancList). 응답 명세를 확인하면 좁힐 것.
 */
export function findList(data) {
  if (Array.isArray(data)) return data;
  for (const k of ['data', 'items', 'item', 'result', 'list']) {
    const v = data?.[k];
    if (Array.isArray(v)) return v;
    if (v && typeof v === 'object') {
      const inner = Object.values(v).find(Array.isArray);
      if (inner) return inner;
    }
  }
  if (Array.isArray(data?.body?.items)) return data.body.items;
  return null;
}

/** 오류 문구에 키가 섞여 나와도 결과 파일(공개 저장소)에 남지 않게 가린다 */
export function redact(text, secret) {
  if (!secret) return text;
  return text.split(secret).join('***').split(encodeURIComponent(secret)).join('***');
}

/**
 * 중소벤처24는 같은 요청에도 가끔 HTTP 500("Invalid Response Message Format")을 돌려준다
 * (2026-10-17 연속 2회 관찰 — 직전 같은 요청은 정상). 서버 쪽 오류·접속 오류면
 * 조회 기간을 줄여 가며 다시 부른다. 인증키 오류 같은 정상 응답(200)은 재시도하지 않는다.
 */
export async function fetchSmes24Items({ apiKey, url, days = 60, fetchImpl = fetch, log = console, retryDays = [30, 14], waitMs = 5000 }) {
  if (!apiKey) {
    log.log('[extra] SMES24_API_KEY 미설정 → 중소벤처24 건너뜀');
    return { items: [], ok: true, skipped: true, error: undefined, received: 0, fields: [] };
  }
  const plan = [days, ...retryDays.filter(d => d < days)];
  let last;
  for (let i = 0; i < plan.length; i++) {
    if (i > 0) {
      log.warn(`[extra] 중소벤처24 재시도 ${i}/${plan.length - 1} (조회기간 ${plan[i]}일): ${last.error}`);
      if (waitMs) await new Promise(r => setTimeout(r, waitMs));
    }
    last = await fetchSmes24Once({ apiKey, url, days: plan[i], fetchImpl, log });
    if (last.ok || !last.retryable) break;
  }
  if (!last.ok) log.warn('[extra] ⚠ 중소벤처24 실패 (기업마당만 반영):', last.error);
  const { retryable, ...result } = last;
  return result;
}

async function fetchSmes24Once({ apiKey, url, days, fetchImpl, log }) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);
  const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
  const sep = url.includes('?') ? '&' : '?';
  const q = `token=${encodeURIComponent(apiKey)}&strDt=${ymd(start)}&endDt=${ymd(end)}&html=no`;
  let retryable = true;  // 접속 오류·5xx 는 재시도, 그 외(200인데 오류 코드 등)는 바로 실패
  try {
    const res = await fetchImpl(`${url}${sep}${q}`, { signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    retryable = res.status >= 500;
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    const list = findList(data);
    if (!Array.isArray(list)) {
      // 응답은 {resultCd, resultMsg, data} 모양 — 결과 코드·메시지와 data 의 생김새를 남긴다
      const d = data?.data;
      const shape = d === null || d === undefined ? String(d)
        : Array.isArray(d) ? `array(${d.length})`
        : typeof d === 'object' ? `object{${Object.keys(d).slice(0, 15).join(',')}}`
        : `${typeof d}:${String(d).slice(0, 80)}`;
      throw new Error(`목록을 찾지 못함. resultCd=${data?.resultCd ?? '-'} resultMsg=${String(data?.resultMsg ?? '-').slice(0, 120)} data=${shape} 최상위 키: ${Object.keys(data || {}).join(',')}`);
    }
    const fields = list[0] ? Object.keys(list[0]) : [];
    if (list[0]) log.log('[extra] 중소벤처24 첫 항목 필드:', fields.join(', '));
    const items = list.map(smes24ToItem).filter(Boolean);
    log.log(`[extra] 중소벤처24 수신 ${list.length}건 → 변환 ${items.length}건`);
    return { items, ok: true, skipped: false, received: list.length, fields };
  } catch (err) {
    // 추가 출처 실패는 전체 동기화를 멈추지 않는다 — 기업마당 데이터는 그대로 반영
    // 실패 이유는 grants_meta.json 에도 남긴다(Actions 로그를 못 볼 때 원인 확인용). 키는 가린다.
    const error = redact(String(err.cause?.code || err.message || err), apiKey).slice(0, 400);
    return { items: [], ok: false, skipped: false, error, retryable };
  }
}

/**
 * 이번 실행에서 실패한 출처의 접두어 — 그 출처의 기존 공고는 비활성화하지 않는다.
 * (하루 접속이 안 됐다고 멀쩡한 공고가 사이트에서 사라지면 안 된다)
 */
export function protectedPrefixes(results) {
  return Object.entries(results).filter(([, r]) => !r.ok).map(([k]) => SOURCE_PREFIX[k]).filter(Boolean);
}
