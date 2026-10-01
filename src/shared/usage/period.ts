import type { BudgetDayPolicy } from '../day-policy.ts';
import { startOfUtcMonth } from '../utc-date.ts';

/** Returns the first day of the calendar month before `periodStart`. */
export function getPreviousPeriodStart(periodStart: Date): Date {
  const previous = startOfUtcMonth(periodStart);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  return previous;
}

export function getLastResetDate(resetAt: number): Date {
  return getPreviousPeriodStart(new Date(resetAt * 1000));
}

export function daysElapsedInPeriod(resetAt: number, now = new Date()): number {
  const periodStart = getLastResetDate(resetAt);
  return Math.max(0, (now.getTime() - periodStart.getTime()) / 86_400_000);
}

export function getPeriodBudgetPerDay(
  monthlyLimit: number,
  periodStart: Date,
  periodEnd: Date,
  policy: BudgetDayPolicy
): number | undefined {
  const periodDays = policy.countDays(periodStart, periodEnd);
  return periodDays > 0 ? monthlyLimit / periodDays : undefined;
}
