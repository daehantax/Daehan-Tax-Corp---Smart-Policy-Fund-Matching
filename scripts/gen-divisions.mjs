import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'C:/Users/User/AppData/Local/Temp/claude/C--Users-User-Documents-GitHub-DH-shared-db/0624962d-2d0a-4069-8198-a1966b18419c/scratchpad/ldong/법정동코드 전체자료.txt';
const APP = 'C:/Users/User/Documents/GitHub/DH/Daehan-Tax-Corp---Smart-Policy-Fund-Matching';

const text = new TextDecoder('euc-kr').decode(readFileSync(SRC));
const rows = text.split(/\r?\n/).slice(1).filter(Boolean).map(l => {
  const [code, name, status] = l.split('\t');
  return { code: (code || '').trim(), name: (name || '').trim(), status: (status || '').trim() };
}).filter(r => r.code && r.name);
const alive = rows.filter(r => r.status === '존재');

// 앱이 쓰는 시도 축약코드 (BizRegions 17종)와의 대응
const SIDO_SHORT = {
  '서울특별시': { short: '서울', app: ['서울'] },
  '부산광역시': { short: '부산', app: ['부산'] },
  '대구광역시': { short: '대구', app: ['대구'] },
  '인천광역시': { short: '인천', app: ['인천'] },
  '대전광역시': { short: '대전', app: ['대전'] },
  '울산광역시': { short: '울산', app: ['울산'] },
  '세종특별자치시': { short: '세종', app: ['세종'] },
  '경기도': { short: '경기', app: ['경기'] },
  '강원특별자치도': { short: '강원', app: ['강원'] },
  '충청북도': { short: '충북', app: ['충북'] },
  '충청남도': { short: '충남', app: ['충남'] },
  '전북특별자치도': { short: '전북', app: ['전북'] },
  '경상북도': { short: '경북', app: ['경북'] },
  '경상남도': { short: '경남', app: ['경남'] },
  '제주특별자치도': { short: '제주', app: ['제주'] },
  // 2026 개편: 광주광역시 + 전라남도 → 전남광주통합특별시.
  // 앱의 지역 필터는 아직 광주·전남을 따로 두므로 두 코드 모두에 대응시킨다.
  '전남광주통합특별시': { short: '전남광주', app: ['광주', '전남'] },
};

const isSidoRow = c => c.slice(2) === '00000000';
const isSigunguRow = c => c.slice(2, 5) !== '000' && c.slice(5) === '00000';

// ── 시도 ──────────────────────────────────────────────────────────────────
const sidoRows = alive.filter(r => isSidoRow(r.code));
const sido = [];
for (const r of sidoRows) {
  const m = SIDO_SHORT[r.name];
  if (!m) { console.warn(`⚠ 시도 축약 미정의: ${r.name}`); continue; }
  sido.push({ code: r.code.slice(0, 2), name: r.name, short: m.short, appCodes: m.app });
}
// 세종은 법정동코드에서 시도 행이 없고 시군구 자리에 들어온다 (3611000000)
if (!sido.some(s => s.short === '세종')) {
  const sj = alive.find(r => r.name === '세종특별자치시');
  if (sj) sido.push({ code: sj.code.slice(0, 2), name: sj.name, short: '세종', appCodes: ['세종'] });
}
sido.sort((a, b) => a.code.localeCompare(b.code));

// ── 시군구 ────────────────────────────────────────────────────────────────
const shortOf = (name) => {
  const s = name.replace(/(시|군|구)$/, '');
  return s.length >= 2 ? s : null;   // '중구' → '중' 은 너무 짧아 쓰지 않는다
};
const sigungu = [];
const seen = new Set();
const addSigungu = (r, retired) => {
  const parts = r.name.split(' ');
  if (parts.length === 1) return;                      // 세종특별자치시 (시도 자체)
  const m = SIDO_SHORT[parts[0]];
  if (!m) return;                                      // 폐지된 시도(광주광역시/전라남도) 소속 등
  const name = parts[parts.length - 1];
  const dedupe = `${m.short}|${name}`;
  if (seen.has(dedupe)) return;
  seen.add(dedupe);
  const entry = { sido: m.short, name, code: r.code.slice(0, 5) };
  if (parts.length === 3) entry.parent = parts[1];     // 일반구 (성남시 분당구)
  const sh = shortOf(name);
  if (sh) entry.short = sh;
  if (retired) entry.retired = true;
  sigungu.push(entry);
};
for (const r of alive.filter(x => isSigunguRow(x.code))) addSigungu(r, false);

