// =============================================================================
// [조사용] C-8 중소벤처24 구조화 필드 실태조사
//
// ⚠ 조사(research) 전용. 운영 파이프라인에 연결하지 않는다. → docs/WORK_PLAN.md C-8
//
// 왜: 중소벤처24 응답에는 매출·업력·근로자수·인증·대표자연령·여성대표·업종이
//   **구조화된 값으로 들어온다**(필드 목록은 public/data/grants_meta.json 에 매일 기록된다).
//   그런데 scripts/extra-sources.mjs 의 smes24ToItem() 이 제목·날짜·URL·지역만 남기고
//   나머지를 전부 버린다. 버리는 값이 실제로 **얼마나 채워져 오는지**를 재는 것이 C-8이다.
//   이 숫자에 따라 A-8(첨부파일 AI 추출)의 범위가 달라진다 — 공짜로 얻는 조건이 많을수록
//   AI로 읽어야 할 공고가 줄어든다.
//
// 공고 데이터는 **공개 자료다.** 고객사 정보는 건드리지 않는다.
//
// 사용법:
//   SMES24_API_KEY=... node scripts/research/audit-smes24-fields.mjs
//   SURVEY_DAYS=180 node scripts/research/audit-smes24-fields.mjs    # 조회 기간
//
//   키는 저장소 시크릿에만 있다(읽을 수 없다). 그래서 보통은 GitHub Actions 로 돌린다:
//   gh workflow run research-smes24.yml -f days=180
//
// 출력: 필드별 채움률 + 코드 필드의 값 분포 + 첨부파일 URL 유무. 전부 집계값이다.
// =============================================================================

import { findList, smes24ToItem, dropDuplicates } from '../extra-sources.mjs';

const DAYS = Number(process.env.SURVEY_DAYS || 180);
const URL_ = process.env.SMES24_API_URL || 'https://portal.smes.go.kr/ione-gw/api/pblanc/list';
const KEY = process.env.SMES24_API_KEY;

if (!KEY) {
  console.error('SMES24_API_KEY 가 없다. 키는 저장소 시크릿에만 있으므로 보통은 Actions 로 돌린다:');
  console.error('  gh workflow run research-smes24.yml -f days=180');
  process.exit(1);
}

// ── 받아오기 ─────────────────────────────────────────────────────────────────
const end = new Date();
const start = new Date(end.getTime() - DAYS * 86400_000);
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const sep = URL_.includes('?') ? '&' : '?';
const res = await fetch(
  `${URL_}${sep}token=${encodeURIComponent(KEY)}&strDt=${ymd(start)}&endDt=${ymd(end)}&html=no`,
  { signal: AbortSignal.timeout(120_000) },
);
const text = await res.text();
if (!res.ok) {
  // 키가 오류 문구에 섞여 나올 수 있다 — 로그는 공개된다. 상태코드만 남긴다
  console.error(`HTTP ${res.status} — 본문은 키가 섞일 수 있어 찍지 않는다 (${text.length}바이트)`);
  process.exit(1);
}
const list = findList(JSON.parse(text));
if (!Array.isArray(list)) { console.error('목록을 찾지 못했다'); process.exit(1); }

console.log(`\n측정일 ${new Date().toISOString().slice(0, 10)} · 조회기간 최근 ${DAYS}일 · 수신 ${list.length}건\n`);

// ── 기업마당과 겹치는 건을 가른다 ────────────────────────────────────────────
// 겹치는 공고는 기업마당 쪽을 남기므로(extra-sources.mjs), 중소벤처24가 들고 온 구조화 값도
// 같이 버려진다. 「중소벤처24에만 있는 공고」와 「겹쳐서 버려지는 공고」를 나눠 센다 —
// 뒤쪽이 많으면 **공고는 기업마당 것을 쓰되 값만 가져오는 길**을 따로 내야 한다.
let base = [];
const sbUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const sbKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
if (sbUrl && sbKey) {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const db = createClient(sbUrl, sbKey);
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from('policy_grants').select('id, title').range(from, from + 999);
      if (error) throw new Error(error.message);
      base.push(...data);
      if (data.length < 1000) break;
    }
    base = base.filter((r) => !String(r.id ?? '').startsWith('SMES24-'));
  } catch (err) {
    console.log(`(policy_grants 를 읽지 못해 중복 구분은 건너뛴다: ${err.message})\n`);
    base = [];
  }
}
const { kept, dropped } = base.length
  ? dropDuplicates(base, list, (it) => it.title ?? it.pblancNm)
  : { kept: list, dropped: [] };
