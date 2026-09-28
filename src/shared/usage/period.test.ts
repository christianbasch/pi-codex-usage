import { describe, expect, it } from 'vitest';
import {
  countRemainingWeekendDays,
  daysElapsedInPeriod,
  daysUntilResetForPolicy,
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

  describe('countRemainingWeekendDays', () => {
    it('counts remaining weekend days in a period', () => {
      // July 13 (Mon) → Aug 1: two full weekends remain (Jul 18–19, Jul 25–26)
      const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
      expect(
        countRemainingWeekendDays(resetAt, new Date('2026-07-13T00:00:00Z'))
      ).toBe(4);
    });

    it('returns zero remaining weekend days when none remain', () => {
      // July 28 (Tue) → Aug 1: only weekdays left
      const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
      expect(
        countRemainingWeekendDays(resetAt, new Date('2026-07-28T00:00:00Z'))
      ).toBe(0);
    });

    it('counts a fractional remaining weekend day when today is a weekend', () => {
      // Saturday July 25 at noon: half of Saturday + all of Sunday = 1.5
      const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
      expect(
        countRemainingWeekendDays(resetAt, new Date('2026-07-25T12:00:00Z'))
      ).toBe(1.5);
    });

    it('ignores sub-day jitter in the reset time', () => {
      const midnight = Date.parse('2026-10-01T00:00:00Z') / 1000;
      expect(countRemainingWeekendDays(midnight + 1)).toBe(
        countRemainingWeekendDays(midnight)
      );
    });
  });

  describe('daysUntilResetForPolicy', () => {
    it('calculates policy-specific days from a chart row to reset', () => {
      const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
      expect(daysUntilResetForPolicy('2026-07-13', resetAt, 'calendar')).toBe(
        19
      );
      expect(daysUntilResetForPolicy('2026-07-13', resetAt, 'weekdays')).toBe(
        15
      );
    });

    it('ignores sub-day jitter in the reported reset time', () => {
      // reset_at has been observed alternating by a second between fetches. That
      // must not add a whole weekday, which would visibly move the daily budget.
      const midnight = Date.parse('2026-10-01T00:00:00Z') / 1000;
      const oneSecondLater = midnight + 1;
      expect(
        daysUntilResetForPolicy('2026-09-01', oneSecondLater, 'weekdays')
      ).toBe(daysUntilResetForPolicy('2026-09-01', midnight, 'weekdays'));
    });
  });

  describe('getPreviousPeriodStart', () => {
    it('handles the year boundary', () => {
      expect(getPreviousPeriodStart('2026-01-01')).toBe('2025-12-01');
    });
  });

  describe('getPeriodBudgetPerDay', () => {
    it('spreads the monthly limit across weekdays', () => {
      expect(
        getPeriodBudgetPerDay(230, '2026-07-01', '2026-08-01', 'weekdays')
      ).toBe(10);
    });
  });

  describe('getLastResetDate', () => {
    it('returns the start of the previous calendar month', () => {
      expect(getLastResetDate(Date.parse('2026-08-01T00:00:00Z') / 1000)).toBe(
        '2026-07-01'
      );
    });
  });
});
