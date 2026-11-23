// =============================================================================
// [조사용] 중소벤처24 판 공고의 「전국」 태깅 — 실제로는 시·군 사업인데 전국으로 붙은 것이 있나
//
// ⚠ 조사(research) 전용. 운영 파이프라인·앱에 연결하지 않는다. → docs/WORK_PLAN.md §8
//   읽기 전용이다. policy_grants(공개 공고)만 읽고 고객사 표는 열지 않는다.
//
// 배경 — 2026-11-23 주간 리포트(W-1) 점검 중 「2026년 2차 고양시 영상기업 활용 인센티브」가
//   기업마당 판은 경기·고양시, 중소벤처24 판은 전국으로 붙어 거래처 716곳 전원에게 걸렸다.
//   「제목 앞머리 시·군을 시·군 전용으로 승격」하는 규칙을 넣기 전에 건수부터 쟀다.
//
// 2026-11-23 결과 — **승격할 공고가 없다.** 활성 중소벤처24 전국 69건 중 제목에 시·군 이름이
//   든 것은 2건이고, 둘 다 본문상 관외 기업도 신청할 수 있다:
//     · 고양시 영상기업 인센티브 → 지원대상 「국내 영상 콘텐츠 제작사 및 고양 영상제작 협력기업」
//     · 시흥시 금형 디지털전환   → 지원대상 「관내‧외 디지털전환 관심 제조기업」
//   즉 전국 판정이 맞고, 오히려 기업마당 판(경기·고양시)이 관외 제작사를 잘못 지우고 있었다.
//   전체 이력(513건)에서 하나 더 걸리는 「양산시제품」(→양산시)은 낱말 일부가 겹친 오탐이다.
//   수행기관(agency)은 513건 중 396건이 「기타」라 시·군 단서가 되지 못한다.
//
// 사용법:
//   node scripts/research/audit-smes24-region.mjs
//
// 자격증명 (둘 중 하나):
//   1) 환경변수 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
//   2) 없으면 dh-platform 의 .env.local 에서 읽는다
//      기본 경로 ../dh-platform/.env.local — 다르면 DH_PLATFORM_ENV 로 지정
// =============================================================================

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function credentials() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  }
  const envPath = process.env.DH_PLATFORM_ENV
    ?? path.resolve(ROOT, '..', 'dh-platform', '.env.local');
  let text;
  try {
    text = readFileSync(envPath, 'utf8');
  } catch {
    console.error(`자격증명을 찾지 못했다 (찾아본 곳: ${envPath}). DH_PLATFORM_ENV 로 지정한다.`);
    process.exit(1);
  }
  const env = Object.fromEntries(
    text.split(/\r?\n/)
      .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
      .map((l) => {
        const i = l.indexOf('=');
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
      }),
  );
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(`${envPath} 에 NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없다.`);
    process.exit(1);
  }
  return { url, key };
}

const { url, key } = credentials();
const db = createClient(url, key, { auth: { persistSession: false } });

// 페이징은 반드시 기본키로 정렬한다 — 정렬 없이 range 를 넘기면 행이 새거나 겹친다(§7)
async function loadAll() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('policy_grants')
      .select('pblanc_id,title,agency,region_codes,sigungu_codes,active,summary_full')
      .like('pblanc_id', 'SMES24-%')
      .order('pblanc_id', { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const divisions = JSON.parse(readFileSync(path.join(ROOT, 'data/administrative-divisions.json'), 'utf8'));
// 접미사까지 붙은 정식 이름만 본다. 2글자(중구·서구…)는 동명이 많고 낱말과 겹치기 쉬워 뺀다
const NAMES = [...new Set(divisions.sigungu.filter((s) => !s.retired).map((s) => s.name))]
  .filter((n) => n.length > 2);
const namesIn = (text) => NAMES.filter((n) => String(text || '').includes(n));

// 본문의 「관외도 된다」 신호 — 이게 있으면 시·군 전용이 아니다
const OPEN_BEYOND = /관내\s*[‧·ㆍ,]?\s*외|국내\s*(?:영상|기업|법인|중소)|전국/;

const rows = await loadAll();
const active = rows.filter((r) => r.active);
const isNational = (r) => (r.region_codes || []).includes('전국');
const agencyOther = rows.filter((r) => !r.agency || r.agency === '기타').length;

console.log(`중소벤처24 판 공고 ${rows.length}건 (활성 ${active.length}) — 수행기관이 「기타」·빈칸 ${agencyOther}건`);
console.log(`전국 태깅: 전체 ${rows.filter(isNational).length}건 / 활성 ${active.filter(isNational).length}건`);

for (const [label, pool] of [['활성', active], ['전체 이력', rows]]) {
  const hits = pool.filter(isNational).map((r) => ({ r, inTitle: namesIn(r.title), inAgency: namesIn(r.agency) }))
    .filter((h) => h.inTitle.length || h.inAgency.length);
  console.log(`\n[${label}] 전국인데 제목·수행기관에 시·군 이름: ${hits.length}건`);
  for (const { r, inTitle, inAgency } of hits) {
    const open = OPEN_BEYOND.test(r.summary_full || '') ? '본문상 관외 허용' : '본문 확인 필요';
    console.log(`  ${r.pblanc_id}  ${r.title}  — 제목:${inTitle.join('/') || '-'} 기관:${inAgency.join('/') || '-'} · ${open}`);
  }
}

// 시·군이 제목에 2곳 이상인데 그 시·군이 서로 다른 시도에 걸친 공고 (지역축 과소 판정 후보)
// 예) 「울산시ㆍ경주시ㆍ포항시 해오름동맹」 → 울산만 붙고 경주·포항(경북) 기업이 빠진다
const SIDO_OF = new Map(divisions.sido.flatMap((s) => [[s.short, s.appCodes]]));
const sidoOfName = (n) => [...new Set(divisions.sigungu.filter((s) => s.name === n).flatMap((s) => SIDO_OF.get(s.sido) || []))];
const crossSido = active.filter((r) => {
  if (isNational(r)) return false;
  // 시도 통합(전남광주 등)으로 한 시·군이 여러 지역코드에 걸치므로 「하나도 안 겹칠 때」만 센다
  return namesIn(r.title).some((n) => !sidoOfName(n).some((c) => (r.region_codes || []).includes(c)));
});
console.log(`\n[활성] 제목의 시·군이 속한 시도가 region_codes 에 빠진 공고: ${crossSido.length}건`);
for (const r of crossSido) console.log(`  ${r.pblanc_id}  ${r.title}  — region:${(r.region_codes || []).join(',')}`);
