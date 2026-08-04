import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extractRegionCodes as tsRegion, extractSigunguCodes as tsSigungu } from './matchingService';
import {
  loadDivisions,
  extractRegionCodes as jsRegion,
  extractSigunguCodes as jsSigungu,
  extractSupportAmount,
  extractTargetFlags,
  __setSidoOf,
} from '../scripts/sync-bizinfo.mjs';
import { INDUSTRY_MISMATCH_FLAGS, OWNER_MISMATCH_FLAGS } from './matchingService';

// 동기화 스크립트는 Node 단독 실행이라 앱의 TS 모듈을 불러올 수 없고, 같은 규칙을
// 복제해 두고 있다(주석으로 "함께 수정할 것"이라 표시). 한쪽만 고치면 DB에 저장되는
// 값과 화면 계산값이 어긋나는데, 그건 조용히 틀리므로 알아채기 어렵다.
// 이 테스트가 두 구현이 같은 답을 내는지 지킨다.

beforeAll(() => {
  const file = path.resolve(__dirname, '../data/administrative-divisions.json');
  const divisions = JSON.parse(readFileSync(file, 'utf8'));
  const { sidoOf } = loadDivisions(divisions);
  __setSidoOf(sidoOf);
});

const ALL_SIDO_TAGS = '서울 부산 대구 인천 광주 대전 울산 세종 경기 강원 충북 충남 전북 전남 경북 경남 제주';

const REGION_CASES: Array<[string, string, string, string, string?]> = [
  ['경기도', '경기도경제과학진흥원', '경영 경기', '[경기] 우수 벤처기업 표창', ''],
  ['고용노동부', '노사발전재단', ALL_SIDO_TAGS, '2026년 노사문화 우수기업 선정', ''],
  ['고용노동부', '강원특별자치도경제진흥원', ALL_SIDO_TAGS, '2026년 2차 강원 영동권 관광 가치이음 지원사업', ''],
  ['고용노동부', '', ALL_SIDO_TAGS, '[호남권] 기업맞춤 고용지원사업', ''],
  ['고용노동부', '', '경기', '[경기] 수원시ㆍ용인시ㆍ화성시 청년일자리도약장려금(수도권형)', ''],
  ['중소벤처기업부', '', '', '2026년 2차 프리팁스 창업기업 모집', '비수도권 소재 기업'],
  ['충청북도', '', '충북', '[충북] 청년일자리도약장려금', '비수도권 대상'],
  ['해양수산부', '한국해양교통안전공단', ALL_SIDO_TAGS, '2026년 2차 친환경인증선박 보급지원사업 공고', ''],
  ['중소벤처기업부', '중소벤처기업진흥공단', '금융', '2026년 정책자금 융자계획', ''],
  ['전남광주통합특별시', '전남바이오진흥원', ALL_SIDO_TAGS, '2026년 3차 해남 김ㆍ고구마 대박상품 개발', ''],
];

describe('앱(TS)과 동기화 스크립트(JS)의 지역 판정이 같아야 한다', () => {
  it.each(REGION_CASES)('%s / %s / %s', (dept, agency, tags, title, body) => {
    const ts = tsRegion(dept, agency, tags, title, body).sort();
    const js = jsRegion(dept, agency, tags, title, body).sort();
    expect(js).toEqual(ts);
  });
});

const SIGUNGU_CASES: Array<[string, string, string[]]> = [
  ['[경기] 화성시 2026년 중소기업 노동자 기숙사 임차비 지원사업', '', ['경기']],
  ['[경남] 창원시ㆍ진주시ㆍ거제시ㆍ김해시 2026년 청년여성 일경험', '', ['경남']],
  ['[경기] 2026년 IoT 측정기기 부착 지원사업', '경영,경기,남양주시,경기도', ['경기']],
  ['[광주] 2026년 광주여자대학교 RISE사업단 지원', '동구,서구,남구,북구,광산구', ['광주']],
  ['2026년 강소특구 글로벌 현지 실증 지원', '강소특구,서구', ['대전']],
  ['[대구] 중구 2026년 소상공인 지원사업', '', ['대구']],
  ['[경기] 광주시니어클럽 채용 공고', '', ['경기']],
  ['[강원] 고성군 2026년 지원사업', '', ['강원']],
  ['[경기] 고성군 2026년 지원사업', '', ['경기']],
  ['2026년 3차 해남 김ㆍ고구마 대박상품 개발', '전남,해남', ['전남']],
];

describe('앱(TS)과 동기화 스크립트(JS)의 시·군 판정이 같아야 한다', () => {
  it.each(SIGUNGU_CASES)('%s', (title, tags, regions) => {
    const ts = tsSigungu(title, tags, regions).sort();
    const js = jsSigungu(title, tags, regions).sort();
    expect(js).toEqual(ts);
  });
});

