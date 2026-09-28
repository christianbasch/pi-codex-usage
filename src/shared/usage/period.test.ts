import { describe, expect, it } from 'vitest';
import {
  daysUntilResetForPolicy,
  getPeriodBudgetPerDay,
  getPreviousPeriodStart,
} from './period.ts';

describe('billing-period calculations', () => {
  it('counts weekdays and computes their daily budget independently of analytics fetching', () => {
    const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
    expect(daysUntilResetForPolicy('2026-07-27', resetAt, 'weekdays')).toBe(5);
    expect(
      getPeriodBudgetPerDay(230, '2026-07-01', '2026-08-01', 'weekdays')
    ).toBe(10);
    expect(getPreviousPeriodStart('2026-01-01')).toBe('2025-12-01');
  });
});
