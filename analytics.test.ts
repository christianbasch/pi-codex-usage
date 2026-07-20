import { describe, expect, it } from 'vitest';
import {
  daysElapsedInPeriod,
  getDateRange,
  getLastResetDate,
  periodLengthDays,
  sumModelCredits,
  sumModelTokens,
} from './analytics.ts';

describe('usage analytics', () => {
  it('uses a trailing 30-day date range', () => {
    expect(getDateRange(new Date('2026-07-17T12:00:00Z'))).toEqual({
      startDate: '2026-06-18',
      endDate: '2026-07-17',
    });
  });

  it('computes days elapsed since the last calendar-month reset', () => {
    // resetAt = August 1 → lastResetDate = July 1
    const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
    const now = new Date('2026-07-15T12:00:00Z');
    expect(daysElapsedInPeriod(resetAt, now)).toBeCloseTo(14.5, 1);
  });

  it('derives the actual period length without assuming 30 days', () => {
    // July has 31 days, so July 1 → August 1 = 31 days
    const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
    expect(periodLengthDays(resetAt)).toBeCloseTo(31, 1);
  });

  it('records last reset date and date range from resetAt', () => {
    const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
    expect(getLastResetDate(resetAt)).toBe('2026-07-01');
    expect(getDateRange(new Date('2026-07-17T12:00:00Z'), resetAt)).toEqual({
      startDate: '2026-06-18',
      endDate: '2026-07-17',
      lastResetDate: '2026-07-01',
    });
  });

  it('sums model credits and token categories for a chart period', () => {
    const models = [
      {
        model: 'gpt-5.4',
        credits: 12.5,
        uncached_text_input_tokens: 100,
        cached_text_input_tokens: 200,
        text_output_tokens: 300,
      },
      {
        model: 'gpt-5.6-sol',
        credits: 25,
        uncached_text_input_tokens: 400,
        cached_text_input_tokens: 500,
        text_output_tokens: 600,
      },
    ];
    expect(sumModelCredits(models)).toBe(37.5);
    expect(sumModelTokens(models, 'uncached_text_input_tokens')).toBe(500);
    expect(sumModelTokens(models, 'cached_text_input_tokens')).toBe(700);
    expect(sumModelTokens(models, 'text_output_tokens')).toBe(900);
  });
});
