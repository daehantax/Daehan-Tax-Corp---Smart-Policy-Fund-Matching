import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { extractRegionCodes as tsRegion, extractSigunguCodes as tsSigungu } from './matchingService';
import {
  loadDivisions,
  extractRegionCodes as jsRegion,
  extractSigunguCodes as jsSigungu,
  extractSupportAmount,
  __setSidoOf,
} from '../scripts/sync-bizinfo.mjs';

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
