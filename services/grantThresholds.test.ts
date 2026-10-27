// 공고 본문에서 기준선 숫자 뽑기 — 매출액 · 업력 · 근로자수
//
// 케이스는 전부 **2026-10-27 노출 중인 실제 공고 1,518건에서 가져온 문장**이다.
// 지어낸 문장이 아니다. 실패하면 그 공고가 다시 틀리게 읽힌다는 뜻이다.
//
// 이 추출기의 기본값은 **「모른다」** 다. 못 읽으면 화면에 「공고문 확인 필요」로 남는다.
// 잘못 읽어서 자격 있는 공고를 지우는 쪽이 훨씬 나쁘다(CLAUDE.md).
import { describe, expect, it } from 'vitest';
import {
  extractBusinessYears,
  extractEmployees,
  extractRevenue,
  extractThresholds,
} from '../scripts/grant-thresholds.mjs';

const 억 = 100_000_000;
const 만 = 10_000;

describe('extractRevenue — 매출액 기준선', () => {
  it.each([
    ['연매출 10억원 이하 동백전 가맹점(소상공인)', null, 10 * 억],
    ['전년도(2025년도) 총매출액 5억 이하 카드가맹점', null, 5 * 억],
    ['2025년도 매출액 3억5천만원 이하의 경주시 소상공인', null, 3.5 * 억],
    ['전년도 매출액 120억원 미만인 도내 소재 중소기업', null, 120 * 억],
    ['당기매출액 500억원 미만인 본사 또는 주사업장의 소재지가 화성시에 있는 중소기업', null, 500 * 억],
    ['남동구에 본사 또는 공장이 소재한 연 매출 300억 미만 중소기업', null, 300 * 억],
    ['직전 연도 매출액이 1천2백만원 이상 6억원 이하일 것', 1200 * 만, 6 * 억],
  ])('%s', (text, min, max) => {
    expect(extractRevenue(text)).toEqual({ min, max });
  });

  // ── 읽으면 안 되는 것들 ──────────────────────────────────────────────────
  it('기간이 한정된 매출은 연매출이 아니다 — 우리 값과 비교하면 오탐(誤探)이 난다', () => {
    // 연 8천만원(반기 4천만원)인 가게가 자격 없다고 걸러져 버린다
    expect(extractRevenue('2026년 상반기(1~6월) 매출액 5천만원 이하')).toBeNull();
    expect(extractRevenue('최근 3개월 매출액 1억원 이하')).toBeNull();
    expect(extractRevenue('월 평균 매출액 2천만원 이하')).toBeNull();
  });

  it('계산식은 기준선이 아니다', () => {
    expect(extractRevenue('연 매출액이 기준 피보험자 수x1,900만원 이상인 기업')).toBeNull();
  });

  it('매출이 아닌 금액에 반응하지 않는다', () => {
    expect(extractRevenue('공사금액 7억 미만 소규모 건설공사 현장')).toBeNull();
    expect(extractRevenue('공사금액 1억 원 미만의 초소규모 건설현장')).toBeNull();
  });

  it('같은 줄의 다른 금액이 딸려 들어오지 않는다', () => {
    // 창을 절 경계(' - ')에서 끊지 않으면 30만원이 매출 하한이 돼 버렸다
    const r = extractRevenue('전년도 매출액 5억원 이하 - 월 임차료 30만원 이상');
    expect(r).toEqual({ min: null, max: 5 * 억 });
  });

  it('우대 조항은 자격이 아니다', () => {
    expect(extractRevenue('중소기업 (연매출 10억원 이하 기업 우대)')).toBeNull();
  });

  it('맨숫자를 금액으로 읽지 않는다 — 연도·점수와 구분되지 않는다', () => {
    expect(extractRevenue('2025년 매출액 기준을 충족하는 사업자')).toBeNull();
    expect(extractRevenue('NCB 595점 ~ 964점이고, 매출액 기준을 충족하는 법인사업자')).toBeNull();
  });
});

