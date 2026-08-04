import { describe, expect, it } from 'vitest';
import { Grant, UserSession } from '../types';
import {
  extractRegionCodes,
  extractSigunguCodes,
  getGrantRegions,
  industryWarnings,
  matchesInterests,
  matchesRegion,
  normalizeRegionCodes,
  scoreGrant,
} from './matchingService';

const grant = (over: Partial<Grant> = {}): Grant => ({
  id: 'g1', title: '테스트 공고', department: '중소벤처기업부', agency: '',
  category: '경영', startDate: '', endDate: '', registrationDate: '2026-08-01',
  detailUrl: '#', ...over,
});

const session = (over: Partial<UserSession> = {}): UserSession => ({
  type: 'CLIENT', identifier: '1292177329', companyName: '풀하우스',
  region: '경기', sigungu: ['성남시', '분당구'], bizType: '부동산업', ...over,
});

// 17개 시도가 전부 달린 해시태그 — 기업마당이 전국 사업에 이렇게 넣는다
const ALL_SIDO_TAGS = '서울 부산 대구 인천 광주 대전 울산 세종 경기 강원 충북 충남 전북 전남 경북 경남 제주';

describe('extractRegionCodes', () => {
  it('구체적인 시도 표기(1~12개)를 가장 신뢰한다', () => {
    expect(extractRegionCodes('경기도', '경기도경제과학진흥원', '경영 경기', '[경기] 우수 벤처기업 표창')).toEqual(['경기']);
  });

  it('해시태그에 전 지역이 나열되면 전국으로 접는다', () => {
    expect(extractRegionCodes('고용노동부', '노사발전재단', ALL_SIDO_TAGS, '2026년 노사문화 우수기업 선정')).toEqual(['전국']);
  });

  it('전 지역 해시태그 + 지역 기관이면 기관을 따른다 (강원 영동권 사례)', () => {
    // 강원 8개 시·군 전용 사업인데 해시태그에 16개 시도가 달려 '전국'으로 잡혔고,
    // 성남시 고객사 추천에 떴다.
    expect(extractRegionCodes(
      '고용노동부', '강원특별자치도경제진흥원', ALL_SIDO_TAGS,
      '2026년 2차 강원 영동권 관광 가치이음 지원사업 모집 공고',
    )).toEqual(['강원']);
  });

  it('제목의 권역 표현을 펼친다', () => {
    expect(extractRegionCodes('고용노동부', '', ALL_SIDO_TAGS, '[호남권] 기업맞춤 고용지원사업')!.sort())
      .toEqual(['광주', '전남', '전북']);
  });

  it('구체적 시도가 있으면 권역보다 우선한다 (수도권형 사례)', () => {
    // "(수도권형)" 때문에 서울·인천까지 넓히면 안 된다 — 이 공고는 경기 3개 시 전용이다
    expect(extractRegionCodes(
      '고용노동부', '', '경기', '[경기] 수원시ㆍ용인시ㆍ화성시 2026년 청년일자리도약장려금(수도권형)',
    )).toEqual(['경기']);
  });

  it('본문의 권역은 다른 단서가 전혀 없을 때만 쓴다', () => {
    expect(extractRegionCodes('중소벤처기업부', '', '', '2026년 2차 프리팁스 창업기업 모집', '비수도권 소재 기업'))
      .toEqual(['비수도권']);
    // 시도가 잡히면 본문 권역은 무시
    expect(extractRegionCodes('충청북도', '', '충북', '[충북] 청년일자리도약장려금', '비수도권 대상'))
      .toEqual(['충북']);
  });

  it('아무 단서도 없으면 전국', () => {
    expect(extractRegionCodes('중소벤처기업부', '중소벤처기업진흥공단', '금융', '2026년 정책자금 융자계획')).toEqual(['전국']);
  });
});

describe('normalizeRegionCodes — DB에 남아 있는 옛 값 보정', () => {
  it('13개 이상이면 전국으로 접는다', () => {
    expect(normalizeRegionCodes(ALL_SIDO_TAGS.split(' '))).toEqual(['전국']);
  });
  it('정상 다지역은 그대로 둔다', () => {
    expect(normalizeRegionCodes(['대구', '경북'])).toEqual(['대구', '경북']);
  });
  it('비어 있으면 전국', () => {
    expect(normalizeRegionCodes([])).toEqual(['전국']);
    expect(normalizeRegionCodes(undefined)).toEqual(['전국']);
  });
});

