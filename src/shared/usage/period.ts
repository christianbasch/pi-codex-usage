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
