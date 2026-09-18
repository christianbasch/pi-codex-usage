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

function elapsedMinutesForPolicy(
  usage: MonthlyUsage,
  policy: DayPolicy,
  remainingMinutes: number
): number {
  const periodMinutes =
    daysUntilResetForPolicy(
      getLastResetDate(usage.resetAt),
      usage.resetAt,
      policy
    ) * MINUTES_PER_DAY;
  return periodMinutes - remainingMinutes;
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
  const remainingMinutes = minutesRemainingForPolicy(usage, policy, now);
  if (remainingMinutes === undefined) return undefined;

  const elapsedMinutes = elapsedMinutesForPolicy(
    usage,
    policy,
    remainingMinutes
  );
  const periodMinutes = elapsedMinutes + remainingMinutes;
  if (usage.limit <= 0 || elapsedMinutes <= 0 || periodMinutes <= 0) {
    return undefined;
  }

  const consumedPeriodPercent = elapsedMinutes / periodMinutes;
  const consumedCreditPercent = usage.used / usage.limit;
  return consumedCreditPercent / consumedPeriodPercent;
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
      : elapsedMinutesForPolicy(usage, policy, minutes) / MINUTES_PER_DAY;
  const policyDailyUsed =
    elapsedPolicyDays !== undefined && elapsedPolicyDays > 0
      ? usage.used / elapsedPolicyDays
      : undefined;
  const projectedOverage =
    policyDailyUsed && days
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
