// 고객사 수치 프로필 판정 (WORK_PLAN A-6)
//
// 케이스는 **실제로 틀릴 수 있는 지점**에서 가져왔다 — 건수는 2026-10-27 실측이다
// (scripts/research/audit-client-data.mjs). 실패하면 그 함정에 다시 빠진 것이다.
//
// 판정 규칙의 출처는 dh-platform `src/lib/filings.ts` 의 `incomeCoverageMap()` 이다.
// 두 곳이 어긋나면 dh-platform 쪽이 맞다.
import { describe, expect, it } from 'vitest';
import {
  businessYears,
  pickHeadcount,
  pickRevenue,
  revenueBracket,
  revenueFromFilings,
  type FilingRow,
} from '../supabase/functions/_shared/companyProfile';

const 억 = 100_000_000;

/** 부가세 신고 한 줄 */
const vat = (id: string, year: number, period: string, chosen: boolean | null = true): FilingRow =>
  ({ id, tax_type: '부가세', tax_year: year, period_code: period, period_chosen: chosen });
/** 원천세 신고 한 줄 */
const wh = (id: string, year: number, month: string): FilingRow =>
  ({ id, tax_type: '원천세', tax_year: year, period_code: month, period_chosen: true });

const money = (pairs: [string, number][]) => new Map<string, number | null>(pairs);
const none = new Map<string, number | null>();

describe('revenueBracket — 매출 구간', () => {
  it('경계는 아래쪽 구간에 포함되지 않는다 (1억은 1~3억이다)', () => {
    expect(revenueBracket(1 * 억 - 1)?.label).toBe('1억 미만');
    expect(revenueBracket(1 * 억)?.label).toBe('1~3억');
  });

  it('0원도 구간을 낸다 — 실측 115곳이 0원이다 (모르는 것이 아니다)', () => {
    expect(revenueBracket(0)?.label).toBe('1억 미만');
  });

  it('최상단은 상한이 없다', () => {
    const b = revenueBracket(240 * 억);   // 실측 최대 240.5억
    expect(b?.label).toBe('120억 이상');
    expect(b?.max).toBeNull();
  });

  it('모르는 값에는 구간을 붙이지 않는다', () => {
    expect(revenueBracket(null)).toBeUndefined();
    expect(revenueBracket(undefined)).toBeUndefined();
    expect(revenueBracket(Number.NaN)).toBeUndefined();
    expect(revenueBracket(-1)).toBeUndefined();
  });
});