// 폐지된 시·군·구도 넣는다 — 고객사 주소와 공고 원문에 옛 표기가 그대로 남아 있다.
//   예) 인천 서구·중구는 2026년 제물포구·검단구·영종구·서해구로 재편됐지만
//       거래처 주소 26건이 아직 "인천광역시 서구 …" 이다. 이름을 모르면 시·군 축이 꺼진다.
// 상위 시도가 현존하는 것만 담는다(광주광역시·전라남도 소속 옛 항목은 제외 — 통합 시도로 이미 커버).
// 단, '인천시'(경기 소속)·'대전시'(충남)·'부산시'(경남)·'대구시'(경북)처럼 지금은 시도가 된
// 옛 시(市) 항목은 제외한다 — 본문에 "인천시 소재 기업"처럼 시도를 뜻하며 등장하므로
// 남겨두면 엉뚱한 시도의 시·군으로 붙을 수 있다.
const sidoShorts = new Set(sido.map(s => s.short));
for (const r of rows.filter(x => x.status !== '존재' && isSigunguRow(x.code))) {
  const name = r.name.split(' ').pop();
  if (name.endsWith('시') && sidoShorts.has(name.slice(0, -1))) continue;
  addSigungu(r, true);
}

// ── 권역 ──────────────────────────────────────────────────────────────────
// 공고 제목·본문에 실제로 등장한 표현만 넣는다 (측정 결과 기준).
// exclude 는 "그 지역을 뺀 전국"을 뜻한다 — 비수도권 사업이 수도권 기업에게 뜨는 오탐 방지용.
//
// ⚠ 2글자 권역명은 넣지 않는다. '경인'을 넣었더니 "친환경인증선박"의 '경인'에 걸려
//   전국 사업이 수도권 전용으로 잡혔다(부분 문자열 오탐). 데이터에 '경인' 표기는 1건뿐이고
//   그 1건이 바로 이 오탐이었다. 3글자 이상만 사용한다.
const zones = {
  '수도권':   { include: ['서울', '인천', '경기'] },
  '비수도권': { exclude: ['서울', '인천', '경기'] },
  '충청권':   { include: ['대전', '세종', '충북', '충남'] },
  '호남권':   { include: ['광주', '전남', '전북'] },
  '영남권':   { include: ['부산', '대구', '울산', '경북', '경남'] },
  '대경권':   { include: ['대구', '경북'] },
  '동남권':   { include: ['부산', '울산', '경남'] },
  '강원권':   { include: ['강원'] },
  '중부권':   { include: ['대전', '세종', '충북', '충남'] },
};
for (const name of Object.keys(zones)) {
  if (name.length < 3) throw new Error(`권역명이 너무 짧아 부분 문자열 오탐 위험: ${name}`);
}

// ── 폐지·구 명칭 별칭 ─────────────────────────────────────────────────────
// 공고 원문에는 폐지된 명칭이나 축약형이 그대로 남아 있는 경우가 있어 함께 인식한다.
//   · 전라남도/광주광역시 → 2026년 전남광주통합특별시로 통합되었으나 원문에 남아 있음
//   · '충청북' 처럼 잘린 형태 → '충청북도'는 정식명 매칭으로 잡히지만 부분 표기 대비
const legacyAliases = {
  '전라남도': ['전남'], '전라북도': ['전북'], '광주광역시': ['광주'],
  '충청북': ['충북'], '충청남': ['충남'],
  '전라북': ['전북'], '전라남': ['전남'],
  '경상북': ['경북'], '경상남': ['경남'],
};

const out = {
  _comment: '행정구역 단일 출처. 생성 스크립트: scripts/gen-divisions.mjs (원본 txt는 커밋하지 않음)',
  source: {
    name: '법정동코드 전체자료',
    provider: '행정안전부 행정표준코드관리시스템(code.go.kr)',
    totalRows: rows.length,
    aliveRows: alive.length,
    note: '폐지 행은 제외. 2026년 개편(전남광주통합특별시 / 인천 제물포구·검단구·영종구·서해구 / 화성시 일반구) 반영됨',
  },
  sido,
  legacyAliases,
  sigungu,
  zones,
};

const dst = `${APP}/data/administrative-divisions.json`;
writeFileSync(dst, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log(`생성: ${dst}`);
console.log(`  시도 ${sido.length}개 / 시군구 ${sigungu.length}개 (일반구 ${sigungu.filter(s => s.parent).length}개) / 권역 ${Object.keys(zones).length}종`);

// ── 기존 사전(204종)과 대조 ───────────────────────────────────────────────
const old = new Set(JSON.parse(readFileSync(`${APP}/data/sigungu-names.json`, 'utf8')));
const now = new Set(sigungu.map(s => s.name));
const missing = [...now].filter(n => !old.has(n)).sort();
const extra = [...old].filter(n => !now.has(n)).sort();
console.log(`\n=== 기존 사전 ${old.size}종 → 공식 목록 ${now.size}종 ===`);
console.log(`\n[사전에 없어서 놓치던 것] ${missing.length}종`);
for (let i = 0; i < missing.length; i += 10) console.log('  ', missing.slice(i, i + 10).join('  '));
console.log(`\n[사전에만 있던 것 — 폐지되었거나 잘못 넣은 것] ${extra.length}종`);
console.log('  ', extra.join('  ') || '없음');
for (const e of extra) {
  const dead = rows.find(r => r.status !== '존재' && r.name.endsWith(' ' + e));
  console.log(`   · ${e} → ${dead ? '폐지된 행정구역 (' + dead.name + ')' : '공식 목록에 없음'}`);
}
