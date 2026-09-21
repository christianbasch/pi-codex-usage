import {
  countRemainingWeekendDays,
  daysElapsedInPeriod,
  daysUntilResetForPolicy,
  getLastResetDate,
  getPeriodBudgetPerDay,
} from './analytics.ts';
import type { DayPolicy } from './config.ts';
import { MINUTES_PER_DAY } from './format.ts';
import { type MonthlyUsage, minutesUntilReset } from './monthly-usage.ts';

export function minutesRemainingForPolicy(
  usage: MonthlyUsage,
  policy: DayPolicy,
  now: Date = new Date()
): number | undefined {
  const calendarMinutes = minutesUntilReset(usage, now);
  if (policy === 'calendar' || calendarMinutes === undefined) {
    return calendarMinutes;
  }
  // Classify weekdays on the same server-relative timeline as the countdown,
  // rather than reintroducing any offset from the local wall clock.
  const serverNow = new Date(
    usage.resetAt * 1000 - calendarMinutes * 60 * 1000
  );
  return Math.max(
    0,
    calendarMinutes -
      countRemainingWeekendDays(usage.resetAt, serverNow) * MINUTES_PER_DAY
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

function minutesInPeriodForPolicy(
  usage: MonthlyUsage,
  policy: DayPolicy
): number {
  return (
    daysUntilResetForPolicy(
      getLastResetDate(usage.resetAt),
      usage.resetAt,
      policy
    ) * MINUTES_PER_DAY
  );
}

export interface PeriodProgress {
  elapsedPercent: number;
  periodDays: number;
}

export function calculatePeriodProgress(
  usage: MonthlyUsage,
  policy: DayPolicy,
  now: Date = new Date()
): PeriodProgress | undefined {
  const remainingMinutes = minutesRemainingForPolicy(usage, policy, now);
  if (remainingMinutes === undefined) return undefined;

  const periodMinutes = minutesInPeriodForPolicy(usage, policy);
  if (periodMinutes <= 0) return undefined;

  return {
    elapsedPercent: ((periodMinutes - remainingMinutes) / periodMinutes) * 100,
    periodDays: periodMinutes / MINUTES_PER_DAY,
  };
}

/**
 * Compares the percentage of credits consumed with the percentage of the
 * policy-specific period consumed.
 */
export function calculatePaceRatio(
  usage: MonthlyUsage,
  policy: DayPolicy,
  now: Date = new Date()
): number | undefined {
  const progress = calculatePeriodProgress(usage, policy, now);
  if (!progress || usage.limit <= 0 || progress.elapsedPercent <= 0) {
    return undefined;
  }

  const consumedCreditPercent = usage.used / usage.limit;
  return consumedCreditPercent / (progress.elapsedPercent / 100);
}

export function calculateSummary(
  usage: MonthlyUsage,
  policy: DayPolicy,
  now: Date = new Date()
): UsageSummary {
  const minutes = minutesRemainingForPolicy(usage, policy, now);
  const days = minutes === undefined ? undefined : minutes / MINUTES_PER_DAY;
  const daysElapsed = daysElapsedInPeriod(usage.resetAt, now);
  const resetDate = new Date(usage.resetAt * 1000).toISOString().slice(0, 10);
  const dailyBudget =
    days === undefined
      ? undefined
      : getPeriodBudgetPerDay(
          usage.limit,
          getLastResetDate(usage.resetAt),
          resetDate,
          policy
        );
  const avgDailyUsed = daysElapsed ? usage.used / daysElapsed : undefined;
  const elapsedPolicyDays =
    minutes === undefined
      ? undefined
      : (minutesInPeriodForPolicy(usage, policy) - minutes) / MINUTES_PER_DAY;
  const policyDailyUsed =
    elapsedPolicyDays !== undefined && elapsedPolicyDays > 0
      ? usage.used / elapsedPolicyDays
      : undefined;
  const projectedOverage =
    policyDailyUsed && days !== undefined
      ? usage.used + policyDailyUsed * days - usage.limit
      : undefined;
  const minutesUntilOut = policyDailyUsed
    ? (usage.remaining / policyDailyUsed) * MINUTES_PER_DAY
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
