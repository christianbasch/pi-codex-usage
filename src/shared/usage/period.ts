import type { BudgetDayPolicy } from '../day-policy.ts';

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Returns the first day of the calendar month before `periodStart`. */
export function getPreviousPeriodStart(periodStart: string): string {
  const previous = new Date(`${periodStart}T00:00:00Z`);
  previous.setUTCDate(1);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  return formatDate(previous);
}

export function getLastResetDate(resetAt: number): string {
  const lastReset = new Date(resetAt * 1000);
  lastReset.setUTCDate(1);
  lastReset.setUTCMonth(lastReset.getUTCMonth() - 1);
  return formatDate(lastReset);
}

export function daysElapsedInPeriod(resetAt: number, now = new Date()): number {
  const periodStart = new Date(`${getLastResetDate(resetAt)}T00:00:00Z`);
  return Math.max(0, (now.getTime() - periodStart.getTime()) / 86_400_000);
}

export function getPeriodBudgetPerDay(
  monthlyLimit: number,
  periodStart: string,
  periodEnd: string,
  policy: BudgetDayPolicy
): number | undefined {
  const periodDays = policy.countDays(
    new Date(`${periodStart}T00:00:00Z`),
    new Date(`${periodEnd}T00:00:00Z`)
  );
  return periodDays > 0 ? monthlyLimit / periodDays : undefined;
}
