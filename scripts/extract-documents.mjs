// =============================================================================
// 첨부파일에서 글자를 뽑아 grant_documents 에 담는다 (WORK_PLAN.md A-3)
//
// **파일은 남기지 않는다.** 받아서 메모리에서 글자만 뽑고 버린다.
//   디스크에 쓰지 않으므로 보관할 자리도, 지울 일도 없다.
//
// 처리 대상: policy_grants.attachments 의 주소 중 **아직 처리하지 않은 것**.
//   주소 하나당 한 번만 한다 — 같은 첨부가 여러 공고에 붙어도 한 번이다.
//   한 번 실패한 것은 다시 시도하지 않는다(상태가 남는다). 다시 하려면 그 행을 지운다.
//
// 사용법:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/extract-documents.mjs
//   EXTRACT_BATCH=50 node scripts/extract-documents.mjs     # 한 번에 처리할 개수
//
//   보통은 Actions 로 돈다: gh workflow run extract-documents.yml
//
// 예절:
//   · 파일 사이에 쉰다(EXTRACT_DELAY, 기본 400ms). 공공 서버에 몰아치지 않는다.
//   · 한 번에 EXTRACT_BATCH 개만 한다. 전수를 한 번에 긁지 않는다.
//
// ⚠ 공고는 공개 자료다. 고객사 정보는 건드리지 않는다.
// =============================================================================

import { extractText } from './document-text.mjs';

const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const BATCH = Number(process.env.EXTRACT_BATCH || 200);
const DELAY_MS = Number(process.env.EXTRACT_DELAY || 400);
const MAX_BYTES = Number(process.env.EXTRACT_MAX_BYTES || 40 * 1024 * 1024);   // 40MB
const MAX_CHARS = Number(process.env.EXTRACT_MAX_CHARS || 120_000);
const TIMEOUT_MS = 90_000;

if (!BASE || !KEY) {
  console.error('[extract] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
  process.exit(1);
}

const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** PostgREST 는 한 번에 1000행까지만 준다 — 끝까지 넘겨 가며 받는다 */
async function fetchAll(path) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${BASE}/rest/v1/${path}`, {
      headers: { ...headers, Range: `${from}-${from + 999}` },
    });
    if (!res.ok) throw new Error(`${path} 조회 실패 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

// ── 할 일 고르기 ─────────────────────────────────────────────────────────────
const grants = await fetchAll('policy_grants?select=pblanc_id,attachments&active=eq.true&attachments=not.is.null');
let done;
try {
  done = new Set((await fetchAll('grant_documents?select=url')).map((r) => r.url));
} catch (err) {
  console.error('[extract] grant_documents 표가 없습니다. '
    + 'supabase/migrations/20261028_grant_documents.sql 를 실행하세요.');
  console.error(`  (${err.message})`);
  process.exit(1);
}

/** 주소 하나당 한 번 — 같은 첨부가 여러 공고에 붙어도 처음 만난 공고로 기록한다 */
const todo = [];
const seen = new Set();
for (const g of grants) {
  for (const a of g.attachments ?? []) {
    if (!a?.url || seen.has(a.url) || done.has(a.url)) continue;
    seen.add(a.url);
    todo.push({ pblanc_id: g.pblanc_id, name: a.name ?? '', ext: a.ext ?? '', url: a.url });
  }
}
console.log(`[extract] 첨부 ${seen.size + done.size}개 중 처리할 것 ${todo.length}개 (이미 끝난 것 ${done.size}개)`);
if (todo.length === 0) { console.log('[extract] 할 일이 없습니다.'); process.exit(0); }

// 쉬운 형식을 먼저 한다 — 한 번에 다 못 하더라도 쓸모 있는 것부터 쌓인다
const ORDER = { pdf: 0, hwpx: 1, docx: 2, xlsx: 3, pptx: 4, zip: 5 };
todo.sort((a, b) => (ORDER[a.ext] ?? 9) - (ORDER[b.ext] ?? 9));
const batch = todo.slice(0, BATCH);
console.log(`[extract] 이번에 ${batch.length}개를 처리합니다.`);

// ── 하나씩 ───────────────────────────────────────────────────────────────────
const rows = [];
const tally = {};
const bump = (k) => { tally[k] = (tally[k] ?? 0) + 1; };

for (let i = 0; i < batch.length; i++) {
  const item = batch[i];
  const base = { url: item.url, pblanc_id: item.pblanc_id, name: item.name || null, ext: item.ext || null };

  // 못 읽는다고 아는 형식은 내려받지도 않는다 — 공공 서버에 괜한 요청을 보내지 않는다
  const probe = await extractText(Buffer.alloc(0), item.ext);
  if (probe.status === 'unsupported') {
    rows.push({ ...base, status: 'unsupported', error: probe.error ?? null, chars: 0, bytes: 0 });
    bump('unsupported');
    continue;
  }

  let buf;
  try {
    const res = await fetch(item.url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) {
      rows.push({ ...base, status: 'too_large', bytes: len, chars: 0 });
      bump('too_large');
      await sleep(DELAY_MS);
      continue;
    }
    buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) {
      rows.push({ ...base, status: 'too_large', bytes: buf.length, chars: 0 });
      bump('too_large');
      await sleep(DELAY_MS);
      continue;
    }
  } catch (err) {
    rows.push({ ...base, status: 'download_failed', error: String(err?.message ?? err).slice(0, 300), chars: 0 });
    bump('download_failed');
    await sleep(DELAY_MS);
    continue;
  }

  const r = await extractText(buf, item.ext);
  const truncated = r.text.length > MAX_CHARS;
  rows.push({
    ...base,
    status: r.status,
    text: r.text ? r.text.slice(0, MAX_CHARS) : null,
    chars: r.text.length,
    bytes: buf.length,
    truncated,
    error: r.error ?? null,
  });
  bump(r.status);
  buf = null;   // 파일은 여기서 버린다

  if ((i + 1) % 25 === 0) console.log(`[extract]   ${i + 1}/${batch.length} …`);
  await sleep(DELAY_MS);
}