describe('revenueFromFilings — 「온전함」 판정', () => {
  const 일반 = { tax_type: '일반' };

  it('일반과세는 1기·2기가 다 있어야 온전하다', () => {
    const rows = [vat('a', 2025, '1기확정'), vat('b', 2025, '2기확정')];
    const r = revenueFromFilings(2025, 일반, rows, money([['a', 3 * 억], ['b', 2 * 억]]), none);
    expect(r.coverage).toBe('full');
    expect(r.amount).toBe(5 * 억);
  });

  it('한 반기만 있으면 반쪽이다 — 이 금액으로 「10억 미만」을 통과시키면 틀린 안내가 나간다', () => {
    const rows = [vat('a', 2025, '1기확정')];
    const r = revenueFromFilings(2025, 일반, rows, money([['a', 3 * 억]]), none);
    expect(r.coverage).toBe('partial');
  });

  it('예정·확정 중 아무거나 있으면 그 반기는 있는 것이다', () => {
    const rows = [vat('a', 2025, '1기예정'), vat('b', 2025, '2기예정')];
    const r = revenueFromFilings(2025, 일반, rows, money([['a', 1 * 억], ['b', 1 * 억]]), none);
    expect(r.coverage).toBe('full');
  });

  // 10-26 측정이 틀렸던 바로 그 지점 — 간이 83곳이 통째로 「반쪽」에 들어가 있었다
  it('간이과세는 연 1건이 정상이다 (부가가치세법 제5조 제1항 제1호)', () => {
    const rows = [vat('a', 2025, '1기확정')];
    for (const t of ['간이', '간이(계산서)']) {
      const r = revenueFromFilings(2025, { tax_type: t }, rows, money([['a', 5000_0000]]), none);
      expect(r.coverage, t).toBe('full');
    }
  });

  it('면세는 부가세 신고가 하나도 없을 때만 한 건으로 온전하다 (겸영 때문)', () => {
    const 면세줄: FilingRow = { id: 'e', tax_type: '면세', tax_year: 2025, period_code: null, period_chosen: true };
    const onlyExempt = revenueFromFilings(2025, { tax_type: '면세' }, [면세줄], none, money([['e', 2 * 억]]));
    expect(onlyExempt.coverage).toBe('full');

    // 겸영 — 부가세 1기만 있고 2기가 비었다면 면세분이 있어도 반쪽이다
    const 겸영 = revenueFromFilings(2025, 일반, [면세줄, vat('a', 2025, '1기확정')],
      money([['a', 1 * 억]]), money([['e', 2 * 억]]));
    expect(겸영.coverage).toBe('partial');
    expect(겸영.amount).toBe(3 * 억);   // 과세표준 + 면세수입금액을 합친다
  });

  it('그 해 하반기에 개업했으면 1기가 비어 있는 게 정상이다', () => {
    const 하반기개업 = { tax_type: '일반', open_date: '2025-08-01' };
    const r = revenueFromFilings(2025, 하반기개업, [vat('b', 2025, '2기확정')], money([['b', 1 * 억]]), none);
    expect(r.coverage).toBe('full');
  });

  it('그 해 상반기에 폐업했으면 2기가 비어 있는 게 정상이다', () => {
    const 상반기폐업 = { tax_type: '일반', close_date: '2025-04-30' };
    const r = revenueFromFilings(2025, 상반기폐업, [vat('a', 2025, '1기확정')], money([['a', 1 * 억]]), none);
    expect(r.coverage).toBe('full');
  });

  it('귀속을 아직 안 고른 줄(period_chosen=false)은 빼고 센다', () => {
    const rows = [vat('a', 2025, '1기확정'), vat('b', 2025, '2기확정', false)];
    const r = revenueFromFilings(2025, 일반, rows, money([['a', 3 * 억], ['b', 9 * 억]]), none);
    expect(r.coverage).toBe('partial');
    expect(r.amount).toBe(3 * 억);   // 9억은 더하지 않는다
  });

  it('다른 해 신고는 섞이지 않는다', () => {
    const rows = [vat('a', 2024, '1기확정'), vat('b', 2024, '2기확정')];
    expect(revenueFromFilings(2025, 일반, rows, money([['a', 1 * 억], ['b', 1 * 억]]), none).coverage).toBe('none');
  });

  it('금액 칸이 비어 있으면 그 줄은 없는 것으로 본다', () => {
    const rows = [vat('a', 2025, '1기확정'), vat('b', 2025, '2기확정')];
    const r = revenueFromFilings(2025, 일반, rows, money([['a', 3 * 억], ['b', null]]), none);
    expect(r.coverage).toBe('partial');
  });
});

describe('pickRevenue — 어느 해를 쓸 것인가', () => {
  const 일반 = { tax_type: '일반' };

  it('온전한 해를 반쪽인 해보다 먼저 쓴다 — 최근이라는 이유로 반쪽을 쓰지 않는다', () => {
    const rows = [
      vat('p', 2025, '1기확정'),                                  // 2025 는 반쪽
      vat('a', 2024, '1기확정'), vat('b', 2024, '2기확정'),        // 2024 는 온전
    ];
    const r = pickRevenue([2025, 2024], 일반, rows,
      money([['p', 50 * 억], ['a', 1 * 억], ['b', 1 * 억]]), none);
    expect(r.year).toBe(2024);
    expect(r.coverage).toBe('full');
    expect(r.bracket?.label).toBe('1~3억');
  });

  it('어느 해도 온전하지 않으면 가장 최근의 반쪽을 partial 로 알린다 (거르지 않는다)', () => {
    const rows = [vat('p', 2025, '1기확정')];
    const r = pickRevenue([2025, 2024], 일반, rows, money([['p', 3 * 억]]), none);
    expect(r.coverage).toBe('partial');
    expect(r.year).toBe(2025);
    expect(r.bracket?.label).toBe('3~5억');   // 구간은 주되 반쪽임을 함께 알린다
  });

  it('수기 보충분이 있으면 그 해는 그것으로 온전하다 (실측 40곳)', () => {
    const r = pickRevenue([2025], 일반, [], none, none,
      [{ tax_year: 2025, revenue_amount: 7 * 억, source: '부가세과표증명' }]);
    expect(r).toMatchObject({ year: 2025, coverage: 'full', basis: '수기' });
    expect(r.bracket?.label).toBe('5~10억');
  });

  it('수기 보충분의 금액 칸이 비어 있으면 없는 것으로 본다', () => {
    const r = pickRevenue([2025], 일반, [], none, none,
      [{ tax_year: 2025, revenue_amount: null, source: '수익사업없음' }]);
    expect(r.coverage).toBe('none');
  });

  it('아무것도 없으면 none — 구간을 지어내지 않는다', () => {
    const r = pickRevenue([2025, 2024], 일반, [], none, none);
    expect(r).toEqual({ coverage: 'none' });
    expect(r.bracket).toBeUndefined();
  });
});

