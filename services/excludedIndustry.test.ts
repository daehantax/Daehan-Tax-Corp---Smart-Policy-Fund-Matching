// 공고의 제외 업종 ↔ 우리 거래처 업종 맞추기 (WORK_PLAN C-12)
//
// 2026-10-29 실측 — 영업 중인 거래처 1,483곳 중 **377곳(25.4%)** 이 어딘가의 제외 목록에
// 오르는 업종이다(부동산임대 318 · 부동산중개 45). 넷 중 하나가 자격 없는 공고를 받고 있었다.
//
// ⚠ 그래도 **제외(score 0)는 하지 않는다.** 제외는 지역·시·군에서만 한다(CLAUDE.md).
//   공고가 「단, ○○는 신청 가능」 예외를 두는 일이 흔하고, 우리가 잘못 읽었을 수도 있다.
import { describe, expect, it } from 'vitest';
import { excludedIndustryWarnings, scoreGrant } from './matchingService';
import type { Grant, UserSession } from '../types';

const grant = (over: Partial<Grant> = {}): Grant => ({
  id: 'G1', title: '테스트 공고', department: '', agency: '', category: '기타',
  startDate: '', endDate: '', registrationDate: '', detailUrl: '#', ...over,
});

const 임대업 = (over: Partial<UserSession> = {}): UserSession =>
  ({ type: 'CLIENT', identifier: '1', industryTags: ['부동산임대'], ...over });

describe('excludedIndustryWarnings', () => {
  it('공고의 제외 업종에 우리 업종이 들어가면 경고한다', () => {
    const g = grant({ excludedIndustries: { tags: ['부동산임대', '유흥주점'] } });
    const got = excludedIndustryWarnings(g, 임대업());
    expect(got).toHaveLength(1);
    expect(got[0]).toContain('부동산 임대업');
    expect(got[0]).toContain('제외 업종');
  });

  it('겹치지 않으면 아무 말도 하지 않는다', () => {
    const g = grant({ excludedIndustries: { tags: ['유흥주점', '사행도박'] } });
    expect(excludedIndustryWarnings(g, 임대업())).toEqual([]);
  });

  it('여러 개 겹치면 각각 말한다', () => {
    const g = grant({ excludedIndustries: { tags: ['부동산임대', '부동산중개'] } });
    const got = excludedIndustryWarnings(g, 임대업({ industryTags: ['부동산임대', '부동산중개'] }));
    expect(got).toHaveLength(2);
  });

  it('⚠ 업종코드를 모르는 거래처에는 아무 말도 하지 않는다 — 모르는 것과 해당 없는 것은 다르다', () => {
    const g = grant({ excludedIndustries: { tags: ['부동산임대'] } });
    expect(excludedIndustryWarnings(g, { type: 'CLIENT', identifier: '1' })).toEqual([]);
    expect(excludedIndustryWarnings(g, 임대업({ industryTags: [] }))).toEqual([]);
  });

  it('⚠ 공고의 제외 업종을 못 읽었으면 아무 말도 하지 않는다 — 「없다」가 아니라 「모른다」다', () => {
    expect(excludedIndustryWarnings(grant(), 임대업())).toEqual([]);
    expect(excludedIndustryWarnings(grant({ excludedIndustries: { tags: [] } }), 임대업())).toEqual([]);
  });
});

describe('scoreGrant — 제외 업종은 감점이지 제외가 아니다', () => {
  const g = grant({ excludedIndustries: { tags: ['부동산임대'] } });

  it('⭐ 맞아떨어져도 score 0 이 되지 않는다 — 공고가 예외를 둘 수 있다', () => {
    const { score } = scoreGrant(g, 임대업(), []);
    expect(score).toBeGreaterThan(0);
  });

  it('경고가 카드로 나간다', () => {
    const { warnings } = scoreGrant(g, 임대업(), []);
    expect(warnings.some((w) => w.includes('제외 업종'))).toBe(true);
  });

  it('겹치지 않는 거래처보다 아래로 내려간다', () => {
    const 제조업 = { type: 'CLIENT', identifier: '2', industryTags: [] } as UserSession;
    expect(scoreGrant(g, 임대업(), []).score)
      .toBeLessThan(scoreGrant(g, 제조업, []).score);
  });

  it('수치 조건 불일치보다 더 많이 깎는다 — 근거가 더 분명하다', () => {
    // ⚠ 점수 바닥이 1 이라, 기본 점수가 낮으면 두 감점이 똑같이 1 로 눌려 비교가 안 된다.
    //   그래서 지역·관심·조회수·마감이 다 맞는 공고(65점)로 잰다.
    const soon = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    const 넉넉한 = (over: Partial<Grant> = {}) =>
      grant({ views: 2000, endDate: soon, tags: ['제조'], regionCodes: ['서울'], ...over });
    const 서울 = (over: Partial<UserSession>): UserSession =>
      ({ type: 'CLIENT', identifier: '1', region: '서울', regionHint: '서울특별시 강남구', ...over });

    const 임대 = 서울({ industryTags: ['부동산임대'] });
    const 매출큰곳 = 서울({
      revenueBracket: '10~30억', revenueMin: 1_000_000_000, revenueMax: 3_000_000_000,
      revenueCoverage: 'full',
    });
    const 기준선어긋남 = 넉넉한({
      targetFlags: ['조건:매출액'],
      conditions: { revenue: { min: null, max: 100_000_000 } },
    });

    const 제외감점 = scoreGrant(넉넉한(), 임대, ['제조']).score
      - scoreGrant(넉넉한({ excludedIndustries: { tags: ['부동산임대'] } }), 임대, ['제조']).score;
    const 기준선감점 = scoreGrant(넉넉한(), 매출큰곳, ['제조']).score
      - scoreGrant(기준선어긋남, 매출큰곳, ['제조']).score;
    expect(제외감점).toBe(45);
    expect(기준선감점).toBe(30);
  });
});
