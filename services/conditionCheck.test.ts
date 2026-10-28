// 공고 기준선 ↔ 우리 값 맞추기 (WORK_PLAN C-9 + A-6)
//
// 이 판정의 기본 자세는 **「애매하면 말하지 않는다」** 다.
// 우리 쪽 매출은 구간이고(원본 금액은 브라우저로 안 내려온다) 업력은 만 년수라,
// 경계에 걸치면 실제값을 모른다. 그때 「자격 없다」는 신호를 주면 안 된다.
import { describe, expect, it } from 'vitest';
import { conditionCheck, scoreGrant, selfCheckResult, unverifiableConditions } from './matchingService';
import type { Grant, UserSession } from '../types';

const 억 = 100_000_000;

const grant = (over: Partial<Grant> = {}): Grant => ({
  id: 'G1', title: '테스트 공고', department: '', agency: '', category: '기타',
  startDate: '', endDate: '', registrationDate: '', detailUrl: '#', ...over,
});

/** 매출 구간이 잡힌 세션 */
const withRevenue = (bracket: string, min: number, max: number | undefined,
  coverage: UserSession['revenueCoverage'] = 'full'): UserSession =>
  ({ type: 'CLIENT', identifier: '1', revenueBracket: bracket, revenueMin: min, revenueMax: max, revenueCoverage: coverage });

