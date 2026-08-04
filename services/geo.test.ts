import { describe, expect, it } from 'vitest';
import {
  detectZone,
  EXCLUSIVE_ZONES,
  expandSigunguShort,
  isSigungu,
  pickSidoCodes,
  resolveAddress,
  sigunguBelongsTo,
  sigunguSidoCodes,
} from './geo';

// 이 파일의 케이스는 전부 실제 고객사 주소·공고 원문에서 가져온 것이다.
// 하나하나가 과거에 실제로 틀렸던 지점이므로, 실패하면 그 회귀가 돌아온 것이다.

describe('resolveAddress — 고객사 주소', () => {
  it.each([
    // 우편번호가 앞에 붙은 형태 (거래처 주소 대부분이 이 모양이다)
    ['(13559 ) 경기도 성남시 분당구 성남대로 295 A 121,122호(정자동, 대림아크로텔)', '경기', ['성남시', '분당구']],
    // 접미사 없는 옛 지번주소
    ['경기 성남 분당 야탑 382 3 지상1층', '경기', ['성남시', '분당구']],
    ['(461824) 경기 성남 수정 태평 6513 외', '경기', ['성남시', '수정구']],
    // '화성'은 화성시(현행)와 화성군(폐지)에 모두 걸린다 — 현행을 택해야 한다
    ['(445911) 경기 화성 팔탄 지월 738 2', '경기', ['화성시']],
    // 시도명과 구가 붙어 있는 형태 + 2026년 통합 시도
    ['(61024 ) 전남광주통합특별시북구 양산택지로51번길 2 (양산동)', '광주', ['북구']],
    // 2026년 인천 재편으로 생긴 구
    ['(22791 ) 인천광역시 서해구 가정로 216 301-1호', '인천', ['서해구']],
    // 폐지된 옛 구 표기도 읽어야 한다 (주소가 아직 갱신되지 않은 거래처)
    ['(22789 ) 인천광역시 서구 신석로 74-1 지하1층', '인천', ['서구']],
    ['서울특별시 강남구 테헤란로 1', '서울', ['강남구']],
    ['부산광역시 중구 중앙대로', '부산', ['중구']],
    // 정식 도명 (축약코드가 원문에 없다)
    ['경상북도 구미시 1공단로 100', '경북', ['구미시']],
    ['충청남도 천안시 서북구', '충남', ['천안시', '서북구']],
    ['강원특별자치도 원주시 시청로', '강원', ['원주시']],
    // 세종은 시군구가 없다
    ['세종특별자치시 한누리대로 350', '세종', []],
    // 내용이 없는 주소
    ['(      )', '전체', []],
    ['', '전체', []],
  ])('%s → %s %j', (address, region, sigungu) => {
    const r = resolveAddress(address);
    expect(r.region).toBe(region);
    expect(r.sigungu).toEqual(sigungu);
  });

  it('주소 뒤쪽 도로명에 다른 지역명이 있어도 맨 앞 시도를 택한다', () => {
    expect(resolveAddress('경기도 성남시 분당구 부산로 12').region).toBe('경기');
  });
});

describe('pickSidoCodes', () => {
  it('정식명·축약명·폐지명을 모두 인식한다', () => {
    expect(pickSidoCodes('경기도 성남시')).toEqual(['경기']);
    expect(pickSidoCodes('충청북도 청주시')).toEqual(['충북']);
    expect(pickSidoCodes('전라남도 여수시')).toEqual(['전남']);   // 폐지명 별칭
    expect(pickSidoCodes('강원특별자치도')).toEqual(['강원']);
  });

  it('2026년 통합 시도는 광주·전남 두 코드로 대응한다', () => {
    expect(pickSidoCodes('전남광주통합특별시').sort()).toEqual(['광주', '전남']);
  });
});

describe('detectZone — 권역', () => {
  it('권역을 시도 목록으로 펼친다', () => {
    expect(detectZone('[호남권] 2026년 중소·중견기업 고용지원사업')?.sort()).toEqual(['광주', '전남', '전북']);
    expect(detectZone('2026년 대경권(대구) 지역혁신클러스터육성')?.sort()).toEqual(['경북', '대구']);
    expect(detectZone('[충청권] 내일이음 취업박람회')?.sort()).toEqual(['대전', '세종', '충남', '충북']);
  });

  it('비수도권은 "수도권 제외"라서 이름 그대로 돌려준다', () => {
    expect(detectZone('[비수도권] 2026년 메인비즈 현장방문 맞춤 코칭')).toEqual(['비수도권']);
    expect(EXCLUSIVE_ZONES['비수도권']).toEqual(['서울', '인천', '경기']);
  });

  it('비수도권이 수도권보다 먼저 걸려야 한다 (부분 문자열)', () => {
    expect(detectZone('[비수도권] 지원사업')).toEqual(['비수도권']);
  });

  it('2글자 권역명은 없다 — "친환경인증선박"의 경인에 걸려 오탐이 났었다', () => {
    expect(detectZone('2026년 2차 친환경인증선박 보급지원사업 공고')).toBeNull();
  });
});

describe('시·군·구 사전', () => {
  it('공식 목록에 있는 이름만 인정한다', () => {
    expect(isSigungu('성남시')).toBe(true);
    expect(isSigungu('진천군')).toBe(true);   // 예전 사전에 없어 놓치던 43종 중 하나
    expect(isSigungu('만세구')).toBe(true);   // 잡음으로 오해해 지웠던 실재 행정구역
    expect(isSigungu('서해구')).toBe(true);
    expect(isSigungu('강소특구')).toBe(false);
    expect(isSigungu('공공주택지구')).toBe(false);
    expect(isSigungu('반드시')).toBe(false);
  });

  it('동명 시·군·구는 상위 시도로 구분한다', () => {
    expect(sigunguSidoCodes('중구')).toContain('서울');
    expect(sigunguSidoCodes('중구')).toContain('부산');
    expect(sigunguSidoCodes('성남시')).toEqual(['경기']);
    expect(sigunguBelongsTo('중구', ['부산'])).toBe(true);
    expect(sigunguBelongsTo('성남시', ['부산'])).toBe(false);
    expect(sigunguBelongsTo('고성군', ['강원'])).toBe(true);
    expect(sigunguBelongsTo('고성군', ['경남'])).toBe(true);
    expect(sigunguBelongsTo('고성군', ['경기'])).toBe(false);
  });

  it('접미사 없는 표기를 정식 이름으로 넓힌다', () => {
    expect(expandSigunguShort('강릉', ['강원'])).toBe('강릉시');
    expect(expandSigunguShort('해남', ['전남'])).toBe('해남군');
    // 시도명과 겹치는 표기는 인정하지 않는다 (해시태그의 '제주'·'광주'는 시도를 뜻한다)
    expect(expandSigunguShort('제주', ['제주'])).toBeNull();
    expect(expandSigunguShort('광주', ['광주'])).toBeNull();
  });
});