describe('앱의 판정 규칙이 참조하는 플래그를 동기화 스크립트가 실제로 붙이는가', () => {
  // 이름이 어긋나면 판정이 조용히 꺼진다. 스크립트 쪽에서 그 플래그가 나오는
  // 최소 입력을 만들어 실제로 붙는지 확인한다.
  const SAMPLES: Record<string, { title: string; target: string; summary: string }> = {
    '제조업': { title: '제조업 지원사업', target: '중소기업', summary: '☞ 제조업 영위기업' },
    '공장보유': { title: '설비 지원사업', target: '중소기업', summary: '☞ 공장등록증 보유 기업' },
    '산업:자동차': { title: '자동차산업 신규입직자 지원', target: '중소기업', summary: '☞ 자동차산업 영위기업' },
    '산업:조선': { title: '중소조선 지원사업', target: '중소기업', summary: '☞ 조선산업 관련 기업' },
    '산업:섬유': { title: '섬유산업 지원', target: '중소기업', summary: '☞ 섬유산업 영위기업' },
    '산업:식품': { title: '식품산업 지원', target: '중소기업', summary: '☞ 식품산업 영위기업' },
    '산업:반도체': { title: '반도체산업 지원', target: '중소기업', summary: '☞ 반도체산업 기업' },
    '산업:바이오': { title: '바이오산업 지원', target: '중소기업', summary: '☞ 바이오산업 기업' },
    '산업:화학': { title: '석유화학 지원', target: '중소기업', summary: '☞ 석유화학 업종 기업' },
    '산업:뿌리': { title: '뿌리산업 지원', target: '중소기업', summary: '☞ 뿌리기업' },
    '산업:콘텐츠': { title: '콘텐츠산업 지원', target: '중소기업', summary: '☞ 콘텐츠산업 기업' },
    '산업:관광': { title: '관광산업 지원', target: '중소기업', summary: '☞ 관광기업' },
    '산업:예술': { title: '예술산업 금융지원 시범사업(융자)', target: '중소기업', summary: '☞ 예술 분야 사업자' },
    '청년창업': { title: '청년창업 지원사업', target: '창업벤처', summary: '☞ 만 39세 이하 청년창업기업' },
    '여성기업': { title: '여성기업 육성사업', target: '중소기업', summary: '☞ 여성기업' },
    '대상:법인': { title: '소상공인(법인사업자) 비즈플러스카드 지원사업', target: '소상공인', summary: '☞ 매출액 기준을 충족하는 법인사업자' },
    '대상:개인': { title: '소상공인(개인사업자) 비즈플러스카드 지원사업', target: '소상공인', summary: '☞ 매출액 기준을 충족하는 개인사업자' },
  };

  it.each([...INDUSTRY_MISMATCH_FLAGS, ...OWNER_MISMATCH_FLAGS])('%s', (flag) => {
    const s = SAMPLES[flag];
    expect(s, `앱 규칙에 있는 '${flag}' 의 샘플 입력이 이 테스트에 없다`).toBeDefined();
    expect(extractTargetFlags(s.title, s.target, s.summary)).toContain(flag);
  });
});