if (base.length) {
  console.log(`■ 기업마당과의 중복 (기업마당 쪽 ${base.length}건과 대조)`);
  console.log(`  중소벤처24에만 있는 공고   ${kept.length}건`);
  console.log(`  기업마당과 겹치는 공고     ${dropped.length}건  ← 지금은 통째로 버린다`);
  console.log(`                              구조화 값은 중소벤처24에만 있으므로, 겹치는 건도`);
  console.log(`                              **값만 옮겨 붙이는 길**이 필요한지 아래 채움률로 판단한다\n`);
}

// ── 필드별 채움률 ────────────────────────────────────────────────────────────
const filled = (v) => v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== '-';
const rate = (items, f) => items.filter((it) => filled(it[f])).length;
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');

// 매칭에 쓸 수 있는 필드만 추려 본다. 묶음 이름은 §7 「공고가 거는 조건」과 맞춘다.
const GROUPS = [
  ['매출액', ['salsAmt', 'salsAmtCd', 'minSalsAmt', 'maxSalsAmt']],
  ['업력', ['ablbiz', 'ablbizCd', 'minAblbiz', 'maxAblbiz']],
  ['근로자수', ['emplyCnt', 'emplyCntCd', 'minEmplyCnt', 'mixEmplyCnt']],
  ['기업규모', ['cmpScale', 'cmpScaleCd']],
  ['업종', ['induty', 'bizType', 'bizTypeCd']],
  ['인증', ['needCrtfn', 'needCrtfnCd']],
  ['대표자 연령', ['rpsntAge', 'minRpsntAge', 'maxRpsntAge']],
  ['여성대표', ['fmleRpsntYn']],
  ['지역', ['areaNm', 'areaCd']],
  ['성장단계', ['lifeCyclDvsn', 'lifeCyclDvsnCd']],
  ['지원금액·금리', ['minSportAmt', 'maxSportAmt', 'minInrst', 'maxInrst']],
  ['첨부파일', ['pblancAttach', 'pblancAttachNm', 'pblancFileUrl', 'pblancFileNm']],
  // 조건 슬롯이 비어 오면 남는 길은 본문뿐이다 — 본문이 얼마나 오는지도 같이 센다
  ['본문(규칙 추출용)', ['policyCnts', 'sportTrget', 'sportCnts', 'sportMg', 'detailBsnsNm', 'sportType']],
];

for (const [group, fields] of GROUPS) {
  console.log(`■ ${group}`);
  for (const f of fields) {
    const a = rate(list, f), b = rate(kept, f);
    console.log(`  ${f.padEnd(16)} 전체 ${String(a).padStart(5)}/${list.length} ${pct(a, list.length).padStart(7)}`
      + `   중복제외분 ${String(b).padStart(5)}/${kept.length} ${pct(b, kept.length).padStart(7)}`);
  }
  // 코드 필드는 값 가짓수가 적다 — 코드표를 따로 구해야 하는지 바로 보인다
  for (const f of fields.filter((x) => /Cd$/.test(x) || /^(salsAmt|ablbiz|emplyCnt|cmpScale|needCrtfn|rpsntAge|lifeCyclDvsn|fmleRpsntYn)$/.test(x))) {
    const vals = [...new Set(list.map((it) => String(it[f] ?? '').trim()).filter((v) => v && v !== '-'))];
    if (vals.length && vals.length <= 25) {
      console.log(`     ${f} 값 ${vals.length}가지: ${vals.slice(0, 25).join(' · ')}`);
    } else if (vals.length) {
      console.log(`     ${f} 값 ${vals.length}가지 (보기: ${vals.slice(0, 6).join(' · ')} …)`);
    }
  }
  console.log('');
}

