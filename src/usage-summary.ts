import { countRemainingWeekendDays, daysElapsedInPeriod } from './analytics.ts';
import type { DayPolicy } from './config.ts';
import { daysUntilReset, type MonthlyUsage } from './monthly-usage.ts';

export function formatResetAt(resetAt: number): string {
  return new Date(resetAt * 1000).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
}

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const SECONDS_PER_DAY = 86_400;
const FULL_DAYS_ONLY_THRESHOLD = 2;

function formatRemainingSeconds(remainingSeconds: number): string | undefined {
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) {
    return undefined;
  }

  const remainingMinutes = Math.floor(remainingSeconds / 60);
  const days = Math.floor(remainingMinutes / MINUTES_PER_DAY);
  const hours = Math.floor(
    (remainingMinutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR
  );
  const minutes = remainingMinutes % MINUTES_PER_HOUR;

  if (days >= FULL_DAYS_ONLY_THRESHOLD) return `${days}d`;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  return `${hours}:${String(minutes).padStart(2, '0')}`;
}

export function formatRemainingTime(
  resetAt: number,
  now: Date = new Date(),
  policy: DayPolicy = 'calendar'
): string | undefined {
  const calendarSeconds = resetAt - now.getTime() / 1000;
  const remainingSeconds =
    policy === 'weekdays'
      ? calendarSeconds -
        countRemainingWeekendDays(resetAt, now) * SECONDS_PER_DAY
      : calendarSeconds;
  return formatRemainingSeconds(remainingSeconds);
}

export function daysRemainingForPolicy(
  usage: MonthlyUsage,
  policy: DayPolicy,
  now: Date = new Date()
): number | undefined {
  const calendarDays = daysUntilReset(usage.resetAfterSeconds);
  if (policy === 'calendar' || calendarDays === undefined) return calendarDays;
  return Math.max(
    0,
    calendarDays - countRemainingWeekendDays(usage.resetAt, now)
  );
}

export interface UsageSummary {
  days: number | undefined;
  daysLeft: number | undefined;
  avgDailyUsed: number | undefined;
  dailyBudget: number | undefined;
  projectedOverage: number | undefined;
  daysUntilOut: number | undefined;
}

export function calculateSummary(
  usage: MonthlyUsage,
  policy: DayPolicy,
  now: Date = new Date()
): UsageSummary {
  const days = daysRemainingForPolicy(usage, policy, now);
  const daysElapsed = daysElapsedInPeriod(usage.resetAt, now);
  const dailyBudget = days ? usage.remaining / days : undefined;
  const avgDailyUsed = daysElapsed ? usage.used / daysElapsed : undefined;
  const projectedOverage =
    avgDailyUsed && days
      ? usage.used + avgDailyUsed * days - usage.limit
      : undefined;
  const daysUntilOut = avgDailyUsed
    ? usage.remaining / avgDailyUsed
    : undefined;
  return {
    days,
    daysLeft: days,
    avgDailyUsed,
    dailyBudget,
    projectedOverage,
    daysUntilOut,
  };
}
