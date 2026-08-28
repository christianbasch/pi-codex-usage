import { countRemainingWeekendDays, daysElapsedInPeriod } from './analytics.ts';
import type { DayPolicy } from './config.ts';
import { MINUTES_PER_DAY } from './format.ts';
import { type MonthlyUsage, minutesUntilReset } from './monthly-usage.ts';

export function formatResetAt(resetAt: number): string {
  return new Date(resetAt * 1000).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
}

export function minutesRemainingForPolicy(
  usage: MonthlyUsage,
  policy: DayPolicy,
  now: Date = new Date()
): number | undefined {
  const calendarMinutes = minutesUntilReset(usage.resetAfterSeconds);
  if (policy === 'calendar' || calendarMinutes === undefined) {
    return calendarMinutes;
  }
  return Math.max(
    0,
    calendarMinutes -
      countRemainingWeekendDays(usage.resetAt, now) * MINUTES_PER_DAY
  );
}

export interface UsageSummary {
  minutes: number | undefined;
  minutesLeft: number | undefined;
  avgDailyUsed: number | undefined;
  dailyBudget: number | undefined;
  projectedOverage: number | undefined;
  minutesUntilOut: number | undefined;
}

export function calculateSummary(
  usage: MonthlyUsage,
  policy: DayPolicy,
  now: Date = new Date()
): UsageSummary {
  const minutes = minutesRemainingForPolicy(usage, policy, now);
  const days = minutes === undefined ? undefined : minutes / MINUTES_PER_DAY;
  const daysElapsed = daysElapsedInPeriod(usage.resetAt, now);
  const dailyBudget = days ? usage.remaining / days : undefined;
  const avgDailyUsed = daysElapsed ? usage.used / daysElapsed : undefined;
  const projectedOverage =
    avgDailyUsed && days
      ? usage.used + avgDailyUsed * days - usage.limit
      : undefined;
  const minutesUntilOut = avgDailyUsed
    ? (usage.remaining / avgDailyUsed) * MINUTES_PER_DAY
    : undefined;
  return {
    minutes,
    minutesLeft: minutes,
    avgDailyUsed,
    dailyBudget,
    projectedOverage,
    minutesUntilOut,
  };
}