// ── 키는 오는데 값이 한 건도 없는 필드 ───────────────────────────────────────
// grants_meta.json 의 smes24Fields 는 **첫 항목의 키 이름만** 모은 것이라(extra-sources.mjs)
// 「필드가 온다 = 값이 온다」가 아니다. 빈 슬롯을 따로 세어 그 착각을 못 하게 한다.
const allKeys = [...new Set(list.flatMap((it) => Object.keys(it)))].sort();
const empty = allKeys.filter((k) => !list.some((it) => filled(it[k])));
console.log('■ 키는 오는데 값이 한 건도 없는 필드');
console.log(`  ${empty.length}/${allKeys.length}개: ${empty.join(' · ') || '(없음)'}
`);

// ── 조건을 하나라도 들고 오는 공고 ───────────────────────────────────────────
const COND = ['minSalsAmt', 'maxSalsAmt', 'minAblbiz', 'maxAblbiz', 'minEmplyCnt', 'mixEmplyCnt',
  'needCrtfn', 'minRpsntAge', 'maxRpsntAge', 'fmleRpsntYn', 'induty', 'cmpScale'];
const anyCond = (it) => COND.some((f) => filled(it[f]));
console.log(`■ 조건 필드를 하나라도 들고 오는 공고`);
console.log(`  전체 ${list.filter(anyCond).length}/${list.length}  ${pct(list.filter(anyCond).length, list.length)}`);
console.log(`  중복제외분 ${kept.filter(anyCond).length}/${kept.length}  ${pct(kept.filter(anyCond).length, kept.length)}`);
const perItem = list.map((it) => COND.filter((f) => filled(it[f])).length);
console.log(`  공고당 조건 개수: 0개 ${perItem.filter((n) => n === 0).length} · 1~2개 ${perItem.filter((n) => n >= 1 && n <= 2).length}`
  + ` · 3~5개 ${perItem.filter((n) => n >= 3 && n <= 5).length} · 6개+ ${perItem.filter((n) => n >= 6).length}`);

// ── 본문 길이 ────────────────────────────────────────────────────────────────
// 규칙·AI 로 읽어야 할 분량이다. 너무 짧으면 조건이 본문에도 없다는 뜻이다.
const lens = list.map((it) => ['policyCnts', 'sportTrget', 'sportCnts', 'sportMg']
  .map((f) => String(it[f] ?? '')).join(' ').trim().length).sort((a, b) => a - b);
const q = (p) => lens[Math.floor((lens.length - 1) * p)] ?? 0;
console.log(`
■ 본문 길이(policyCnts+sportTrget+sportCnts+sportMg, 글자)`);
console.log(`  0자 ${lens.filter((n) => n === 0).length}건 · 중앙값 ${q(0.5)} · 상위 10% ${q(0.9)} · 최대 ${lens[lens.length - 1]}`);

// ── 지금 버려지는 값 ─────────────────────────────────────────────────────────
// smes24ToItem() 을 실제로 돌려서, 들어온 필드 중 몇 개가 살아남는지 눈으로 확인한다
const sample = list.find(anyCond);
if (sample) {
  const mapped = smes24ToItem(sample);
  const inKeys = Object.keys(sample).filter((k) => filled(sample[k]));
  const survived = inKeys.filter((k) => JSON.stringify(mapped).includes(String(sample[k]).slice(0, 20)));
  console.log(`\n■ 지금 매핑에서 살아남는 값 (조건이 붙은 공고 한 건 기준)`);
  console.log(`  들어온 값 ${inKeys.length}개 → 살아남는 값 약 ${survived.length}개`);
  console.log(`  버려지는 조건 필드: ${COND.filter((f) => filled(sample[f])).join(' · ') || '(이 건에는 없음)'}`);
}
console.log('');
