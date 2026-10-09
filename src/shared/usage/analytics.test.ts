import { describe, expect, it, vi } from 'vitest';
import {
  fetchUsageAnalytics,
  getDateRange,
  mergeAnalyticsResults,
  sumModelCredits,
} from './analytics.ts';

describe('usage analytics', () => {
  describe('getDateRange', () => {
    it('returns UTC-midnight boundaries without mutating the supplied clock', () => {
      const now = new Date('2026-07-17T23:30:00-02:00');
      const range = getDateRange(now);
      expect(range.startDate).toEqual(new Date('2025-07-19T00:00:00Z'));
      expect(range.endDate).toEqual(new Date('2026-07-18T00:00:00Z'));
      expect(now.toISOString()).toBe('2026-07-18T01:30:00.000Z');
    });

    it('uses a trailing 365-day date range', () => {
      expect(getDateRange(new Date('2026-07-17T12:00:00Z'))).toEqual({
        startDate: new Date('2025-07-18'),
        endDate: new Date('2026-07-17'),
      });
    });

    it('records last reset date and fetches a 365-day range', () => {
      const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
      expect(getDateRange(new Date('2026-07-17T12:00:00Z'), resetAt)).toEqual({
        startDate: new Date('2025-07-18'),
        endDate: new Date('2026-07-17'),
        lastResetDate: new Date('2026-07-01'),
      });
    });

    it('keeps a 365-day range when the current period starts mid-window', () => {
      const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;

      expect(getDateRange(new Date('2026-09-05T12:00:00Z'), resetAt)).toEqual({
        startDate: new Date('2025-09-06'),
        endDate: new Date('2026-09-05'),
        lastResetDate: new Date('2026-09-01'),
      });
    });
  });

  describe('fetchUsageAnalytics', () => {
    it.each(['day', 'week'] as const)(
      'parses API dates once into UTC dates for %s grouping',
      async (groupBy) => {
        const models = [
          {
            model: 'gpt-5.4',
            credits: 12.5,
            uncached_text_input_tokens: 100,
            cached_text_input_tokens: 200,
            text_output_tokens: 300,
          },
        ];
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          new Response(
            JSON.stringify({
              data: [
                { date: '2024-02-29', models },
                { date: '2026-07-17', models: [] },
              ],
            }),
            { status: 200 }
          )
        );
        try {
          const analytics = await fetchUsageAnalytics(
            'token',
            new AbortController().signal,
            Date.parse('2026-08-01T00:00:01Z') / 1000,
            new Date('2026-07-17T23:30:00-02:00'),
            groupBy
          );
          expect(analytics.breakdown.workspaceUser).toEqual([
            { date: new Date('2024-02-29T00:00:00Z'), models },
            { date: new Date('2026-07-17T00:00:00Z'), models: [] },
          ]);
          expect(analytics.lastResetDate).toEqual(
            new Date('2026-07-01T00:00:00Z')
          );
          const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
          expect(url.searchParams.get('start_date')).toBe('2025-07-19');
          expect(url.searchParams.get('end_date')).toBe('2026-07-18');
          expect(url.searchParams.get('group_by')).toBe(groupBy);
          expect(url.searchParams.getAll('breakdown_by')).toEqual(['model']);
        } finally {
          fetchMock.mockRestore();
        }
      }
    );

    it.each(['day', 'week'] as const)(
      'normalizes grouped model usage for %s grouping without counting legacy models twice',
      async (groupBy) => {
        const model = {
          model: 'gpt-6.1-sol',
          credits: 12.5,
          uncached_text_input_tokens: 100,
          cached_text_input_tokens: 200,
          text_output_tokens: 300,
        };
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          new Response(
            JSON.stringify({
              data: [
                {
                  date: '2026-07-17',
                  product_surface_usage_values: {},
                  models: groupBy === 'day' ? [model] : undefined,
                  groups: [
                    {
                      dimensions: { model: model.model },
                      is_other: false,
                      credits: model.credits,
                      on_demand_credits: 2,
                      uncached_text_input_tokens: 100,
                      cached_text_input_tokens: 200,
                      text_output_tokens: 300,
                      text_total_tokens: 600,
                    },
                    {
                      dimensions: {},
                      is_other: true,
                      credits: 5,
                      cached_text_input_tokens: null,
                    },
                  ],
                },
                { date: '2026-07-18', groups: [], models: [model] },
              ],
            }),
            { status: 200 }
          )
        );
        try {
          const analytics = await fetchUsageAnalytics(
            'token',
            new AbortController().signal,
            undefined,
            new Date('2026-07-18T12:00:00Z'),
            groupBy
          );
          expect(analytics.breakdown.workspaceUser).toEqual([
            {
              date: new Date('2026-07-17T00:00:00Z'),
              models: [
                model,
                {
                  model: 'Other',
                  credits: 5,
                  uncached_text_input_tokens: 0,
                  cached_text_input_tokens: 0,
                  text_output_tokens: 0,
                },
              ],
            },
            { date: new Date('2026-07-18T00:00:00Z'), models: [] },
          ]);
          expect(
            sumModelCredits(analytics.breakdown.workspaceUser[0]!.models)
          ).toBe(17.5);
        } finally {
          fetchMock.mockRestore();
        }
      }
    );

    it.each([undefined, null])(
      'uses legacy models when groups are %j',
      async (groups) => {
        const models = [
          {
            model: 'gpt-5.4',
            credits: 12.5,
            uncached_text_input_tokens: 100,
            cached_text_input_tokens: 200,
            text_output_tokens: 300,
          },
        ];
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
          new Response(
            JSON.stringify({
              data: [{ date: '2026-07-17', groups, models }],
            }),
            { status: 200 }
          )
        );
        try {
          const analytics = await fetchUsageAnalytics(
            'token',
            new AbortController().signal,
            undefined,
            new Date('2026-07-17T12:00:00Z'),
            'day'
          );
          expect(analytics.breakdown.workspaceUser).toEqual([
            { date: new Date('2026-07-17T00:00:00Z'), models },
          ]);
        } finally {
          fetchMock.mockRestore();
        }
      }
    );

    it.each([
      undefined,
      null,
      20260717,
      '',
      'not-a-date',
      '2026-7-17',
      '2026-07-17T00:00:00Z',
      '2026-02-29',
      '2024-02-30',
      '2026-13-01',
      '2026-07-00',
    ])('rejects invalid API dates (%j)', async (date) => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ data: [{ date, models: [] }] }), {
          status: 200,
        })
      );
      try {
        await expect(
          fetchUsageAnalytics(
            'token',
            new AbortController().signal,
            undefined,
            new Date('2026-07-17T12:00:00Z'),
            'day'
          )
        ).rejects.toThrow('Usage analytics response included an invalid date');
      } finally {
        fetchMock.mockRestore();
      }
    });

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
            startDate: new Date('2025-07-18'),
            endDate: new Date('2026-07-17'),
            lastResetDate: new Date('2026-07-01'),
            groupBy: 'day',
            breakdown: { workspaceUser: [] },
          },
          {
            startDate: new Date('2025-07-18'),
            endDate: new Date('2026-07-17'),
            lastResetDate: new Date('2026-07-01'),
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
        startDate: new Date('2026-06-18'),
        endDate: new Date('2026-07-17'),
        lastResetDate: new Date('2026-07-01'),
        groupBy: 'day' as const,
        breakdown: {
          workspaceUser: [
            { date: new Date('2026-06-20'), models: [] },
            { date: new Date('2026-07-10'), models: [] },
          ],
        },
      };
      const refreshedRow = { date: new Date('2026-07-10'), models: [] };

      const merged = mergeAnalyticsResults(existing, {
        startDate: new Date('2026-07-01'),
        endDate: new Date('2026-07-17'),
        lastResetDate: new Date('2026-07-01'),
        groupBy: 'day',
        breakdown: { workspaceUser: [refreshedRow] },
      });

      expect(merged.startDate).toEqual(new Date('2026-06-18'));
      expect(merged.groupBy).toBe('day');
      expect(merged.breakdown.workspaceUser).toEqual([
        { date: new Date('2026-06-20'), models: [] },
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
});
