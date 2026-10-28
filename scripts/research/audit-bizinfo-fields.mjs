// =============================================================================
// [조사용] A-2 기업마당 응답에 첨부파일 정보가 들어오는가
//
// ⚠ 조사(research) 전용. 운영 파이프라인에 연결하지 않는다. → docs/WORK_PLAN.md A-2
//
// 왜: 중소벤처24는 첨부파일 URL 을 API 로 그냥 준다(C-8 실측 93.8%).
//   그래서 중소벤처24 몫은 상세페이지를 긁을 필요가 없다.
//   **기업마당도 그런지가 A-2(첨부 수집기)의 크기를 결정한다.**
//   준다면 수집기는 「URL 모아서 내려받기」로 끝나고, 안 주면 상세페이지를 긁어야 한다.
//
// 공고는 공개 자료다. 고객사 정보는 건드리지 않는다.
//
// 사용법 (키가 저장소 시크릿에만 있어 보통은 Actions 로 돈다):
//   gh workflow run research-smes24.yml -f days=180     ← 같은 워크플로에 단계로 들어 있다
//   BIZINFO_API_KEY=... node scripts/research/audit-bizinfo-fields.mjs
//
// 출력: 응답 필드 전체 + 필드별 채움률 + 첨부파일로 보이는 필드. 전부 집계값이다.
// =============================================================================

const API_URL = 'https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do';
const KEY = process.env.BIZINFO_API_KEY;
const RELAY = process.env.BIZINFO_RELAY_URL || '';
const CNT = Number(process.env.BIZINFO_SEARCH_CNT || 500);

if (!KEY) {
  console.error('BIZINFO_API_KEY 가 없다. 키는 저장소 시크릿에만 있으므로 보통은 Actions 로 돌린다.');
  process.exit(1);
}

const url = `${API_URL}?crtfcKey=${encodeURIComponent(KEY)}&dataType=json&searchCnt=${CNT}`;
let text;
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  text = await res.text();
} catch (err) {
  if (!RELAY) {
    // 키가 오류 문구에 섞일 수 있다 — 로그는 공개된다
    console.error(`직접 호출 실패(${err.message}). 중계 주소도 없다.`);
    process.exit(1);
  }
  const res = await fetch(`${RELAY}?dataType=json&searchCnt=${CNT}`, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) { console.error(`중계 호출도 실패 HTTP ${res.status}`); process.exit(1); }
  text = await res.text();
}

const data = JSON.parse(text);
const list = Array.isArray(data) ? data
  : Array.isArray(data?.jsonArray) ? data.jsonArray
  : Array.isArray(data?.item) ? data.item
  : Array.isArray(data?.items) ? data.items
  : null;
if (!list) {
  console.error('목록을 찾지 못했다. 최상위 키:', Object.keys(data || {}).join(', '));
  process.exit(1);
}

console.log(`\n측정일 ${new Date().toISOString().slice(0, 10)} · 수신 ${list.length}건\n`);

const filled = (v) => v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== '-';
const keys = [...new Set(list.flatMap((it) => Object.keys(it)))].sort();
const pct = (n) => `${((n / list.length) * 100).toFixed(1)}%`;

console.log(`■ 응답 필드 ${keys.length}개 — 채움률`);
for (const k of keys) {
  const n = list.filter((it) => filled(it[k])).length;
  console.log(`  ${k.padEnd(28)} ${String(n).padStart(4)}/${list.length} ${pct(n).padStart(7)}`);
}

// ── 첨부파일로 보이는 필드 ───────────────────────────────────────────────────
// 이름에 file/attach/파일 이 들어가거나, 값이 파일 확장자로 끝나는 필드를 찾는다
const FILE_NAME = /file|attach|atch|파일|첨부|down/i;
const FILE_VALUE = /\.(pdf|hwp|hwpx|docx?|xlsx?|pptx?|zip)(\?|$)/i;
// 경로 필드(flpthNm 등)는 이름에도 값에도 확장자가 없을 수 있어 짝으로 함께 본다
const PATH_NAME = /flpth|path|경로|url/i;
const suspects = keys.filter((k) => FILE_NAME.test(k) || PATH_NAME.test(k)
  || list.some((it) => FILE_VALUE.test(String(it[k] ?? ''))));

console.log(`\n■ 첨부파일로 보이는 필드 — ${suspects.length}개`);
if (suspects.length === 0) {
  console.log('  (없다) → 기업마당은 첨부파일을 API 로 주지 않는다. A-2 는 상세페이지를 긁어야 한다.');
} else {
  for (const k of suspects) {
    const vals = list.map((it) => String(it[k] ?? '').trim()).filter(Boolean);
    const n = vals.length;
    console.log(`  ${k} — ${n}/${list.length} ${pct(n)}`);
    // 값의 생김새만 보여준다(공개 자료라 그대로 찍어도 되지만 길이를 자른다)
    for (const v of [...new Set(vals)].slice(0, 3)) console.log(`      ${v.slice(0, 140)}`);
  }
}

// ── 상세페이지에 첨부가 있는가 ───────────────────────────────────────────────
// API 가 안 주면 상세페이지를 긁어야 하는데, 그게 가능한지(로그인·JS 없이) 한 건으로 본다
const detailKey = keys.find((k) => /pblancUrl|url|link/i.test(k));
const sample = detailKey ? list.find((it) => filled(it[detailKey])) : null;
if (sample) {
  let href = String(sample[detailKey]);
  if (href.startsWith('/')) href = `https://www.bizinfo.go.kr${href}`;
  console.log(`\n■ 상세페이지 한 건 확인 — ${href.slice(0, 110)}`);
  try {
    const res = await fetch(href, { signal: AbortSignal.timeout(30_000) });
    const html = await res.text();
    console.log(`  HTTP ${res.status} · ${html.length}바이트`);
    const links = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
    const files = links.filter((h) => FILE_VALUE.test(h) || /fileDown|atchFile|download/i.test(h));
    console.log(`  링크 ${links.length}개 중 첨부로 보이는 것 ${files.length}개`);
    for (const f of [...new Set(files)].slice(0, 5)) console.log(`      ${f.slice(0, 140)}`);
    if (files.length === 0) {
      console.log('  → 정적 HTML 에 첨부 링크가 없다. 자바스크립트로 그리는지 확인이 더 필요하다.');
    }
  } catch (err) {
    console.log(`  상세페이지 호출 실패: ${err.message}`);
  }
}
console.log('');