describe('extractTargetFlags — 자격 문단만 보는 플래그', () => {
  it('본문 뒤쪽의 부수 언급으로는 대표자 조건이 붙지 않는다', () => {
    // "여성기업 우대" 한 줄 때문에 운전자금·육성기금 공고까지 딸려 오던 문제
    const flags = extractTargetFlags(
      '[경기] 화성시 2026년 중소기업 운전자금 지원사업',
      '중소기업',
      '☞ 화성시 관내 중소기업 ☞ 융자 지원 - 여성기업 우대 가점 부여',
    );
    expect(flags).not.toContain('여성기업');
  });

  it('자격 문단(첫 ☞)에 있으면 붙는다', () => {
    expect(extractTargetFlags('여성기업 육성사업', '중소기업', '☞ 여성기업 ☞ 사업화 자금 지원'))
      .toContain('여성기업');
  });

  it('청년 채용 지원사업에는 청년창업 플래그를 붙이지 않는다', () => {
    const flags = extractTargetFlags(
      '[경북] 2026년 청년 일경험 시범사업 참여기업 모집',
      '중소기업',
      '☞ 경북 소재 중소기업 ☞ 청년 근로자 채용 시 장려금 지원',
    );
    expect(flags).not.toContain('청년창업');
  });

  it("'만 39세 이하'는 채용 조건에도 쓰이므로 대표자 조건으로 보지 않는다", () => {
    // 실제 공고: "도내 만 39세 이하 청년 여성을 채용할 기업"
    expect(extractTargetFlags(
      '[경남] 2026년 11차 청년여성 일경험 지원사업 참여기업 모집',
      '중소기업',
      '☞ 도내 만 39세 이하 청년 여성을 채용할 기업 ☞ 인건비 지원',
    )).not.toContain('청년창업');
  });

  it('나열형("A, B, C 등")은 그 유형 전용이 아니므로 배제한다', () => {
    // 실제 공고: "지식서비스산업, 문화콘텐츠산업, 벤처기업, 청년창업기업 등"
    const flags = extractTargetFlags(
      '[서울] 2026년 청년일자리도약장려금 사업 참여기업 모집',
      '중소기업',
      '☞ 서울시 종로구 소재 5인 이상 기업 - 지식서비스산업, 문화콘텐츠산업, 벤처기업, 청년창업기업 등 ☞ 장려금 지원',
    );
    expect(flags).not.toContain('산업:콘텐츠');
    expect(flags).not.toContain('청년창업');
  });

  it('택일형("A 또는 B")도 배제한다', () => {
    // 실제 공고: "소상공인 또는 여성기업"
    expect(extractTargetFlags(
      '[경남] 2026년 소상공인 온라인입점 지원사업',
      '중소기업',
      '☞ 경남 도내 사업장을 운영 중인 소상공인 또는 여성기업 ☞ 입점 지원',
    )).not.toContain('여성기업');
  });

  it('"개인사업자 또는 법인사업자"처럼 둘 다 허용하면 어느 쪽도 붙지 않는다', () => {
    const flags = extractTargetFlags('2026년 지원사업', '중소기업', '☞ 개인사업자 또는 법인사업자 ☞ 지원');
    expect(flags).not.toContain('대상:법인');
    expect(flags).not.toContain('대상:개인');
  });

  it('명시 테이블에 없는 산업 제한은 "업종 제한" 확인 필요로 알린다', () => {
    // 산업 제한은 롱테일이라 개별 규칙으로 다 덮을 수 없다
    expect(extractTargetFlags('2026년 AI 기반 조명산업의 자원순환 실증 지원', '중소기업', '☞ 중소기업'))
      .toContain('조건:업종제한');
    expect(extractTargetFlags('2026년 지원사업', '중소기업', '☞ 해운항만산업 관련 기업'))
      .toContain('조건:업종제한');
  });

  it('산업과 무관한 "○○분야" 표현은 업종 제한으로 보지 않는다', () => {
    // "기술사업화 유공자 포상"의 '포상분야', "환경형 예비사회적기업"의 '환경분야' 등
    expect(extractTargetFlags('2026년 기술사업화 유공자 포상 신청', '중소기업', '☞ 포상분야별 신청 자격'))
      .not.toContain('조건:업종제한');
    expect(extractTargetFlags('2026년 지원사업 모집', '중소기업', '☞ 모집분야 및 규모'))
      .not.toContain('조건:업종제한');
  });

  it('명시 테이블로 판정한 산업이 있으면 중복해서 확인 필요를 붙이지 않는다', () => {
    const flags = extractTargetFlags('자동차산업 신규입직자 지원', '중소기업', '☞ 자동차산업 영위기업');
    expect(flags).toContain('산업:자동차');
    expect(flags).not.toContain('조건:업종제한');
  });

  it('판정 불가 조건은 나열형이어도 표시한다 (조건이 실제로 있으므로)', () => {
    const flags = extractTargetFlags('2026년 지원사업', '중소기업', '☞ 매출액, 상시근로자 수 기준을 충족하는 기업');
    expect(flags).toContain('조건:매출액');
    expect(flags).toContain('조건:근로자수');
  });

  it('조건형은 그대로 붙는다', () => {
    expect(extractTargetFlags('여성기업 육성사업 공고', '중소기업', '☞ 여성기업 ☞ 사업화 지원'))
      .toContain('여성기업');
    expect(extractTargetFlags('자동차산업 신규입직자 지원', '중소기업', '☞ 경기도 소재 자동차산업 영위기업 ☞ 지원금'))
      .toContain('산업:자동차');
  });
});

// 지원금액은 동기화 스크립트에만 있다(원문을 그쪽만 갖고 있음).
// 자격 기준 금액을 지원금액으로 표시하면 사장님이 오해하므로 케이스로 고정한다.
describe('extractSupportAmount', () => {
  it.each([
    ['☞ 간판ㆍ인테리어ㆍ안전ㆍ위생 등 최대 300만원 지원', '300만원'],
    ['☞ 업체별 융자한도 2억원 ~ 9억원 지원', '2억원 ~ 9억원'],
    ['☞ 시설투자자금 15억원 이내, 운전자금 3억원 이내 지원', '15억원'],
    ['☞ 업체 당 5억원(시설3, 운전2) 융자 지원', '5억원'],
    ['☞ 총 180억원(업체당 최대 50백만원) 지원', '50백만원'],
    ['☞ 사업화 자금(평균 77백만원, 최대 1.5억원), 창업프로그램 등 지원', '1.5억원'],
    ['- 식품접객업소 : 5천만원 이내(화장실만 개선하는 경우는 1천만원 이내)', '5천만원'],
  ])('%s → %s', (text, expected) => {
    expect(extractSupportAmount(text)).toBe(expected);
  });

  it.each([
    ['업력 7년 이내(신산업 분야 업력 10년 이내)스타트업 - 연매출 20억원 미만 중소기업'],
    ['연매출 10억원 이상 기업만 신청 가능합니다'],
    ['자본금 5천만원 이상 법인'],
    ['단, 직전연도 매출액이 3,000억원 이상인 기업 제외'],
    ['☞ 2025년 매출액 4억원 이하, 사업자등록증 상 소재지가 울릉군인 소상공인'],
    ['본 사업은 예산 소진 시까지 접수합니다'],
  ])('자격 기준 금액은 뽑지 않는다: %s', (text) => {
    expect(extractSupportAmount(text)).toBeNull();
  });
});
