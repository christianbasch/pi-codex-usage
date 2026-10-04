import type { BudgetDayPolicy } from '../day-policy.ts';
import { MINUTES_PER_DAY } from '../format.ts';
import { startOfUtcDay } from '../utc-date.ts';
import type { MonthlyUsage } from './monthly-usage.ts';
import { getLastResetDate } from './period.ts';

export interface UsageSummary {
  minutesLeft: number | undefined;
  dailyBudget: number | undefined;
  projectedOverage: number | undefined;
  minutesUntilOut: number | undefined;
}

function consumedPeriodFraction(
  usage: MonthlyUsage,
  policy: BudgetDayPolicy,
  now: Date
): number | undefined {
  const remainingMinutes = policy.remainingMinutes(usage, now);
  if (remainingMinutes === undefined) return undefined;

  const periodMinutes = policy.periodMinutes(usage);
  const elapsedMinutes = periodMinutes - remainingMinutes;
  if (usage.limit <= 0 || elapsedMinutes < 0 || periodMinutes <= 0) {
    return undefined;
  }

  return elapsedMinutes / periodMinutes;
}

/** Credit consumption divided by policy-specific period progress. */
export function calculatePaceRatio(
  usage: MonthlyUsage,
  policy: BudgetDayPolicy,
  now: Date = new Date()
): number | undefined {
  const progress = consumedPeriodFraction(usage, policy, now);
  return progress === undefined || progress === 0
    ? undefined
    : usage.used / usage.limit / progress;
}

/**
 * Credit consumption minus policy-specific period progress, in percentage
 * points. Positive values are over budget; negative values are under budget.
 */
export function calculateBudgetDeviation(
  usage: MonthlyUsage,
  policy: BudgetDayPolicy,
  now: Date = new Date()
): number | undefined {
  const progress = consumedPeriodFraction(usage, policy, now);
  return progress === undefined
    ? undefined
    : (usage.used / usage.limit - progress) * 100;
}

export function calculateSummary(
  usage: MonthlyUsage,
  policy: BudgetDayPolicy,
  now: Date = new Date()
): UsageSummary {
  const minutesLeft = policy.remainingMinutes(usage, now);
  const days =
    minutesLeft === undefined ? undefined : minutesLeft / MINUTES_PER_DAY;
  const resetDate = startOfUtcDay(new Date(usage.resetAt * 1000));
  const dailyBudget =
    days === undefined
      ? undefined
      : policy.budgetPerDay(
          usage.limit,
          getLastResetDate(usage.resetAt),
          resetDate
        );
  const elapsedPolicyDays =
    minutesLeft === undefined
      ? undefined
      : (policy.periodMinutes(usage) - minutesLeft) / MINUTES_PER_DAY;
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
    minutesLeft,
    dailyBudget,
    projectedOverage,
    minutesUntilOut,
  };
}
