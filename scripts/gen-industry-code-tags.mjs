// =============================================================================
// 국세청 업종코드 1,542개에 업종 성격 꼬리표를 붙여 **SQL 파일로 만든다** (WORK_PLAN C-12)
//
// 왜 SQL 파일인가: 공용 DB(shared-db)에 실데이터를 넣는 일은 **SQL 파일로 넘긴다**.
//   스크립트가 직접 쓰지 않는다 — 담당자가 내용을 보고 실행한다.
//
// 쓰는 법:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/gen-industry-code-tags.mjs
//   → shared-db/supabase/migrations/ 옆에 둘 INSERT 문을 표준출력으로 뱉는다
//
// ⚠ 먼저 shared-db `20261029_industry_code_tags.sql` 로 표를 만들어 두어야 한다.
// ⚠ 조견표가 새 연도로 갱신되면 다시 돌린다 — 최신 연도 줄만 본다.
// =============================================================================

import { sectorsOfIndustryRow, sectorLabel } from './industry-sectors.mjs';

const BASE = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
if (!BASE || !KEY) {
  console.error('[tags] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.');
  process.exit(1);
}
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

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

const all = await fetchAll('industry_codes?select=year,code,biz_category,mid_category,sub_category,detail_category');
if (all.length === 0) { console.error('[tags] industry_codes 가 비어 있습니다.'); process.exit(1); }

// 코드 하나가 여러 연도에 있으면 **최신 연도**만 본다
const latest = new Map();
for (const r of all) {
  const prev = latest.get(r.code);
  if (!prev || r.year > prev.year) latest.set(r.code, r);
}

const rows = [];
for (const r of latest.values()) {
  const tags = sectorsOfIndustryRow(r);
  if (tags.length) rows.push({ code: r.code, tags, name: r.detail_category || r.sub_category || '' });
}
rows.sort((a, b) => a.code.localeCompare(b.code));

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const esc = (s) => String(s).replace(/\*\//g, '* /');   // 주석 안에서 블록을 닫지 않도록

const per = {};
for (const r of rows) for (const t of r.tags) per[t] = (per[t] ?? 0) + 1;

console.log(`-- industry_code_tags 적재 — 국세청 업종코드 ${latest.size}개 중 꼬리표가 붙은 ${rows.length}개`);
console.log('--');
console.log(`-- 만든 날: ${new Date().toISOString().slice(0, 10)}`);
console.log('-- 만든 것: 정책자금 매칭 앱 scripts/gen-industry-code-tags.mjs');
console.log('-- 근거:    같은 저장소 scripts/industry-sectors.mjs 의 꼬리표 정의 (테스트 46개)');
console.log('--');
console.log('-- 꼬리표별 줄 수:');
for (const [t, n] of Object.entries(per).sort((a, b) => b[1] - a[1])) {
  console.log(`--   ${sectorLabel(t)} — ${n}개`);
}
console.log('--');
console.log('-- ⚠ 이 꼬리표는 **경고 근거지 제외 근거가 아니다.** 붙었다고 공고를 지우지 않는다.');
console.log('-- ⚠ 틀린 줄을 손으로 고칠 때는 source 를 \'manual\' 로 바꾸고 note 에 사유를 적는다.');
console.log('--    그래야 이 스크립트를 다시 돌려도 덮어쓰지 않게 가려낼 수 있다.');
console.log('');
console.log('insert into public.industry_code_tags (code, tags, source) values');
// ⚠ 쉼표는 **주석 앞**에 찍는다. 뒤에 찍으면 주석 안으로 들어가 줄이 안 나뉘고 SQL 이 깨진다
console.log(rows.map((r, i) => `  (${q(r.code)}, array[${r.tags.map(q).join(', ')}], 'name')`
  + (i === rows.length - 1 ? ';' : ',') + `   -- ${esc(r.name)}`).join('\n'));
console.log('');
console.log('-- 손으로 고친 줄(source=\'manual\')은 그대로 두고, 나머지만 갱신한다');
console.log("-- on conflict (code) do update set tags = excluded.tags, updated_at = now()");
console.log("--   where industry_code_tags.source <> 'manual';");

console.error(`[tags] 조견표 ${latest.size}개 중 ${rows.length}개에 꼬리표를 붙였습니다.`);
