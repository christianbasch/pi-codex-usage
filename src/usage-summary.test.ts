import { describe, expect, it } from 'vitest';
import type { DayPolicy } from './config.ts';
import { MINUTES_PER_DAY } from './format.ts';
import type { MonthlyUsage } from './monthly-usage.ts';
import {
  calculatePaceRatio,
  calculateSummary,
  minutesRemainingForPolicy,
} from './usage-summary.ts';

// Friday 2026-07-17, reset Monday 2026-07-27 (10 days out, 4 weekend days).
const now = new Date('2026-07-17T12:00:00Z');
const usage: MonthlyUsage = {
  limit: 8000,
  used: 4000,
  remaining: 4000,
  usedPercent: 50,
  remainingPercent: 50,
  resetAt: 1_785_110_400,
  resetAfterSeconds: 864_000,
  fetchedAt: now.getTime(),
};

describe('minutesRemainingForPolicy', () => {
  it('uses calendar minutes regardless of policy', () => {
    expect(minutesRemainingForPolicy(usage, 'calendar', now)).toBe(
      10 * MINUTES_PER_DAY
    );
  });

  it('subtracts remaining weekend minutes for the weekdays policy', () => {
    expect(minutesRemainingForPolicy(usage, 'weekdays', now)).toBe(
      6 * MINUTES_PER_DAY
    );
  });

  it('returns undefined when the reset time is not in the future', () => {
    const expired = { ...usage, resetAfterSeconds: 0 };
    const policy: DayPolicy = 'weekdays';
    expect(minutesRemainingForPolicy(expired, policy, now)).toBeUndefined();
    expect(minutesRemainingForPolicy(expired, 'calendar', now)).toBeUndefined();
  });

  it('shrinks as time passes without a refetch', () => {
    // The snapshot is not re-fetched, so remaining time must still decay with
    // the local clock instead of staying frozen until the next fetch.
    const sixHoursLater = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    expect(minutesRemainingForPolicy(usage, 'calendar', sixHoursLater)).toBe(
      9.75 * MINUTES_PER_DAY
    );
  });
});

describe('calculatePaceRatio', () => {
  it('compares credit progress with effective period progress', () => {
    const elapsedMinutes = 46.5 * MINUTES_PER_DAY;
    const remainingMinutes = 10 * MINUTES_PER_DAY;
    const consumedCreditPercent = usage.used / usage.limit;
    const consumedPeriodPercent =
      elapsedMinutes / (elapsedMinutes + remainingMinutes);
    const expected = consumedCreditPercent / consumedPeriodPercent;

    expect(calculatePaceRatio(usage, 'calendar', now)).toBeCloseTo(expected, 6);
  });

  it('uses the policy only to reduce remaining period time', () => {
    const calendarPace = calculatePaceRatio(usage, 'calendar', now);
    const weekdayPace = calculatePaceRatio(usage, 'weekdays', now);
    const elapsedMinutes = 46.5 * MINUTES_PER_DAY;
    const remainingMinutes = 6 * MINUTES_PER_DAY;
    const consumedCreditPercent = usage.used / usage.limit;
    const consumedPeriodPercent =
      elapsedMinutes / (elapsedMinutes + remainingMinutes);
    const expected = consumedCreditPercent / consumedPeriodPercent;

    expect(weekdayPace).toBeCloseTo(expected, 6);
    expect(weekdayPace).toBeLessThan(calendarPace!);
  });

  it('is undefined before any period time has elapsed', () => {
    const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
    const atPeriodStart = new Date('2026-07-01T00:00:00Z');
    expect(
      calculatePaceRatio({ ...usage, resetAt }, 'calendar', atPeriodStart)
    ).toBeUndefined();
  });
});

describe('calculateSummary', () => {
  it('derives pace metrics for the calendar policy', () => {
    const summary = calculateSummary(usage, 'calendar', now);
    expect(summary.minutes).toBe(10 * MINUTES_PER_DAY);
    expect(summary.minutesLeft).toBe(10 * MINUTES_PER_DAY);
    // Period started 2026-06-01 and ends 2026-07-27, so the fixed daily
    // target is spread over 56 calendar days.
    expect(summary.avgDailyUsed).toBeCloseTo(4000 / 46.5, 6);
    expect(summary.dailyBudget).toBeCloseTo(8000 / 56, 6);
    expect(summary.projectedOverage).toBeCloseTo(
      4000 + (4000 / 46.5) * 10 - 8000,
      6
    );
    expect(summary.minutesUntilOut).toBeCloseTo(46.5 * MINUTES_PER_DAY, 6);
  });

  it('spreads the fixed budget target over weekdays', () => {
    const summary = calculateSummary(usage, 'weekdays', now);
    expect(summary.minutes).toBe(6 * MINUTES_PER_DAY);
    expect(summary.dailyBudget).toBeCloseTo(8000 / 40, 6);
  });

  it('leaves derived metrics undefined without days or usage', () => {
    const empty = { ...usage, used: 0, remaining: 0 };
    const summary = calculateSummary(empty, 'calendar', now);
    expect(summary.avgDailyUsed).toBe(0);
    expect(summary.minutesUntilOut).toBeUndefined();
    expect(summary.projectedOverage).toBeUndefined();
  });

  it('does not jump when a stale snapshot is finally refetched', () => {
    // Rendering a day-old snapshot must already account for the elapsed day,
    // so an identical fresh snapshot produces the same budget rather than a
    // sudden jump on reload.
    const aDayLater = new Date(now.getTime() + MINUTES_PER_DAY * 60 * 1000);
    const stale = calculateSummary(usage, 'calendar', aDayLater);
    const refetched = calculateSummary(
      {
        ...usage,
        resetAfterSeconds: usage.resetAfterSeconds - MINUTES_PER_DAY * 60,
        fetchedAt: aDayLater.getTime(),
      },
      'calendar',
      aDayLater
    );

    expect(stale.minutes).toBe(9 * MINUTES_PER_DAY);
    expect(refetched.dailyBudget).toBeCloseTo(stale.dailyBudget!, 6);
  });
});
