import { describe, expect, it } from 'vitest';
import type { DayPolicy } from './config.ts';
import type { MonthlyUsage } from './monthly-usage.ts';
import {
  calculateSummary,
  daysRemainingForPolicy,
  formatRemainingTime,
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
};

describe('formatRemainingTime', () => {
  const resetAt = Date.parse('2026-07-20T00:00:00Z') / 1000;

  it('shows only full days when at least two days remain', () => {
    expect(formatRemainingTime(resetAt, new Date('2026-07-17T00:00:00Z'))).toBe(
      '3d'
    );
  });

  it('shows full days and hours when one to two days remain', () => {
    expect(formatRemainingTime(resetAt, new Date('2026-07-18T18:05:00Z'))).toBe(
      '1d 5h'
    );
  });

  it('shows hours and minutes when less than one day remains', () => {
    expect(formatRemainingTime(resetAt, new Date('2026-07-19T12:34:00Z'))).toBe(
      '11:26'
    );
  });

  it('excludes weekend time in weekdays mode', () => {
    const weekdayResetAt = Date.parse('2026-07-20T00:00:00Z') / 1000;
    const weekdayEvening = new Date('2026-07-17T18:05:00Z');

    expect(formatRemainingTime(weekdayResetAt, weekdayEvening)).toBe('2d');
    expect(
      formatRemainingTime(weekdayResetAt, weekdayEvening, 'weekdays')
    ).toBe('5:55');
  });

  it('returns undefined after the reset', () => {
    expect(
      formatRemainingTime(resetAt, new Date('2026-07-20T00:00:00Z'))
    ).toBeUndefined();
  });
});

describe('daysRemainingForPolicy', () => {
  it('uses calendar days regardless of policy', () => {
    expect(daysRemainingForPolicy(usage, 'calendar', now)).toBe(10);
  });

  it('subtracts remaining weekend days for the weekdays policy', () => {
    expect(daysRemainingForPolicy(usage, 'weekdays', now)).toBe(6);
  });

  it('returns undefined when the reset time is not in the future', () => {
    const expired = { ...usage, resetAfterSeconds: 0 };
    const policy: DayPolicy = 'weekdays';
    expect(daysRemainingForPolicy(expired, policy, now)).toBeUndefined();
    expect(daysRemainingForPolicy(expired, 'calendar', now)).toBeUndefined();
  });
});

describe('calculateSummary', () => {
  it('derives pace metrics for the calendar policy', () => {
    const summary = calculateSummary(usage, 'calendar', now);
    expect(summary.days).toBe(10);
    expect(summary.daysLeft).toBe(10);
    // Period started 2026-06-01, now is 46.5 days in.
    expect(summary.avgDailyUsed).toBeCloseTo(4000 / 46.5, 6);
    expect(summary.dailyBudget).toBe(400);
    expect(summary.projectedOverage).toBeCloseTo(
      4000 + (4000 / 46.5) * 10 - 8000,
      6
    );
    expect(summary.daysUntilOut).toBeCloseTo(46.5, 6);
  });

  it('budgets over weekdays for the weekdays policy', () => {
    const summary = calculateSummary(usage, 'weekdays', now);
    expect(summary.days).toBe(6);
    expect(summary.dailyBudget).toBeCloseTo(4000 / 6, 6);
  });

  it('leaves derived metrics undefined without days or usage', () => {
    const empty = { ...usage, used: 0, remaining: 0 };
    const summary = calculateSummary(empty, 'calendar', now);
    expect(summary.avgDailyUsed).toBe(0);
    expect(summary.daysUntilOut).toBeUndefined();
    expect(summary.projectedOverage).toBeUndefined();
  });
});