describe('businessYears — 업력', () => {
  const 기준 = new Date('2026-10-27');

  it('생일이 지나지 않았으면 한 살 덜 센다', () => {
    expect(businessYears('2020-10-27', 기준)).toBe(6);
    expect(businessYears('2020-10-28', 기준)).toBe(5);
  });

  it('개업일을 모르면 undefined — 「0년」이 아니다 (실측 160곳이 개업일이 없다)', () => {
    expect(businessYears(null, 기준)).toBeUndefined();
    expect(businessYears('', 기준)).toBeUndefined();
    expect(businessYears('말도 안 되는 값', 기준)).toBeUndefined();
  });

  it('미래 날짜는 undefined — 잘못 들어간 값으로 「업력 0년」을 만들지 않는다', () => {
    expect(businessYears('2027-01-01', 기준)).toBeUndefined();
  });

  it('올해 개업은 0년이다', () => {
    expect(businessYears('2026-01-02', 기준)).toBe(0);
  });
});

describe('pickHeadcount — 근로 인원', () => {
  // 가장 큰 함정이다. 원천세 행이 없는 382곳 중 236곳은 신고대리라서
  // 우리가 원천세를 맡지 않았을 뿐이다. 「모른다」와 「0명」은 다르다.
  it('원천세 신고 행이 없으면 모른다 — 0 명으로 답하지 않는다', () => {
    expect(pickHeadcount([], none)).toEqual({});
    expect(pickHeadcount([], none).count).toBeUndefined();
  });

  it('행은 있는데 인원 칸이 비어 있어도 모른다 (실측 409곳)', () => {
    expect(pickHeadcount([wh('a', 2026, '09')], money([['a', null]])).count).toBeUndefined();
  });

  it('가장 최근 달의 값을 쓴다 — 연평균은 반기만 사람을 쓰는 업체에서 왜곡된다', () => {
    const rows = [wh('a', 2026, '03'), wh('b', 2026, '09'), wh('c', 2026, '07')];
    const r = pickHeadcount(rows, money([['a', 10], ['b', 2], ['c', 8]]));
    expect(r).toMatchObject({ count: 2, year: 2026, month: 9, months: 3 });
  });

  it('달은 문자열 \'09\' 로 오므로 숫자로 비교한다 (\'10\' < \'09\' 가 되면 안 된다)', () => {
    const rows = [wh('a', 2026, '09'), wh('b', 2026, '10')];
    expect(pickHeadcount(rows, money([['a', 5], ['b', 3]])).month).toBe(10);
  });

  it('\'연말정산\' 은 달이 아니다', () => {
    const rows = [wh('a', 2026, '05'), wh('b', 2026, '연말정산')];
    const r = pickHeadcount(rows, money([['a', 4], ['b', 99]]));
    expect(r).toMatchObject({ count: 4, month: 5, months: 1 });
  });

  it('해가 다르면 최근 해가 이긴다', () => {
    const rows = [wh('a', 2025, '12'), wh('b', 2026, '01')];
    expect(pickHeadcount(rows, money([['a', 9], ['b', 1]]))).toMatchObject({ count: 1, year: 2026 });
  });

  it('0 명은 유효한 값이다 — undefined 로 떨어뜨리지 않는다', () => {
    const r = pickHeadcount([wh('a', 2026, '09')], money([['a', 0]]));
    expect(r.count).toBe(0);
  });

  it('부가세 줄은 인원으로 세지 않는다', () => {
    expect(pickHeadcount([vat('a', 2026, '1기확정')], money([['a', 7]]))).toEqual({});
  });
});
