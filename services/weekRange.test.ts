import { describe, expect, it } from 'vitest';
import { kstDate, kstMondayOf, weekRangeFor } from './weekRange';

// 주차 경계는 화면에 안 보이고 **한 주 뒤에야 틀린 것을 안다.** 전부 여기서 막는다.
// 가장 위험한 자리: GitHub Actions 가 UTC 로 돈다는 것. 한국 월요일 새벽 6시는
// UTC 로 일요일 21시라, UTC 로 끊으면 한 주가 통째로 밀린다.

describe('kstMondayOf — KST 기준 그 주 월요일', () => {
  it('월요일 새벽(KST)이면 그날이 그 주 월요일이다', () => {
    // 2026-11-09 06:00 KST = 2026-11-08 21:00 UTC (UTC 로는 일요일!)
    expect(kstDate(kstMondayOf(new Date('2026-11-08T21:00:00Z')))).toBe('2026-11-09');
  });

  it('일요일 밤 11시(KST)도 아직 그 주다', () => {
    // 2026-11-08(일) 23:00 KST → 그 주 월요일은 11-02
    expect(kstDate(kstMondayOf(new Date('2026-11-08T14:00:00Z')))).toBe('2026-11-02');
  });

  it('월요일 00:00 KST 정각은 그날이 월요일이다 (경계)', () => {
    expect(kstDate(kstMondayOf(new Date('2026-11-01T15:00:00Z')))).toBe('2026-11-02');
  });

  it('월요일 00:00 KST 1분 전은 아직 지난 주다 (경계)', () => {
    expect(kstDate(kstMondayOf(new Date('2026-11-01T14:59:00Z')))).toBe('2026-10-26');
  });

  it('달이 바뀌는 주도 맞다', () => {
    // 2026-12-02(수) → 그 주 월요일은 11-30
    expect(kstDate(kstMondayOf(new Date('2026-12-02T03:00:00Z')))).toBe('2026-11-30');
  });

  it('해가 바뀌는 주도 맞다', () => {
    // 2027-01-01(금) → 그 주 월요일은 2026-12-28
    expect(kstDate(kstMondayOf(new Date('2027-01-01T03:00:00Z')))).toBe('2026-12-28');
  });
});

describe('weekRangeFor — 기본값은 막 끝난 한 주', () => {
  it('월요일 새벽에 돌리면 지난 월~일을 잡는다', () => {
    // 실제 운영 시각: 월요일 06:10 KST = 일요일 21:10 UTC
    const r = weekRangeFor(new Date('2026-11-08T21:10:00Z'));
    expect(r.label).toBe('2026-11-02');
    expect(r.lastDay).toBe('2026-11-08');
  });

  it('구간은 월요일 00:00 KST 부터 다음 월요일 00:00 KST 전까지다', () => {
    const r = weekRangeFor(new Date('2026-11-08T21:10:00Z'));
    expect(r.start.toISOString()).toBe('2026-11-01T15:00:00.000Z'); // 11-02 00:00 KST
    expect(r.end.toISOString()).toBe('2026-11-08T15:00:00.000Z');   // 11-09 00:00 KST
  });

  it('주 중간에 손으로 다시 돌려도 같은 주를 잡는다', () => {
    // 수요일 오후에 돌려도 「지난 주」는 여전히 11-02 주
    expect(weekRangeFor(new Date('2026-11-11T05:00:00Z')).label).toBe('2026-11-02');
  });
});

describe('weekRangeFor — --week 로 지난 주차 다시 돌리기', () => {
  it('월요일 날짜를 주면 그 주다', () => {
    const r = weekRangeFor(new Date('2026-11-12T00:00:00Z'), '2026-10-26');
    expect(r.label).toBe('2026-10-26');
    expect(r.lastDay).toBe('2026-11-01');
  });

  it('그 주의 아무 날이나 줘도 월요일로 맞춘다 — 월요일을 외우지 않아도 되게', () => {
    expect(weekRangeFor(new Date(), '2026-10-29').label).toBe('2026-10-26'); // 목요일을 줬다
    expect(weekRangeFor(new Date(), '2026-11-01').label).toBe('2026-10-26'); // 일요일을 줬다
  });

  it('넘긴 날짜는 KST 로 읽는다 — UTC 로 읽으면 하루 밀린다', () => {
    // '2026-11-02' 를 UTC 자정으로 읽으면 KST 로는 11-02 09:00 이라 같은 주지만,
    // 일요일을 넘기면 차이가 드러난다. '2026-11-09'(월)을 UTC 로 읽어도 그 주여야 한다
    expect(weekRangeFor(new Date(), '2026-11-09').label).toBe('2026-11-09');
  });
});
