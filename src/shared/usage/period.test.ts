import { describe, expect, it } from 'vitest';
import { getLastResetDate, getPreviousPeriodStart } from './period.ts';

describe('billing-period calculations', () => {
  describe('getPreviousPeriodStart', () => {
    it('handles the year boundary', () => {
      expect(getPreviousPeriodStart(new Date('2026-01-01'))).toEqual(
        new Date('2025-12-01')
      );
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
