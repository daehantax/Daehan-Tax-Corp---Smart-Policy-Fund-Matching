// =============================================================================
// 공고의 「제외 업종」을 읽어 policy_grants.excluded_industries 에 담는다
// (WORK_PLAN.md C-12)
//
// 왜 동기화(sync-bizinfo.mjs)가 아니라 따로인가:
//   제외 업종은 대부분 **첨부파일 안**에 있다(실측 — 156건 중 153건). 첨부 글자는
//   grant_documents 에 들어 있고 그건 A-3 추출기가 따로 채운다. 그래서 추출이 끝난 뒤
//   이 스크립트가 돈다. 동기화는 `conditions` 를 매번 덮어쓰므로 칸도 따로 쓴다.
//
// 쓰는 법:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/apply-exclusions.mjs
//   보통은 Actions 로 돈다 (.github/workflows/extract-documents.yml 끝에 붙어 있다)
//
// ⚠ 읽어낸 것이 없으면 **NULL 을 그대로 둔다.** 「제외 업종이 없다」가 아니라 「모른다」다.
// ⚠ 이 값으로 공고를 지우지 않는다 — 화면에는 **경고**로만 나간다(CLAUDE.md).
// =============================================================================

import { extractExclusions } from './grant-exclusions.mjs';

const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!BASE || !KEY) {
  console.error('[exclusions] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
  process.exit(1);
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

/** PostgREST 는 한 번에 1000행까지만 준다 */
async function fetchAll(path) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${BASE}/rest/v1/${path}`, { headers: { ...headers, Range: `${from}-${from + 999}` } });
    if (!res.ok) throw new Error(`${path} 조회 실패 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

const grants = await fetchAll('policy_grants?select=pblanc_id,summary_full,excluded_industries&active=eq.true');
let docs;
try {
  docs = await fetchAll('grant_documents?select=pblanc_id,text&status=eq.ok');
} catch (err) {
  console.error('[exclusions] grant_documents 를 읽지 못했습니다. A-3 추출을 먼저 돌리세요.');
  console.error(`  (${err.message})`);
  process.exit(1);
}

const textByGrant = new Map();
for (const d of docs) {
  if (!d.text) continue;
  if (!textByGrant.has(d.pblanc_id)) textByGrant.set(d.pblanc_id, []);
  textByGrant.get(d.pblanc_id).push(d.text);
}

const changed = [];
const tally = {};
let read = 0;
for (const g of grants) {
  const whole = [String(g.summary_full || ''), ...(textByGrant.get(g.pblanc_id) ?? [])]
    .filter(Boolean).join('\n\n');
  const got = whole ? extractExclusions(whole) : null;
  if (got) {
    read++;
    for (const t of got.tags) tally[t] = (tally[t] ?? 0) + 1;
  }
  // 바뀐 것만 보낸다 — 매일 도는 작업이라 그대로인 줄까지 쓸 이유가 없다
  if (JSON.stringify(got) !== JSON.stringify(g.excluded_industries ?? null)) {
    changed.push({ pblanc_id: g.pblanc_id, excluded_industries: got });
  }
}

console.log(`[exclusions] 노출 중인 공고 ${grants.length}건 · 제외 업종을 읽어낸 것 ${read}건`
  + ` (${(read / Math.max(1, grants.length) * 100).toFixed(1)}%)`);
for (const [t, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`[exclusions]   ${t} ${n}건`);

if (changed.length === 0) { console.log('[exclusions] 바뀐 것이 없습니다.'); process.exit(0); }

// ⚠ 업서트(on_conflict)는 쓸 수 없다. 두 칸만 담아 보내면 PostgreSQL 이 충돌을 해소하기 **전에**
//   NOT NULL 을 먼저 검사해서 title 같은 칸이 비었다고 거절한다(23502). 그래서 PATCH 로 고친다.
//   같은 값이 걸린 공고가 많아(표준 제외업종 목록) 값끼리 묶어 한 번에 보낸다.
const byValue = new Map();
for (const c of changed) {
  const k = JSON.stringify(c.excluded_industries);
  if (!byValue.has(k)) byValue.set(k, []);
  byValue.get(k).push(c.pblanc_id);
}

let saved = 0;
for (const [value, ids] of byValue) {
  // URL 이 길어지지 않게 100건씩 끊는다
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const list = slice.map((id) => `"${id}"`).join(",");
    const res = await fetch(`${BASE}/rest/v1/policy_grants?pblanc_id=in.(${encodeURIComponent(list)})`, {
      method: "PATCH",
      headers: { ...headers, Prefer: "return=minimal" },
      body: JSON.stringify({ excluded_industries: JSON.parse(value) }),
    });
    if (!res.ok) {
      console.error(`[exclusions] 저장 실패 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
      process.exit(1);
    }
    saved += slice.length;
  }
}
console.log(`[exclusions] ${saved}건 갱신했습니다.`);
