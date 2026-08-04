import { describe, expect, it } from 'vitest';
import { computeSmartTags } from './csvService';

// 스마트태그는 사장님이 고르는 관심 키워드 6종이다. 넓은 단어로 텍스트를 훑던 시절
// 🧪 기술개발이 전체 46%에 붙어 필터로서 의미가 없었고, "기술자료 임치 수수료"가
// 💵 저금리 대출로 잡혀 부동산 임대업 고객사의 추천 1위에 올라왔다.
// 아래 케이스는 그 회귀를 막는다.

describe('computeSmartTags — 중분류 우선', () => {
  it('중분류 융자·보증이면 저금리 대출', () => {
    expect(computeSmartTags({ title: '[경기] 성남시 중소기업 특례보증 지원계획 공고', subCategory: '보증' }))
      .toContain('💵 저금리 대출');
    expect(computeSmartTags({ title: '[충북] 중소기업육성자금 융자(이차보전) 지원계획', subCategory: '융자' }))
      .toContain('💵 저금리 대출');
  });

  it('중분류 해외진출이면 수출/해외진출', () => {
    expect(computeSmartTags({ title: '[충남] 중국수출입상품교역회 참가기업 모집', subCategory: '해외진출' }))
      .toContain('🚢 수출/해외진출');
  });

  it('중분류 고용유지·국내일반인력이면 인건비/고용', () => {
    expect(computeSmartTags({ title: '2026년 청년 일경험 시범사업', subCategory: '국내일반인력' }))
      .toContain('💰 인건비/고용');
  });
});

describe('computeSmartTags — 넓은 단어로 인한 오탐을 막는다', () => {
  it("'기술' 한 단어로 기술개발 태그를 붙이지 않는다", () => {
    // '기술'은 575건에 등장했고 244건은 이 단어 하나 때문에만 붙었다
    expect(computeSmartTags({ title: '2026년 기술지원 안내', subCategory: '컨설팅' }))
      .not.toContain('🧪 기술개발(R&D)');
  });

  it("'금융'·'보증' 언급만으로 저금리 대출을 붙이지 않는다", () => {
    // 실제 회귀: 기술자료 임치 수수료 지원 (중분류 기술사업화/이전/지도)
    const tags = computeSmartTags({
      title: '[경기] 성남시 2026년 기술자료 임치 수수료 지원사업 신청 공고',
      subCategory: '기술사업화/이전/지도',
      summary: '금융기관 보증 관련 안내를 포함합니다',
    });
    expect(tags).not.toContain('💵 저금리 대출');
    expect(tags).toContain('🧪 기술개발(R&D)');
  });

  it("'육성자금' 부수 언급으로 저금리 대출을 붙이지 않는다", () => {
    // 인증 혜택 안내로 "중소기업육성자금 우대"라 적은 공고까지 끌어왔다
    expect(computeSmartTags({
      title: '[세종] 2026년 여성친화인증 기업 모집 공고',
      subCategory: '디자인/상품화/사업화',
      summary: '인증 기업은 중소기업육성자금 우대 혜택을 받습니다',
    })).not.toContain('💵 저금리 대출');
  });

  it("'구축'으로 시설/기계구입을 붙이지 않는다", () => {
    expect(computeSmartTags({ title: '2026년 AI 플랫폼 기반구축 사업', subCategory: '컨설팅' }))
      .not.toContain('🏭 시설/기계구입');
  });

  it('"일자리 창출 효과" 같은 부수 문구로 인건비/고용을 붙이지 않는다', () => {
    expect(computeSmartTags({
      title: '[충북] 중소기업육성자금 융자 지원계획',
      subCategory: '융자',
      summary: '일자리 창출 효과가 기대됩니다',
    })).not.toContain('💰 인건비/고용');
  });

  it('공모전·표창처럼 해당 없는 공고는 태그가 붙지 않아도 된다', () => {
    expect(computeSmartTags({
      title: '[경기] 2026년 스마트제조 AXㆍDX 우수사례 공모전 참여기업 모집 공고',
      subCategory: '디자인/상품화/사업화',
    })).not.toContain('💵 저금리 대출');
  });
});

describe('computeSmartTags — 좁은 키워드는 살아 있다', () => {
  it.each([
    ['이차보전 지원사업', '💵 저금리 대출'],
    ['운전자금 지원사업', '💵 저금리 대출'],
    ['스마트공장 구축 지원', '🏭 시설/기계구입'],
    ['수출바우처 참여기업 모집', '🚢 수출/해외진출'],
    ['무역사절단 파견 참가기업', '🚢 수출/해외진출'],
    ['해외전시회 개별참가 지원', '🚢 수출/해외진출'],
    ['특허 출원 비용 지원', '🧪 기술개발(R&D)'],
    ['시제품 제작 지원', '🧪 기술개발(R&D)'],
    ['판로개척 지원사업', '📢 마케팅/홍보'],
    ['청년일자리도약장려금 참여기업 모집', '💰 인건비/고용'],
  ])('%s → %s', (title, tag) => {
    expect(computeSmartTags({ title })).toContain(tag);
  });
});
