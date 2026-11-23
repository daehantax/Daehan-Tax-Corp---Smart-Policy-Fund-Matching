// =============================================================================
// 주차 경계 — 주간 신규 공고 리포트가 「한 주」를 어디서 끊는가
//
// 전부 **KST 기준**이다. GitHub Actions 는 UTC 로 도는데 그대로 끊으면
// 한국 시간 월요일 새벽 6시 실행이 UTC 로는 **일요일 21시**라 한 주가 통째로 어긋난다.
// 이 파일이 순수 함수인 이유도 그래서다 — 경계는 눈으로 못 보고 테스트로만 확인된다.
// =============================================================================

const KST = 9 * 3600_000;
const DAY = 86_400_000;

/** 주어진 시각이 속한 **KST 주의 월요일 00:00** 을 UTC 인스턴트로 */
export function kstMondayOf(at: Date): Date {
  const kst = new Date(at.getTime() + KST);
  const dow = (kst.getUTCDay() + 6) % 7; // 월=0 … 일=6
  const kstMidnight = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate());
  return new Date(kstMidnight - dow * DAY - KST);
}

/** UTC 인스턴트 → 그 시각의 **KST 달력 날짜** 'YYYY-MM-DD' */
export function kstDate(at: Date): string {
  return new Date(at.getTime() + KST).toISOString().slice(0, 10);
}

export interface WeekRange {
  /** 주차 이름이자 DB 의 week_start — 그 주 월요일(KST) */
  label: string;
  /** 포함 */
  start: Date;
  /** 미포함 — 다음 주 월요일 00:00 KST */
  end: Date;
  /** 화면에 적는 마지막 날(일요일) */
  lastDay: string;
}

/**
 * 돌릴 주차를 정한다.
 *
 * `week` 가 없으면 **막 끝난 한 주**(지난 월~일)다. 월요일 아침에 「지난 한 주에 올라온 것」을
 * 보는 화면이라 그렇다. 이번 주를 잡으면 월요일 새벽에는 아직 아무것도 안 들어와 있다.
 *
 * `week` 는 그 주의 아무 날이나 줘도 **그 주 월요일로 맞춘다** — 손으로 다시 돌릴 때
 * 월요일 날짜를 외우고 있지 않아도 되게.
 */
export function weekRangeFor(now: Date, week?: string): WeekRange {
  const start = week
    ? kstMondayOf(new Date(`${week}T00:00:00+09:00`))
    : new Date(kstMondayOf(now).getTime() - 7 * DAY);
  const end = new Date(start.getTime() + 7 * DAY);
  return {
    label: kstDate(start),
    start,
    end,
    lastDay: kstDate(new Date(end.getTime() - DAY)),
  };
}