describe('extractSigunguCodes', () => {
  it('제목 맨 앞 시·군을 잡는다', () => {
    expect(extractSigunguCodes('[경기] 화성시 2026년 중소기업 노동자 기숙사 임차비 지원사업', '', ['경기']))
      .toEqual(['화성시']);
  });

  it('복수 병기를 모두 잡는다', () => {
    expect(extractSigunguCodes('[경남] 창원시ㆍ진주시ㆍ거제시ㆍ김해시 2026년 청년여성 일경험', '', ['경남']).sort())
      .toEqual(['거제시', '김해시', '진주시', '창원시']);
  });

  it('해시태그에만 있는 시·군도 보강한다', () => {
    expect(extractSigunguCodes('[경기] 2026년 IoT 측정기기 부착 지원사업', '경영,경기,남양주시,경기도', ['경기']))
      .toEqual(['남양주시']);
  });

  it('태그에 시·군이 3개 이상이면 광역 사업으로 보고 무시한다', () => {
    // [광주] RISE사업단 공고는 태그에 광주 5개 구가 전부 달려 있었다 = 광주 전역
    expect(extractSigunguCodes('[광주] 2026년 광주여자대학교 RISE사업단 지원', '동구,서구,남구,북구,광산구', ['광주']))
      .toEqual([]);
  });

  it('2글자 자치구는 태그 경로에서 인정하지 않는다', () => {
    // '강소특구'가 '서구' 전용으로 잡히던 오탐
    expect(extractSigunguCodes('2026년 강소특구 글로벌 현지 실증 지원', '강소특구,서구', ['대전'])).toEqual([]);
    // 제목 패턴으로는 인정한다
    expect(extractSigunguCodes('[대구] 중구 2026년 소상공인 지원사업', '', ['대구'])).toEqual(['중구']);
  });

  it('시·군이 없는 도 단위 공고는 빈 배열', () => {
    expect(extractSigunguCodes('[경기] 2026년 스마트제조 AXㆍDX 우수사례 공모전', '경영,경기', ['경기'])).toEqual([]);
  });

  it('제목 경계 오탐을 막는다', () => {
    expect(extractSigunguCodes('[경기] 광주시니어클럽 채용 공고', '', ['경기'])).toEqual([]);
  });

  it('시도가 다른 동명 시·군은 붙이지 않는다', () => {
    expect(extractSigunguCodes('[강원] 고성군 2026년 지원사업', '', ['강원'])).toEqual(['고성군']);
    expect(extractSigunguCodes('[경기] 고성군 2026년 지원사업', '', ['경기'])).toEqual([]);
  });
});

describe('scoreGrant — 자격 없는 공고는 제외한다', () => {
  it('다른 시도 전용은 제외', () => {
    const g = grant({ regionCodes: ['부산'] });
    expect(scoreGrant(g, session(), []).score).toBe(0);
  });

  it('같은 도라도 다른 시·군 전용이면 제외', () => {
    const g = grant({ regionCodes: ['경기'], sigunguCodes: ['화성시'] });
    const r = scoreGrant(g, session(), []);
    expect(r.score).toBe(0);
    expect(r.reasons[0]).toContain('화성시');
  });

  it('우리 시·군이면 가점', () => {
    const g = grant({ regionCodes: ['경기'], sigunguCodes: ['성남시'] });
    const r = scoreGrant(g, session(), []);
    expect(r.score).toBeGreaterThan(0);
    expect(r.reasons).toContain('성남시 사업');
  });

  it('비수도권 사업은 수도권 고객사에게 제외', () => {
    const g = grant({ regionCodes: ['비수도권'] });
    expect(scoreGrant(g, session({ region: '경기' }), []).score).toBe(0);
    expect(scoreGrant(g, session({ region: '서울', sigungu: ['강남구'] }), []).score).toBe(0);
    // 비수도권 고객사에게는 보인다
    const r = scoreGrant(g, session({ region: '충북', sigungu: ['청주시'] }), []);
    expect(r.score).toBeGreaterThan(0);
    expect(r.reasons).toContain('비수도권 사업');
  });

  it('우리 시·군을 모르면 시·군 축을 적용하지 않는다 (주소 부실 고객사 보호)', () => {
    const g = grant({ regionCodes: ['경기'], sigunguCodes: ['화성시'] });
    expect(scoreGrant(g, session({ sigungu: [] }), []).score).toBeGreaterThan(0);
  });

  it('업태를 지원분야에 매핑한 가점은 없다', () => {
    // 부동산 임대업 고객사에게 '경영' 분야 공고가 +25를 받아 추천 1위에 올라왔던 회귀
    const g = grant({ regionCodes: ['경기'], category: '경영' });
    const r = scoreGrant(g, session(), []);
    expect(r.reasons.some(x => x.includes('분야'))).toBe(false);
  });
});

describe('industryWarnings — 업종 적합성은 제외가 아니라 주의로', () => {
  it('제조업 전용 공고 + 부동산업 고객사 → 주의 표시', () => {
    const g = grant({ regionCodes: ['경기'], targetFlags: ['중소기업', '제조업'] });
    expect(industryWarnings(g, '부동산업')).toEqual(['제조업 대상 사업']);
    const r = scoreGrant(g, session(), []);
    expect(r.warnings).toEqual(['제조업 대상 사업']);
    expect(r.score).toBeGreaterThan(0);   // 제외하지는 않는다
  });

  it('제조업 고객사에게는 주의를 붙이지 않는다', () => {
    const g = grant({ targetFlags: ['제조업'] });
    expect(industryWarnings(g, '제조업')).toEqual([]);
  });

  it('업태를 모르면 판단하지 않는다', () => {
    const g = grant({ targetFlags: ['제조업'] });
    expect(industryWarnings(g, '')).toEqual([]);
    expect(industryWarnings(g, undefined)).toEqual([]);
  });
});

describe('matchesRegion / matchesInterests', () => {
  it('비수도권 공고는 수도권 지역 필터에서 빠진다', () => {
    const g = grant({ regionCodes: ['비수도권'] });
    expect(matchesRegion(g, '경기')).toBe(false);
    expect(matchesRegion(g, '충북')).toBe(true);
    expect(matchesRegion(g, '전체')).toBe(true);
  });

  it('키워드 묶음 기준', () => {
    const g = grant({ tags: ['💵 저금리 대출'] });
    expect(matchesInterests(g, ['💵 저금리 대출'])).toBe(true);
    expect(matchesInterests(g, ['🚢 수출/해외진출'])).toBe(false);
    expect(matchesInterests(g, [])).toBe(false);
  });
});

describe('getGrantRegions', () => {
  it('DB 값이 있으면 그 값을 쓰고, 없으면 계산한다', () => {
    expect(getGrantRegions(grant({ regionCodes: ['경기'] }))).toEqual(['경기']);
    expect(getGrantRegions(grant({ department: '경기도', title: '[경기] 지원사업' }))).toEqual(['경기']);
  });
});