// ── 담기 ─────────────────────────────────────────────────────────────────────
// ⚠ 묶음이 실패하면 **한 줄씩 다시 넣어 본다.** 2026-10-28 첫 실행에서 한 줄 때문에
//   200개를 통째로 잃었다. 받아 놓은 것을 글자 하나 때문에 버리면 안 된다.
//   묶음을 20줄로 줄인 것도 같은 이유다 — 본문이 커서 한 번에 너무 많이 보내면 거절당한다.
async function save(chunk) {
  const res = await fetch(`${BASE}/rest/v1/grant_documents?on_conflict=url`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(chunk),
  });
  return res.ok ? null : `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
}

let saved = 0;
const failures = [];
for (let i = 0; i < rows.length; i += 20) {
  const chunk = rows.slice(i, i + 20);
  const err = await save(chunk);
  if (!err) { saved += chunk.length; continue; }
  console.warn(`[extract] 묶음 저장 실패(${err}) — 한 줄씩 다시 넣습니다.`);
  for (const row of chunk) {
    const e = await save([row]);
    if (e) {
      // 글자를 빼고 상태만이라도 남긴다. 다시 받지 않도록
      const e2 = await save([{ ...row, text: null, status: 'failed', error: `저장 실패: ${e}`.slice(0, 300) }]);
      if (e2) failures.push(`${row.url.slice(0, 70)} — ${e2}`);
      else { saved++; console.warn(`[extract]   글자를 빼고 저장: ${(row.name || row.url).slice(0, 50)}`); }
    } else saved++;
  }
}
if (failures.length) {
  console.error(`[extract] ⚠ 끝내 저장하지 못한 것 ${failures.length}개`);
  for (const f of failures.slice(0, 5)) console.error(`    ${f}`);
}

const chars = rows.reduce((n, r) => n + (r.chars ?? 0), 0);
console.log(`[extract] 완료 — ${saved}/${rows.length}개 저장 · 글자 ${chars.toLocaleString()}자`);
console.log(`[extract] 결과: ${Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
const left = todo.length - batch.length;
if (left > 0) console.log(`[extract] 남은 것 ${left}개 — 다시 돌리면 이어서 합니다.`);
