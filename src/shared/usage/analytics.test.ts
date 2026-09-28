import { describe, expect, it, vi } from 'vitest';
import {
  countRemainingWeekendDays,
  daysElapsedInPeriod,
  daysUntilResetForPolicy,
  fetchUsageAnalytics,
  getDateRange,
  getLastResetDate,
  mergeAnalyticsResults,
  sumModelCredits,
  sumModelTokens,
} from './analytics.ts';

describe('usage analytics', () => {
  it('uses a trailing 365-day date range', () => {
    expect(getDateRange(new Date('2026-07-17T12:00:00Z'))).toEqual({
      startDate: '2025-07-18',
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

  it('calculates policy-specific days from a chart row to reset', () => {
    const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
    expect(daysUntilResetForPolicy('2026-07-13', resetAt, 'calendar')).toBe(19);
    expect(daysUntilResetForPolicy('2026-07-13', resetAt, 'weekdays')).toBe(15);
  });

  it('ignores sub-day jitter in the reported reset time', () => {
    // reset_at has been observed alternating by a second between fetches. That
    // must not add a whole weekday, which would visibly move the daily budget.
    const midnight = Date.parse('2026-10-01T00:00:00Z') / 1000;
    const oneSecondLater = midnight + 1;
    expect(
      daysUntilResetForPolicy('2026-09-01', oneSecondLater, 'weekdays')
    ).toBe(daysUntilResetForPolicy('2026-09-01', midnight, 'weekdays'));
    expect(countRemainingWeekendDays(oneSecondLater)).toBe(
      countRemainingWeekendDays(midnight)
    );
  });

  it('records last reset date and fetches a 365-day range', () => {
    const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
    expect(getLastResetDate(resetAt)).toBe('2026-07-01');
    expect(getDateRange(new Date('2026-07-17T12:00:00Z'), resetAt)).toEqual({
      startDate: '2025-07-18',
      endDate: '2026-07-17',
      lastResetDate: '2026-07-01',
    });
  });

  it('keeps a 365-day range when the current period starts mid-window', () => {
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;

    expect(getDateRange(new Date('2026-09-05T12:00:00Z'), resetAt)).toEqual({
      startDate: '2025-09-06',
      endDate: '2026-09-05',
      lastResetDate: '2026-09-01',
    });
  });

  it('returns the same result shape for each chart grouping', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () => new Response(JSON.stringify({ data: [] }), { status: 200 })
      );

    try {
      const results = await Promise.all(
        (['day', 'week'] as const).map((groupBy) =>
          fetchUsageAnalytics(
            'token',
            new AbortController().signal,
            Date.parse('2026-08-01T00:00:00Z') / 1000,
            new Date('2026-07-17T12:00:00Z'),
            groupBy
          )
        )
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(results).toEqual([
        {
          startDate: '2025-07-18',
          endDate: '2026-07-17',
          lastResetDate: '2026-07-01',
          groupBy: 'day',
          breakdown: { workspaceUser: [] },
        },
        {
          startDate: '2025-07-18',
          endDate: '2026-07-17',
          lastResetDate: '2026-07-01',
          groupBy: 'week',
          breakdown: { workspaceUser: [] },
        },
      ]);
      for (const call of fetchMock.mock.calls) {
        expect(String(call[0])).toContain('start_date=2025-07-18');
      }
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('merges refreshed ranges without dropping cached rows', () => {
    const existing = {
      startDate: '2026-06-18',
      endDate: '2026-07-17',
      lastResetDate: '2026-07-01',
      groupBy: 'day' as const,
      breakdown: {
        workspaceUser: [
          { date: '2026-06-20', models: [] },
          { date: '2026-07-10', models: [] },
        ],
      },
    };
    const refreshedRow = { date: '2026-07-10', models: [] };

    const merged = mergeAnalyticsResults(existing, {
      startDate: '2026-07-01',
      endDate: '2026-07-17',
      lastResetDate: '2026-07-01',
      groupBy: 'day',
      breakdown: { workspaceUser: [refreshedRow] },
    });

    expect(merged.startDate).toBe('2026-06-18');
    expect(merged.groupBy).toBe('day');
    expect(merged.breakdown.workspaceUser).toEqual([
      { date: '2026-06-20', models: [] },
      refreshedRow,
    ]);
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
