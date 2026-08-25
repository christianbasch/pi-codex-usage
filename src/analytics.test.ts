import { describe, expect, it, vi } from 'vitest';
import {
  countRemainingWeekendDays,
  daysElapsedInPeriod,
  fetchUsageAnalytics,
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

  it('uses the current calendar period when requested without reset data', () => {
    expect(
      getDateRange(new Date('2026-07-17T12:00:00Z'), undefined, true)
    ).toEqual({
      startDate: '2026-07-01',
      endDate: '2026-07-17',
    });
  });

  it('computes days elapsed since the last calendar-month reset', () => {
    // resetAt = August 1 → lastResetDate = July 1
    const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
    const now = new Date('2026-07-15T12:00:00Z');
    expect(daysElapsedInPeriod(resetAt, now)).toBeCloseTo(14.5, 1);
  });

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

  it('counts weekdays in a calendar period', () => {
    const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
    expect(periodLengthDays(resetAt, 'weekdays')).toBe(23);
  });

  it('derives the actual period length without assuming 30 days', () => {
    // July has 31 days, so July 1 → August 1 = 31 days
    const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
    expect(periodLengthDays(resetAt, 'calendar')).toBeCloseTo(31, 1);
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

  it('loads only the requested chart grouping', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );

    try {
      const analytics = await fetchUsageAnalytics(
        'token',
        new AbortController().signal,
        Date.parse('2026-08-01T00:00:00Z') / 1000,
        new Date('2026-07-17T12:00:00Z'),
        'day',
        true
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
      expect(requestUrl).toContain('group_by=day');
      expect(requestUrl).toContain('start_date=2026-07-01');
      expect(analytics.daily?.workspaceUser).toEqual([]);
      expect(analytics.weekly).toBeUndefined();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('sums model credits for a chart period', () => {
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
