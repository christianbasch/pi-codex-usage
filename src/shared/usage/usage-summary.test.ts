import { describe, expect, it, vi } from 'vitest';
import { type BudgetDayPolicy, resolveDayPolicy } from '../day-policy.ts';
import { MINUTES_PER_DAY } from '../format.ts';
import type { MonthlyUsage } from './monthly-usage.ts';
import { calculatePaceRatio, calculateSummary } from './usage-summary.ts';

const calendar = resolveDayPolicy('calendar');
const weekdays = resolveDayPolicy('weekdays');

// Friday 2026-07-17 at noon, reset Monday 2026-07-27 at midnight
// (9.5 days away, including 4 weekend days).
const now = new Date('2026-07-17T12:00:00Z');
const resetAt = Date.parse('2026-07-27T00:00:00Z') / 1000;
const usage: MonthlyUsage = {
  limit: 8000,
  used: 4000,
  remaining: 4000,
  usedPercent: 50,
  remainingPercent: 50,
  resetAt,
  resetAfterSeconds: (resetAt * 1000 - now.getTime()) / 1000,
  fetchedAt: now.getTime(),
};

describe('usage summary', () => {
  it('uses the injected policy for pace, budget, and forecast calculations', () => {
    const policy: BudgetDayPolicy = {
      ...calendar,
      budgetPerDay: vi.fn().mockReturnValue(400),
      remainingMinutes: vi.fn().mockReturnValue(2 * MINUTES_PER_DAY),
      periodMinutes: vi.fn().mockReturnValue(20 * MINUTES_PER_DAY),
    };

    expect(calculatePaceRatio(usage, policy, now)).toBeCloseTo(0.5 / 0.9);
    const summary = calculateSummary(usage, policy, now);
    expect(summary.minutesLeft).toBe(2 * MINUTES_PER_DAY);
    expect(summary).not.toHaveProperty('minutes');
    expect(summary.dailyBudget).toBe(400);
    expect(summary.projectedOverage).toBeCloseTo(4000 + (4000 / 18) * 2 - 8000);
    expect(summary.minutesUntilOut).toBe(18 * MINUTES_PER_DAY);
    expect(policy.budgetPerDay).toHaveBeenCalledWith(
      usage.limit,
      new Date('2026-06-01T00:00:00Z'),
      new Date(resetAt * 1000)
    );
    expect(policy.remainingMinutes).toHaveBeenCalledWith(usage, now);
    expect(policy.periodMinutes).toHaveBeenCalledWith(usage);
  });

  describe('calculatePaceRatio', () => {
    it('compares credit progress with effective period progress', () => {
      const elapsedMinutes = 46.5 * MINUTES_PER_DAY;
      const remainingMinutes = 9.5 * MINUTES_PER_DAY;
      const consumedCreditPercent = usage.used / usage.limit;
      const consumedPeriodPercent =
        elapsedMinutes / (elapsedMinutes + remainingMinutes);
      const expected = consumedCreditPercent / consumedPeriodPercent;

      expect(calculatePaceRatio(usage, calendar, now)).toBeCloseTo(expected, 6);
    });

    it('derives elapsed weekdays from the full period and remaining weekdays', () => {
      const elapsedMinutes = 34.5 * MINUTES_PER_DAY;
      const remainingMinutes = 5.5 * MINUTES_PER_DAY;
      const consumedCreditPercent = usage.used / usage.limit;
      const consumedPeriodPercent =
        elapsedMinutes / (elapsedMinutes + remainingMinutes);
      const expected = consumedCreditPercent / consumedPeriodPercent;

      expect(calculatePaceRatio(usage, weekdays, now)).toBeCloseTo(expected, 6);
    });

    it('is undefined before any period time has elapsed', () => {
      const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
      const atPeriodStart = new Date('2026-07-01T00:00:00Z');
      const usageAtPeriodStart = {
        ...usage,
        resetAt,
        resetAfterSeconds: (resetAt * 1000 - atPeriodStart.getTime()) / 1000,
        fetchedAt: atPeriodStart.getTime(),
      };

      expect(
        calculatePaceRatio(usageAtPeriodStart, calendar, atPeriodStart)
      ).toBeUndefined();
    });
  });

  describe('calculateSummary', () => {
    it('derives pace metrics for the calendar policy', () => {
      const summary = calculateSummary(usage, calendar, now);
      expect(summary.minutesLeft).toBe(9.5 * MINUTES_PER_DAY);
      // Period started 2026-06-01 and ends 2026-07-27, so the fixed daily
      // target is spread over 56 calendar days.
      expect(summary.dailyBudget).toBeCloseTo(8000 / 56, 6);
      expect(summary.projectedOverage).toBeCloseTo(
        4000 + (4000 / 46.5) * 9.5 - 8000,
        6
      );
      expect(summary.minutesUntilOut).toBeCloseTo(46.5 * MINUTES_PER_DAY, 6);
    });

    it('spreads the fixed budget target over weekdays', () => {
      const summary = calculateSummary(usage, weekdays, now);
      expect(summary.minutesLeft).toBe(5.5 * MINUTES_PER_DAY);
      expect(summary.dailyBudget).toBeCloseTo(8000 / 40, 6);
    });

    it('forecasts weekday usage from elapsed and remaining weekdays', () => {
      const summary = calculateSummary(
        { ...usage, used: 7000, remaining: 1000 },
        weekdays,
        now
      );
      const weekdayAverage = 7000 / 34.5;

      expect(summary.projectedOverage).toBeCloseTo(
        7000 + weekdayAverage * 5.5 - 8000,
        6
      );
      expect(summary.projectedOverage).toBeGreaterThan(0);
      expect(summary.minutesUntilOut).toBeCloseTo(
        (1000 / weekdayAverage) * MINUTES_PER_DAY,
        6
      );
    });

    it('keeps the final forecast when no policy time remains', () => {
      const finalWeekend = new Date('2026-07-25T12:00:00Z');
      const finalWeekendUsage = {
        ...usage,
        used: 7000,
        remaining: 1000,
        resetAfterSeconds: (resetAt * 1000 - finalWeekend.getTime()) / 1000,
        fetchedAt: finalWeekend.getTime(),
      };

      const summary = calculateSummary(
        finalWeekendUsage,
        weekdays,
        finalWeekend
      );

      expect(summary.minutesLeft).toBe(0);
      expect(summary.projectedOverage).toBe(-1000);
    });

    it('leaves derived metrics undefined without days or usage', () => {
      const empty = { ...usage, used: 0, remaining: 0 };
      const summary = calculateSummary(empty, calendar, now);
      expect(summary.minutesUntilOut).toBeUndefined();
      expect(summary.projectedOverage).toBeUndefined();
    });

    it('does not jump when a stale snapshot is finally refetched', () => {
      // Rendering a day-old snapshot must already account for the elapsed day,
      // so an identical fresh snapshot produces the same budget rather than a
      // sudden jump on reload.
      const aDayLater = new Date(now.getTime() + MINUTES_PER_DAY * 60 * 1000);
      const stale = calculateSummary(usage, calendar, aDayLater);
      const refetched = calculateSummary(
        {
          ...usage,
          resetAfterSeconds: usage.resetAfterSeconds - MINUTES_PER_DAY * 60,
          fetchedAt: aDayLater.getTime(),
        },
        calendar,
        aDayLater
      );

      expect(stale.minutesLeft).toBe(8.5 * MINUTES_PER_DAY);
      expect(refetched.dailyBudget).toBeCloseTo(stale.dailyBudget!, 6);
    });
  });
});
