import type { BudgetDayPolicy } from '../day-policy.ts';
import { MINUTES_PER_DAY } from '../format.ts';
import { startOfUtcDay } from '../utc-date.ts';
import { type MonthlyUsage, minutesUntilReset } from './monthly-usage.ts';
import {
  daysElapsedInPeriod,
  getLastResetDate,
  getPeriodBudgetPerDay,
} from './period.ts';

export function minutesRemainingForPolicy(
  usage: MonthlyUsage,
  policy: BudgetDayPolicy,
  now: Date = new Date()
): number | undefined {
  const calendarMinutes = minutesUntilReset(usage, now);
  return calendarMinutes === undefined
    ? undefined
    : policy.remainingMinutes(usage.resetAt, calendarMinutes);
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
  policy: BudgetDayPolicy
): number {
  return (
    policy.countDays(
      getLastResetDate(usage.resetAt),
      new Date(usage.resetAt * 1000)
    ) * MINUTES_PER_DAY
  );
}

/**
 * Compares the percentage of credits consumed with the percentage of the
 * policy-specific period consumed.
 */
export function calculatePaceRatio(
  usage: MonthlyUsage,
  policy: BudgetDayPolicy,
  now: Date = new Date()
): number | undefined {
  const remainingMinutes = minutesRemainingForPolicy(usage, policy, now);
  if (remainingMinutes === undefined) return undefined;

  const periodMinutes = minutesInPeriodForPolicy(usage, policy);
  const elapsedMinutes = periodMinutes - remainingMinutes;
  if (usage.limit <= 0 || elapsedMinutes <= 0 || periodMinutes <= 0) {
    return undefined;
  }

  const consumedPeriodPercent = elapsedMinutes / periodMinutes;
  const consumedCreditPercent = usage.used / usage.limit;
  return consumedCreditPercent / consumedPeriodPercent;
}

export function calculateSummary(
  usage: MonthlyUsage,
  policy: BudgetDayPolicy,
  now: Date = new Date()
): UsageSummary {
  const minutes = minutesRemainingForPolicy(usage, policy, now);
  const days = minutes === undefined ? undefined : minutes / MINUTES_PER_DAY;
  const daysElapsed = daysElapsedInPeriod(usage.resetAt, now);
  const resetDate = startOfUtcDay(new Date(usage.resetAt * 1000));
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
