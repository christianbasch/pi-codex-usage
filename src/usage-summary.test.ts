import { describe, expect, it } from 'vitest';
import type { DayPolicy } from './config.ts';
import type { MonthlyUsage } from './monthly-usage.ts';
import {
  calculateSummary,
  daysRemainingForPolicy,
  formatCredits,
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

describe('formatCredits', () => {
  it('formats small values without a suffix', () => {
    expect(formatCredits(950)).toBe('950');
    expect(formatCredits(86.021505)).toBe('86.02');
  });

  it('formats large values in thousands', () => {
    expect(formatCredits(1234)).toBe('1.23k');
    expect(formatCredits(8000)).toBe('8k');
  });

  it('keeps the sign of negative values', () => {
    expect(formatCredits(-2000)).toBe('-2k');
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
