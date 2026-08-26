import { countRemainingWeekendDays, daysElapsedInPeriod } from './analytics.ts';
import type { DayPolicy } from './config.ts';
import { daysUntilReset, type MonthlyUsage } from './monthly-usage.ts';

export function formatCredits(value: number): string {
  const displayValue = Math.abs(value) >= 1000 ? value / 1000 : value;
  const suffix = Math.abs(value) >= 1000 ? 'k' : '';
  return (
    new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    }).format(displayValue) + suffix
  );
}

export function formatResetAt(resetAt: number): string {
  return new Date(resetAt * 1000).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
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
