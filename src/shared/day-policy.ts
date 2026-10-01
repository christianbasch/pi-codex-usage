import { MINUTES_PER_DAY } from './format.ts';
import { addUtcDays, startOfUtcDay } from './utc-date.ts';

export type DayPolicy = 'calendar' | 'weekdays';

export interface BudgetDayPolicy {
  readonly id: DayPolicy;
  readonly label: string;
  /** Budget days in [start, end); weekday counts use whole UTC day boundaries. */
  countDays(start: Date, end: Date): number;
  /** Adjust a server-relative countdown; resetAt is a Unix timestamp in seconds. */
  remainingMinutes(resetAt: number, calendarMinutes: number): number;
  isBudgetDay(date: Date): boolean;
}

export function dayPolicyLabel(policy: DayPolicy): string {
  return policy === 'weekdays' ? 'weekdays' : 'calendar days';
}

const MILLISECONDS_PER_DAY = MINUTES_PER_DAY * 60 * 1000;

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

/**
 * Counts whole days in `[start, end)` on UTC day boundaries. Normalizing both
 * bounds prevents sub-day jitter in the API's reset time from adding a day.
 */
function countDaysMatching(
  start: Date,
  end: Date,
  predicate: (date: Date) => boolean
): number {
  const cursor = startOfUtcDay(start);
  const last = startOfUtcDay(end);
  let days = 0;
  for (; cursor < last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (predicate(cursor)) days += 1;
  }
  return days;
}

function countRemainingWeekendDays(resetAt: number, now: Date): number {
  const today = startOfUtcDay(now);
  const tomorrow = addUtcDays(today, 1);
  // Count the remaining fraction of today only when it is a weekend day.
  const partialToday = isWeekday(today)
    ? 0
    : 1 - (now.getTime() - today.getTime()) / MILLISECONDS_PER_DAY;
  return (
    partialToday +
    countDaysMatching(
      tomorrow,
      new Date(resetAt * 1000),
      (date) => !isWeekday(date)
    )
  );
}

const POLICIES: Record<DayPolicy, BudgetDayPolicy> = {
  calendar: {
    id: 'calendar',
    label: dayPolicyLabel('calendar'),
    countDays: (start, end) =>
      (end.getTime() - start.getTime()) / MILLISECONDS_PER_DAY,
    remainingMinutes: (_resetAt, calendarMinutes) => calendarMinutes,
    isBudgetDay: () => true,
  },
  weekdays: {
    id: 'weekdays',
    label: dayPolicyLabel('weekdays'),
    countDays: (start, end) => countDaysMatching(start, end, isWeekday),
    remainingMinutes(resetAt, calendarMinutes) {
      // Classify weekdays on the server-relative countdown timeline, not the
      // potentially offset local wall clock.
      const serverNow = new Date(resetAt * 1000 - calendarMinutes * 60 * 1000);
      return Math.max(
        0,
        calendarMinutes -
          countRemainingWeekendDays(resetAt, serverNow) * MINUTES_PER_DAY
      );
    },
    isBudgetDay: isWeekday,
  },
};

export function resolveDayPolicy(policy: DayPolicy): BudgetDayPolicy {
  return POLICIES[policy];
}
