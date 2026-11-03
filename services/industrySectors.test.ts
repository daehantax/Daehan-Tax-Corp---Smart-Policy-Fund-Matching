// 업종 꼬리표 — 공고의 제외 업종과 우리 거래처의 업종코드를 같은 말로 바꾼다 (C-12)
//
// 조견표 쪽 케이스는 **실제 `industry_codes` 1,542줄에서 가져온 이름**이고,
// 공고 쪽 케이스는 **실제 첨부에서 뽑은 「업종명(KSIC)」 74종**에서 가져왔다.
//
// ⚠ 이 꼬리표는 **경고 근거**지 제외 근거가 아니다. 맞아도 공고를 지우지 않는다.
import { describe, expect, it } from 'vitest';
import {
  SECTORS,
  isSectorTag,
  sectorLabel,
  sectorsOfIndustryRow,
  sectorsOfKsic,
  sectorsOfName,
} from '../scripts/industry-sectors.mjs';

describe('sectorsOfName — 업종 이름으로 꼬리표 찾기', () => {
  it.each([
    // 공고가 적는 꼴 (띄어쓰기 없음)
    ['일반유흥주점업', '유흥주점'],
    ['무도유흥주점업', '유흥주점'],
    ['비주거용건물임대업', '부동산임대'],
    ['부동산 중개·대리업', '부동산중개'],
    ['부동산 분양 대행업', '부동산중개'],
    ['그 외 기타 금융 지원 서비스업', '금융'],
    ['보험대리 및 중개업', '보험'],
    ['손해사정업', '보험'],
    ['가상자산 매매 및 중개업', '가상자산'],
    ['기타 사행시설 관리 및 운영업', '사행도박'],
    ['경주장 및 동물 경기장 운영업', '사행도박'],
    ['무도장운영업', '무도오락'],
    ['담배도매업', '담배주류도매'],
    ['점술 및 유사서비스업', '점술개인서비스'],
    ['유사의료업', '유사의료'],
    // 조견표가 적는 꼴 (띄어쓰기 있음) — 같은 것으로 읽혀야 한다
    ['일반 유흥 주점업', '유흥주점'],
    ['주거용 건물 임대업', '부동산임대'],
    ['카지노 운영업, 기타 사행시설 관리 및 운영업', '사행도박'],
  ])('%s → %s', (name, tag) => {
    expect(sectorsOfName(name)).toContain(tag);
  });

  it.each([
    // 제외 업종이 **아닌** 것들 — 공고에 코드가 적혀 있어도 지원 대상이다
    '경영 컨설팅업',
    '배관 및 냉·난방 공사업',
    '환경설비 건설업',
    '조경 건설업',
    '소방시설 공사업',
    '전자상거래 소매 중개업',
    '곡물 및 기타 식량작물 재배업',
  ])('%s 에는 꼬리표를 붙이지 않는다', (name) => {
    expect(sectorsOfName(name)).toEqual([]);
  });

  it('빈 값은 빈 배열이다', () => {
    expect(sectorsOfName('')).toEqual([]);
    expect(sectorsOfName(null)).toEqual([]);
    expect(sectorsOfName(undefined)).toEqual([]);
  });
});

describe('sectorsOfKsic — 통계청 코드로 꼬리표 찾기', () => {
  it.each([
    ['56211', '유흥주점'],
    ['68112', '부동산임대'],
    ['68221', '부동산중개'],
    ['66199', '금융'],
    ['66202', '보험'],
    ['63992', '가상자산'],
    ['91249', '사행도박'],
    ['91291', '무도오락'],
    ['86902', '유사의료'],
  ])('%s → %s', (code, tag) => {
    expect(sectorsOfKsic(code)).toContain(tag);
  });

  it('5자리가 아니면 보지 않는다 — 국세청 6자리를 KSIC 로 읽으면 안 된다', () => {
    expect(sectorsOfKsic('552201')).toEqual([]);   // 국세청 일반 유흥 주점업
    expect(sectorsOfKsic('5621')).toEqual([]);
    expect(sectorsOfKsic('')).toEqual([]);
    expect(sectorsOfKsic(null)).toEqual([]);
  });
});

describe('sectorsOfIndustryRow — 국세청 조견표 한 줄', () => {
  it('세세분류 이름으로 붙는다', () => {
    expect(sectorsOfIndustryRow({
      code: '701201', biz_category: '부동산업', mid_category: '부동산업',
      sub_category: '비주거용 건물 임대업', detail_category: '비주거용 건물 임대업(점포, 자기땅)',
    })).toContain('부동산임대');
  });

  it('국세청 유흥주점 코드(552201)도 이름으로 잡힌다', () => {
    expect(sectorsOfIndustryRow({
      code: '552201', mid_category: '음식점 및 주점업',
      sub_category: '주점업', detail_category: '일반 유흥 주점업',
    })).toContain('유흥주점');
  });

  it.each([
    // ⚠ 세분류 「오락장 운영업」을 그대로 잡으면 PC방 101곳이 딸려온다 — 세세분류만 본다
    [{ sub_category: '오락장 운영업', detail_category: '컴퓨터 게임방 운영업' }, '컴퓨터 게임방(PC방)'],
    [{ sub_category: '오락장 운영업', detail_category: '노래 연습장 운영업' }, '노래 연습장'],
  ])('%#: %s 에는 꼬리표를 붙이지 않는다', (row) => {
    expect(sectorsOfIndustryRow(row)).toEqual([]);
  });

  it('무도장·전자게임장은 붙는다 — 공고가 실제로 제외 목록에 올리는 것들이다', () => {
    expect(sectorsOfIndustryRow({ sub_category: '오락장 운영업', detail_category: '무도장 운영업' }))
      .toContain('무도오락');
    expect(sectorsOfIndustryRow({ sub_category: '오락장 운영업', detail_category: '전자 게임장 운영업' }))
      .toContain('무도오락');
  });

  it('업종코드가 없는 줄은 빈 배열이다 — 모르는 것과 해당 없는 것은 다르다', () => {
    expect(sectorsOfIndustryRow({})).toEqual([]);
    expect(sectorsOfIndustryRow(null)).toEqual([]);
  });

  it('division 은 조견표 쪽에서 보지 않는다 — 중분류가 「부동산업」인 줄에 임대·중개가 다 붙으면 안 된다', () => {
    const row = { mid_category: '부동산업', sub_category: '부동산 감정 평가업', detail_category: '부동산 감정 평가업' };
    expect(sectorsOfIndustryRow(row)).not.toContain('부동산임대');
  });
});

describe('꼬리표 목록 자체', () => {
  it('11종이고 이름이 겹치지 않는다', () => {
    expect(SECTORS).toHaveLength(11);
    expect(new Set(SECTORS.map((s) => s.tag)).size).toBe(11);
  });

  it('모든 꼬리표에 사람이 읽을 이름이 있다', () => {
    for (const s of SECTORS) {
      expect(isSectorTag(s.tag)).toBe(true);
      expect(sectorLabel(s.tag)).toBe(s.label);
      expect(s.label.length).toBeGreaterThan(2);
    }
  });

  it('모르는 꼬리표는 그대로 돌려준다', () => {
    expect(isSectorTag('제조업')).toBe(false);
    expect(sectorLabel('제조업')).toBe('제조업');
  });
});
