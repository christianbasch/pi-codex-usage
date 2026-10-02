import { MINUTES_PER_DAY } from './format.ts';
import { type MonthlyUsage, minutesUntilReset } from './usage/monthly-usage.ts';
import { getLastResetDate } from './usage/period.ts';
import { addUtcDays, startOfUtcDay } from './utc-date.ts';

export type DayPolicy = 'calendar' | 'weekdays';

export interface BudgetDayPolicy {
  readonly id: DayPolicy;
  readonly label: string;
  readonly statusAbbreviation: string;
  readonly controlAbbreviation: string;
  /** Budget days in [start, end); weekday counts use whole UTC day boundaries. */
  countDays(start: Date, end: Date): number;
  isBudgetDay(date: Date): boolean;
  remainingMinutes(usage: MonthlyUsage, now?: Date): number | undefined;
  periodMinutes(usage: MonthlyUsage): number;
  budgetPerDay(limit: number, start: Date, end: Date): number | undefined;
}

interface DayRules {
  countDays(start: Date, end: Date): number;
  isBudgetDay(date: Date): boolean;
  adjustRemainingMinutes(resetAt: number, calendarMinutes: number): number;
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

function createPolicy(
  id: DayPolicy,
  label: string,
  statusAbbreviation: string,
  controlAbbreviation: string,
  rules: DayRules
): BudgetDayPolicy {
  return {
    id,
    label,
    statusAbbreviation,
    controlAbbreviation,
    countDays: rules.countDays,
    isBudgetDay: rules.isBudgetDay,
    remainingMinutes(usage, now = new Date()) {
      const minutes = minutesUntilReset(usage, now);
      return minutes === undefined
        ? undefined
        : rules.adjustRemainingMinutes(usage.resetAt, minutes);
    },
    periodMinutes(usage) {
      return (
        rules.countDays(
          getLastResetDate(usage.resetAt),
          new Date(usage.resetAt * 1000)
        ) * MINUTES_PER_DAY
      );
    },
    budgetPerDay(limit, start, end) {
      const days = rules.countDays(start, end);
      return days > 0 ? limit / days : undefined;
    },
  };
}

const POLICIES: Record<DayPolicy, BudgetDayPolicy> = {
  calendar: createPolicy('calendar', 'calendar days', 'cal', 'cal', {
    countDays: (start, end) =>
      (end.getTime() - start.getTime()) / MILLISECONDS_PER_DAY,
    isBudgetDay: () => true,
    adjustRemainingMinutes: (_resetAt, minutes) => minutes,
  }),
  weekdays: createPolicy('weekdays', 'weekdays', 'wkd', 'wkdays', {
    countDays: (start, end) => countDaysMatching(start, end, isWeekday),
    isBudgetDay: isWeekday,
    adjustRemainingMinutes(resetAt, calendarMinutes) {
      // Classify weekdays on the server-relative countdown timeline, not the
      // potentially offset local wall clock.
      const serverNow = new Date(resetAt * 1000 - calendarMinutes * 60 * 1000);
      return Math.max(
        0,
        calendarMinutes -
          countRemainingWeekendDays(resetAt, serverNow) * MINUTES_PER_DAY
      );
    },
  }),
};

export function resolveDayPolicy(policy: DayPolicy): BudgetDayPolicy {
  return POLICIES[policy];
}