describe('extractBusinessYears — 업력 기준선 (단위: 년)', () => {
  it.each([
    ['서울시 소재 업력 3년 이상 주얼리 소공인 및 제조업체', 3, null],
    ['공고일 기준 업력 7년 이상의 중소기업', 7, null],
    ['청주시에 주소지를 두고 있는 업력 7년 미만 창업 기업', null, 7],
    ['울산광역시 소재 콘텐츠 분야 창업 3년 이내 스타트업', null, 3],
    ['충남 소재 7년 미만 기술기반 창업기업', null, 7],
    ['중기부가 지정한 운영사로부터 先투자받은 유망 소상공인(업력 1년이상)', 1, null],
  ])('%s', (text, min, max) => {
    expect(extractBusinessYears(text)).toEqual({ min, max });
  });

  it('개월은 년으로 환산한다', () => {
    expect(extractBusinessYears('업력 6개월 이상이며, 매출액 기준을 충족하는 법인사업자'))
      .toEqual({ min: 0.5, max: null });
  });

  it('사람 나이를 업력으로 읽지 않는다', () => {
    // '세'는 받지 않는다. 같은 문장에 둘 다 있어도 업력만 가져온다
    expect(extractBusinessYears('대표자 연령이 만 55세 이상 및 업력 만 5년 이상일 것'))
      .toEqual({ min: 5, max: null });
    expect(extractBusinessYears('만 18~45세의 청년(법인 제외)')).toBeNull();
  });

  it('물건의 나이를 업력으로 읽지 않는다', () => {
    // "설립 10년 이상 **노후 시설**" — 기업이 아니라 시설이 10년 된 것이다
    expect(extractBusinessYears('설립 10년 이상 노후 시설을 보유한 상시 근로자 30인미만')).toBeNull();
  });

  it('우대 조항은 자격이 아니다', () => {
    // "(창업 7년 미만 기업 우대)" 를 조건으로 읽으면 8년차에게 자격 없다는 신호가 간다
    expect(extractBusinessYears('서울소재 중소기업 중 아래 요건을 충족한 기업 (창업 7년 미만 기업 우대)'))
      .toBeNull();
  });

  it('「중 한가지 이상」 뒤의 조건은 모두에게 걸리는 조건이 아니다', () => {
    const t = '상시근로자 수 5~300인 미만으로서(아래 조건 중 한가지 이상 해당)'
      + ' - 가족친화인증을 받은 중소기업 - 새일센터를 통해 창업한 기업(창업 후 1년 이내)';
    expect(extractBusinessYears(t)).toBeNull();
  });
});

describe('extractEmployees — 근로자수 기준선 (단위: 명)', () => {
  it.each([
    ['경기도에 소재지를 둔 상시근로자 10인 이상 중소기업', 10, null],
    ['사업장 소재지가 울산인 상시근로자 50인 미만 중소기업', null, 50],
    ['마을기업, 협동조합 및 고용 10인미만의 사회연대 경제 관련 비영리 법인', null, 10],
    ['고용보험 피보험자 10인 이상 기업, 공공기관, 지방공기업', 10, null],
    ['근로자 수가 3명 이상인 관내 중소기업', 3, null],
    ['상시근로자 5인 이상 300인 미만의 중소기업', 5, 300],
    ['도내 상시근로자 수 5인 이상 100인 미만 산재예방 우수 기업', 5, 100],
    ['상시근로자 5인 이상 500인 이하인 울산 소재 자동차부품 기업', 5, 500],
  ])('%s', (text, min, max) => {
    expect(extractEmployees(text)).toEqual({ min, max });
  });

  it('앞 숫자에 단위가 없는 범위꼴도 읽는다', () => {
    // '5~300인 미만' — 5 뒤에 '인'이 없어 하한을 놓쳤었다
    expect(extractEmployees('상시근로자 수 5~300인 미만으로서')).toEqual({ min: 5, max: 300 });
  });

  it('나이를 인원으로 읽지 않는다', () => {
    expect(extractEmployees('만 15-34세 취업애로청년을 정규직으로 신규 채용')).toBeNull();
    expect(extractEmployees('40~64세 서울시민을 신규 채용한 기업')).toBeNull();
  });

  // 가장 중요한 케이스 — 좁게 합치면 직원 7명인 제조업체가 잘못 걸러진다
  it('업종별로 기준이 갈리면 **넓은 쪽**을 택한다', () => {
    const t = '광업ㆍ제조업ㆍ건설업ㆍ운수업 : 상시종업원 10인 미만 업체'
      + ' - 그 외의 업종 : 상시종업원 5인 미만 업체';
    expect(extractEmployees(t)).toEqual({ min: null, max: 10 });
  });

  it('배분 비율은 기준선이 아니다 — 말이 안 되는 값은 버린다', () => {
    // "5인 미만(70%), 5인 이상(30%)" 에서 하한 5 · 상한 5 가 나왔었다
    expect(extractEmployees('근로자 5인 미만 기업(70%), 5인 이상 기업(30%)')).toBeNull();
  });
});

describe('extractThresholds — 묶음', () => {
  it('읽은 축만 담는다 — 못 읽은 것과 「제한 없음」은 다르다', () => {
    const r = extractThresholds('도내 상시근로자 수 5인 이상 100인 미만 산재예방 우수 기업');
    expect(r).toEqual({ employees: { min: 5, max: 100 } });
    expect(r.revenue).toBeUndefined();
    expect(r.years).toBeUndefined();
  });

  it('한 공고에서 여러 축을 함께 읽는다', () => {
    const r = extractThresholds('업력 3년 이상, 연매출 10억원 이하, 상시근로자 5인 이상 기업');
    expect(r.years).toEqual({ min: 3, max: null });
    expect(r.revenue).toEqual({ min: null, max: 10 * 억 });
    expect(r.employees).toEqual({ min: 5, max: null });
  });

  it('조건이 없으면 빈 객체다', () => {
    expect(extractThresholds('부산시 소재 소상공인')).toEqual({});
    expect(extractThresholds('')).toEqual({});
  });
});
