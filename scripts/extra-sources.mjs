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
// ⚠ 공개 명세를 이 환경에서 열람하지 못해(사이트가 자동 접근을 막음) 필드 이름을
//   여러 후보로 받는다. 키를 발급받은 뒤 첫 실행 로그의 "첫 항목 필드"를 보고
//   아래 후보 목록을 실제 이름으로 좁힐 것. 주소는 SMES24_API_URL 로 바꿀 수 있다.

const pick = (item, keys) => {
  for (const k of keys) {
    const v = item?.[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

export function smes24ToItem(it) {
  const id = pick(it, ['pblancSeq', 'pblancId', 'pblancSn', 'seq', 'id']);
  const title = pick(it, ['pblancNm', 'pblancTitle', 'title', 'sj', 'bsnsNm']);
  if (!id || !title) return null;
  const start = pick(it, ['pblancBgnDt', 'rceptBgnDt', 'reqstBgnDt', 'startDate', 'bgnDt']);
  const end = pick(it, ['pblancEndDt', 'rceptEndDt', 'reqstEndDt', 'endDate', 'endDt']);
  return {
    pblancId: `${SOURCE_PREFIX.smes24}${id}`,
    pblancNm: title,
    reqstBeginEndDe: start || end ? `${start} ~ ${end}` : pick(it, ['rceptPd', 'period']),
    pblancUrl: pick(it, ['pblancDtlUrl', 'detailUrl', 'url', 'link']),
    creatPnttm: pick(it, ['registDt', 'creatDt', 'regDt', 'frstRegistPnttm']),
    jrsdInsttNm: pick(it, ['jrsdInsttNm', 'mnstNm', 'ministry']) || '중소벤처기업부',
    excInsttNm: pick(it, ['sportInsttNm', 'excInsttNm', 'operInsttNm', 'insttNm', 'agency']),
    pldirSportRealmLclasCodeNm: pick(it, ['sportRealmNm', 'bsnsSeNm', 'category']) || '기타',
    pldirSportRealmMlsfcCodeNm: '',
    trgetNm: pick(it, ['sportTrgetNm', 'trgetNm', 'target']),
    bsnsSumryCn: pick(it, ['pblancCn', 'bsnsSumry', 'summary', 'cn']),
    hashtags: '',
    inqireCo: 0,
  };
}

/** 오류 문구에 키가 섞여 나와도 결과 파일(공개 저장소)에 남지 않게 가린다 */
export function redact(text, secret) {
  if (!secret) return text;
  return text.split(secret).join('***').split(encodeURIComponent(secret)).join('***');
}

export async function fetchSmes24Items({ apiKey, url, days = 60, fetchImpl = fetch, log = console }) {
  if (!apiKey) {
    log.log('[extra] SMES24_API_KEY 미설정 → 중소벤처24 건너뜀');
    return { items: [], ok: true, skipped: true };
  }
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);
  const ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
  const sep = url.includes('?') ? '&' : '?';
  const q = `token=${encodeURIComponent(apiKey)}&strDt=${ymd(start)}&endDt=${ymd(end)}&html=no`;
  try {
    const res = await fetchImpl(`${url}${sep}${q}`, { signal: AbortSignal.timeout(60_000) });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    const data = JSON.parse(text);
    const list = data?.data ?? data?.items ?? data?.item ?? data?.body?.items ?? data?.result ?? (Array.isArray(data) ? data : null);
    if (!Array.isArray(list)) throw new Error(`목록을 찾지 못함. 최상위 키: ${Object.keys(data || {}).join(',')}`);
    const fields = list[0] ? Object.keys(list[0]) : [];
    if (list[0]) log.log('[extra] 중소벤처24 첫 항목 필드:', fields.join(', '));
    const items = list.map(smes24ToItem).filter(Boolean);
    log.log(`[extra] 중소벤처24 수신 ${list.length}건 → 변환 ${items.length}건`);
    return { items, ok: true, skipped: false, received: list.length, fields };
  } catch (err) {
    // 추가 출처 실패는 전체 동기화를 멈추지 않는다 — 기업마당 데이터는 그대로 반영
    // 실패 이유는 grants_meta.json 에도 남긴다(Actions 로그를 못 볼 때 원인 확인용). 키는 가린다.
    const error = redact(String(err.cause?.code || err.message || err), apiKey).slice(0, 400);
    log.warn('[extra] ⚠ 중소벤처24 실패 (기업마당만 반영):', error);
    return { items: [], ok: false, skipped: false, error };
  }
}

/**
 * 이번 실행에서 실패한 출처의 접두어 — 그 출처의 기존 공고는 비활성화하지 않는다.
 * (하루 접속이 안 됐다고 멀쩡한 공고가 사이트에서 사라지면 안 된다)
 */
export function protectedPrefixes(results) {
  return Object.entries(results).filter(([, r]) => !r.ok).map(([k]) => SOURCE_PREFIX[k]).filter(Boolean);
}
