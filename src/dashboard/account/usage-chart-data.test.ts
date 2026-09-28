import { describe, expect, it } from 'vitest';
import type {
  AnalyticsResult,
  WorkspaceUserTokenUsage,
} from '../../shared/usage/analytics.ts';
import { buildChartData, sumCreditsInDateRange } from './usage-chart-data.ts';

function row(date: string, credits: number[]): WorkspaceUserTokenUsage {
  return {
    date,
    models: credits.map((value, index) => ({
      model: `model-${index}`,
      credits: value,
      uncached_text_input_tokens: 0,
      cached_text_input_tokens: 0,
      text_output_tokens: 0,
    })),
  };
}

describe('chart data', () => {
  describe('buildChartData', () => {
    it('builds daily chart rows with cumulative period accounting', () => {
      const analytics: AnalyticsResult = {
        startDate: '2026-09-01',
        endDate: '2026-09-02',
        lastResetDate: '2026-09-01',
        groupBy: 'day',
        breakdown: {
          workspaceUser: [row('2026-09-01', [5]), row('2026-09-02', [20])],
        },
      };
      const chart = buildChartData({
        analyticsByGroup: { day: analytics },
        groupBy: 'day',
        period: 'current',
        view: 'usage',
        monthlyLimit: 300,
        dayPolicy: 'calendar',
        resetAt: Date.parse('2026-10-01T00:00:00Z') / 1000,
      });

      expect(
        chart.map(
          ({
            label,
            value,
            cumulativeVariance,
            cumulativeBudget,
            cumulativeUsage,
          }) => ({
            label,
            value,
            cumulativeVariance,
            cumulativeBudget,
            cumulativeUsage,
          })
        )
      ).toEqual([
        {
          label: '09-01',
          value: 5,
          cumulativeVariance: -5,
          cumulativeBudget: 10,
          cumulativeUsage: 5,
        },
        {
          label: '09-02',
          value: 20,
          cumulativeVariance: 5,
          cumulativeBudget: 20,
          cumulativeUsage: 25,
        },
      ]);
    });
  });

  describe('sumCreditsInDateRange', () => {
    it('sums rows in a half-open date range', () => {
      expect(
        sumCreditsInDateRange(
          [
            row('2026-09-01', [2, 3]),
            row('2026-09-02', [4]),
            row('2026-09-03', [8]),
          ],
          '2026-09-01',
          '2026-09-03'
        )
      ).toBe(9);
    });
  });
});
