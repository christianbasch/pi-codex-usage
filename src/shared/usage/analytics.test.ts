import { describe, expect, it, vi } from 'vitest';
import {
  fetchUsageAnalytics,
  getDateRange,
  mergeAnalyticsResults,
  sumModelCredits,
  sumModelTokens,
} from './analytics.ts';

describe('usage analytics', () => {
  describe('getDateRange', () => {
    it('uses a trailing 365-day date range', () => {
      expect(getDateRange(new Date('2026-07-17T12:00:00Z'))).toEqual({
        startDate: '2025-07-18',
        endDate: '2026-07-17',
      });
    });

    it('records last reset date and fetches a 365-day range', () => {
      const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
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
  });

  describe('fetchUsageAnalytics', () => {
    it('returns the same result shape for each chart grouping', async () => {
      const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(
          async () =>
            new Response(JSON.stringify({ data: [] }), { status: 200 })
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
  });

  describe('mergeAnalyticsResults', () => {
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
  });

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

  describe('sumModelCredits', () => {
    it('sums model credits for a chart period', () => {
      expect(sumModelCredits(models)).toBe(37.5);
    });
  });

  describe('sumModelTokens', () => {
    it('sums each token type across models', () => {
      expect(sumModelTokens(models, 'uncached_text_input_tokens')).toBe(500);
      expect(sumModelTokens(models, 'cached_text_input_tokens')).toBe(700);
      expect(sumModelTokens(models, 'text_output_tokens')).toBe(900);
    });
  });
});
