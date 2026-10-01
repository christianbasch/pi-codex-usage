import { describe, expect, it } from 'vitest';
import { resolveDayPolicy } from '../day-policy.ts';
import {
  daysElapsedInPeriod,
  getLastResetDate,
  getPeriodBudgetPerDay,
  getPreviousPeriodStart,
} from './period.ts';

describe('billing-period calculations', () => {
  describe('daysElapsedInPeriod', () => {
    it('computes days elapsed since the last calendar-month reset', () => {
      // resetAt = August 1 → lastResetDate = July 1
      const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
      const now = new Date('2026-07-15T12:00:00Z');
      expect(daysElapsedInPeriod(resetAt, now)).toBeCloseTo(14.5, 1);
    });
  });

  describe('getPreviousPeriodStart', () => {
    it('handles the year boundary', () => {
      expect(getPreviousPeriodStart(new Date('2026-01-01'))).toEqual(
        new Date('2025-12-01')
      );
    });
  });

  describe('getPeriodBudgetPerDay', () => {
    it('spreads the monthly limit across weekdays', () => {
      expect(
        getPeriodBudgetPerDay(
          230,
          new Date('2026-07-01'),
          new Date('2026-08-01'),
          resolveDayPolicy('weekdays')
        )
      ).toBe(10);
    });
  });

  describe('getLastResetDate', () => {
    it('returns the start of the previous calendar month', () => {
      expect(
        getLastResetDate(Date.parse('2026-08-01T00:00:00Z') / 1000)
      ).toEqual(new Date('2026-07-01'));
    });
  });
});