describe('매출 — 구간 전체가 기준 밖일 때만 말한다', () => {
  const g = grant({ targetFlags: ['조건:매출액'], conditions: { revenue: { min: null, max: 3 * 억 } } });

  it('구간이 통째로 기준을 넘으면 주의 표시', () => {
    const r = conditionCheck(g, withRevenue('5~10억', 5 * 억, 10 * 억));
    expect(r.warnings).toEqual(['매출 기준 초과 (우리 기록 5~10억 · 공고 3억 이하)']);
    expect(r.judged.has('revenue')).toBe(true);
  });

  it('구간이 기준에 걸치면 판정은 하되 주의는 띄우지 않는다', () => {
    // 구간 '1~3억' 은 3억 미만이므로 '3억 이하' 를 통과한다
    expect(conditionCheck(g, withRevenue('1~3억', 1 * 억, 3 * 억)).warnings).toEqual([]);
    // 구간 '3~5억' 은 실제값이 3억일 수도 있다 — 단정하지 않는다
    expect(conditionCheck(g, withRevenue('3~5억', 3 * 억, 5 * 억)).warnings).toEqual([]);
  });

  it('하한 조건은 구간 전체가 미달일 때만', () => {
    const low = grant({ targetFlags: ['조건:매출액'], conditions: { revenue: { min: 5 * 억, max: null } } });
    expect(conditionCheck(low, withRevenue('1억 미만', 0, 1 * 억)).warnings)
      .toEqual(['매출 기준 미달 (우리 기록 1억 미만 · 공고 5억 이상)']);
    expect(conditionCheck(low, withRevenue('5~10억', 5 * 억, 10 * 억)).warnings).toEqual([]);
  });

  // 가장 중요한 케이스 — 반쪽 금액으로 판정하면 틀린 안내가 나간다
  it('반쪽 매출로는 판정하지 않는다', () => {
    const r = conditionCheck(g, withRevenue('1~3억', 1 * 억, 3 * 억, 'partial'));
    expect(r.judged.has('revenue')).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it('매출을 모르면 판정하지 않는다', () => {
    const r = conditionCheck(g, { type: 'CLIENT', identifier: '1', revenueCoverage: 'none' });
    expect(r.judged.has('revenue')).toBe(false);
  });
});

describe('업력 — 실제값은 [n, n+1) 구간이다', () => {
  const upTo7 = grant({ targetFlags: ['업력제한'], conditions: { years: { min: null, max: 7 } } });
  const from3 = grant({ targetFlags: ['업력제한'], conditions: { years: { min: 3, max: null } } });
  const sess = (businessYears: number): UserSession => ({ type: 'CLIENT', identifier: '1', businessYears });

  it('넘으면 주의 표시', () => {
    expect(conditionCheck(upTo7, sess(8)).warnings).toEqual(['업력 초과 (우리 기록 8년 · 공고 7년 이하)']);
  });

  it('딱 걸치면 말하지 않는다 — 7년차의 실제 업력은 7.0~7.9년이다', () => {
    expect(conditionCheck(upTo7, sess(7)).warnings).toEqual([]);
  });

  it('미달도 확실할 때만', () => {
    expect(conditionCheck(from3, sess(1)).warnings).toEqual(['업력 미달 (우리 기록 1년 · 공고 3년 이상)']);
    // 2년차는 실제 2.0~2.9년이라 3년에 못 미친다 — 단정할 수 있다
    expect(conditionCheck(from3, sess(2)).warnings).toHaveLength(1);
    expect(conditionCheck(from3, sess(3)).warnings).toEqual([]);
  });

  it('개월 단위 기준에 「0년」이 걸리지 않는다', () => {
    // 업력 0년(=개업 8개월)인 곳이 '6개월 이상' 조건에 미달이라고 나오면 안 된다
    const half = grant({ targetFlags: ['업력제한'], conditions: { years: { min: 0.5, max: null } } });
    expect(conditionCheck(half, sess(0)).warnings).toEqual([]);
  });

  it('개업일을 모르면 판정하지 않는다', () => {
    expect(conditionCheck(upTo7, { type: 'CLIENT', identifier: '1' }).judged.has('years')).toBe(false);
  });
});

describe('근로자수', () => {
  const g = grant({ targetFlags: ['조건:근로자수'], conditions: { employees: { min: 5, max: 300 } } });
  const sess = (employeeCount: number): UserSession => ({ type: 'CLIENT', identifier: '1', employeeCount });

  it('모자라면 주의 표시', () => {
    expect(conditionCheck(g, sess(2)).warnings).toEqual(['상시근로자 미달 (우리 기록 2명 · 공고 5명~300명)']);
  });

  it('넘으면 주의 표시', () => {
    expect(conditionCheck(g, sess(400)).warnings).toHaveLength(1);
  });

  it('맞으면 조용하다', () => {
    expect(conditionCheck(g, sess(10)).warnings).toEqual([]);
  });

  // 원천세 신고 행이 없는 382곳을 「0명」으로 읽으면 전부 미달로 뜬다
  it('인원을 모르면 판정하지 않는다 — 0명으로 읽지 않는다', () => {
    const r = conditionCheck(g, { type: 'CLIENT', identifier: '1' });
    expect(r.judged.has('employees')).toBe(false);
    expect(r.warnings).toEqual([]);
  });

  it('0명은 유효한 값이라 판정한다', () => {
    expect(conditionCheck(g, sess(0)).warnings).toHaveLength(1);
  });
});

describe('안전장치', () => {
  it('기준선이 없으면 아무것도 하지 않는다', () => {
    const g = grant({ targetFlags: ['조건:매출액'] });
    expect(conditionCheck(g, withRevenue('5~10억', 5 * 억, 10 * 억))).toEqual({ warnings: [], judged: new Set() });
  });

  it('꼬리표가 없는 축은 쓰지 않는다 — 숫자만 잡힌 공고는 오탐(誤探) 위험이 있다', () => {
    const g = grant({ targetFlags: [], conditions: { revenue: { min: null, max: 3 * 억 } } });
    expect(conditionCheck(g, withRevenue('5~10억', 5 * 억, 10 * 억)).warnings).toEqual([]);
  });
});

describe('unverifiableConditions — 판정한 축은 「확인 필요」에서 뺀다', () => {
  const g = grant({
    targetFlags: ['조건:매출액', '업력제한', '조건:근로자수'],
    conditions: { revenue: { min: null, max: 3 * 억 }, years: { min: null, max: 7 } },
  });

  it('세션이 없으면 전부 확인 필요 (기존 동작)', () => {
    expect(unverifiableConditions(g)).toEqual(['상시근로자 수', '업력', '매출액']);
  });

  it('판정한 축만 빠진다', () => {
    const s: UserSession = {
      type: 'CLIENT', identifier: '1',
      revenueBracket: '1~3억', revenueMin: 1 * 억, revenueMax: 3 * 억, revenueCoverage: 'full',
      businessYears: 5,
      // 인원은 모른다 → 「확인 필요」로 남아야 한다 (기준선 자체도 못 읽었다)
    };
    expect(unverifiableConditions(g, s)).toEqual(['상시근로자 수']);
  });

  it('값이 있어도 기준선을 못 읽었으면 확인 필요로 남는다', () => {
    const noCond = grant({ targetFlags: ['조건:매출액'] });
    const s = withRevenue('1~3억', 1 * 억, 3 * 억);
    expect(unverifiableConditions(noCond, s)).toEqual(['매출액']);
  });
});

// ── scoreGrant 까지 — 실제로 화면에 나가는 모양인가 ─────────────────────────
// 값은 2026-10-28 DB 에 실제로 담긴 기준선에서 가져왔다.
describe('scoreGrant — 경고가 카드까지 간다', () => {
  const 카드수수료 = grant({   // [강원] 동해시 소상공인 카드수수료 — conditions {revenue:{max:3억}}
    title: '[강원] 동해시 2026년 소상공인 카드수수료 지원사업 공고',
    targetFlags: ['소상공인', '조건:매출액'],
    conditions: { revenue: { min: null, max: 3 * 억 } },
    endDate: '2026-12-31',
  });

  const base = (over: Partial<UserSession> = {}): UserSession =>
    ({ type: 'CLIENT', identifier: '1234567890', region: '강원', ...over });

  it('기준을 넘으면 주의 문구가 warnings 로 나가고 감점된다', () => {
    const over = base({ revenueBracket: '5~10억', revenueMin: 5 * 억, revenueMax: 10 * 억, revenueCoverage: 'full' });
    const plain = base();
    const r = scoreGrant(카드수수료, over, []);
    expect(r.warnings).toContain('매출 기준 초과 (우리 기록 5~10억 · 공고 3억 이하)');
    expect(r.score).toBeLessThan(scoreGrant(카드수수료, plain, []).score);
    // 그래도 **제외하지 않는다** — 우리 기록이 최신이 아닐 수 있다
    expect(r.score).toBeGreaterThan(0);
  });

  it('판정이 끝나면 「공고문 확인 필요」가 사라진다', () => {
    const ok = base({ revenueBracket: '1~3억', revenueMin: 1 * 억, revenueMax: 3 * 억, revenueCoverage: 'full' });
    const r = scoreGrant(카드수수료, ok, []);
    expect(r.checkPoints).toBeUndefined();
    expect(r.warnings).toBeUndefined();
  });

  it('우리 값을 모르면 전처럼 「확인 필요」로 남는다', () => {
    const r = scoreGrant(카드수수료, base(), []);
    expect(r.checkPoints).toEqual(['매출액']);
  });
});

// ── 고객사 자기 체크 (C-10) ─────────────────────────────────────────────────
// 특허·연구소·공장등록은 세무 자료에 없다. 본인에게 물어서 판정한다.
// **「아니오」와 「대답 안 함」은 다르다** — 대답하지 않았으면 전처럼 「확인 필요」다.
describe('selfCheckResult — 본인이 체크한 항목', () => {
  const 특허공고 = grant({ targetFlags: ['조건:특허'], title: 'IP 담보대출 연계 지식재산평가 지원' });
  const sess = (selfCheck?: Record<string, boolean>): UserSession =>
    ({ type: 'CLIENT', identifier: '1', ...(selfCheck ? { selfCheck } : {}) });

  it('체크했으면 조건 충족으로 보고 「확인 필요」에서 뺀다', () => {
    const r = selfCheckResult(특허공고, sess({ patent: true }));
    expect(r.matched).toEqual(['특허·실용신안·상표권 보유 조건 충족']);
    expect(r.warnings).toEqual([]);
    expect(unverifiableConditions(특허공고, sess({ patent: true }))).toEqual([]);
  });

  it('해당 없다고 하면 주의 표시 — 그래도 제외하지 않는다', () => {
    const r = selfCheckResult(특허공고, sess({ patent: false }));
    expect(r.warnings).toHaveLength(1);
    expect(r.matched).toEqual([]);
    expect(scoreGrant(특허공고, sess({ patent: false }), []).score).toBeGreaterThan(0);
  });

  it('대답하지 않았으면 판정하지 않는다 — 전처럼 「확인 필요」로 남는다', () => {
    expect(selfCheckResult(특허공고, sess()).judged.size).toBe(0);
    expect(selfCheckResult(특허공고, sess({ export: true })).judged.size).toBe(0);
    expect(unverifiableConditions(특허공고, sess({ export: true }))).toEqual(['특허·지식재산권']);
  });

  it('공고에 그 조건이 없으면 체크해도 아무 일도 없다', () => {
    const 일반공고 = grant({ targetFlags: ['소상공인'] });
    const r = selfCheckResult(일반공고, sess({ patent: true, export: true }));
    expect(r).toEqual({ matched: [], warnings: [], judged: new Set() });
  });

  it('충족한 공고는 점수가 올라간다 — 위로 올려 보여주기 위해서다', () => {
    const withCheck = scoreGrant(특허공고, sess({ patent: true }), []).score;
    const without = scoreGrant(특허공고, sess(), []).score;
    expect(withCheck).toBeGreaterThan(without);
  });

  it('한 공고에서 여러 항목이 걸리면 함께 본다', () => {
    const g = grant({ targetFlags: ['조건:특허', '조건:연구소', '수출실적'] });
    const r = selfCheckResult(g, sess({ patent: true, lab: true, export: false }));
    expect(r.matched).toHaveLength(2);
    expect(r.warnings).toHaveLength(1);
    expect(r.judged.size).toBe(3);
  });
});
