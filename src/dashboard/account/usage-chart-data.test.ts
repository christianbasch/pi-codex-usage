import { describe, expect, it, vi } from 'vitest';
import { resolveDayPolicy } from '../../shared/day-policy.ts';
import type {
  AnalyticsResult,
  WorkspaceUserTokenUsage,
} from '../../shared/usage/analytics.ts';
import { buildChartData, sumCreditsInDateRange } from './usage-chart-data.ts';

function row(date: string, credits: number[]): WorkspaceUserTokenUsage {
  return {
    date: new Date(date),
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
    it('uses injected day counting and budget-day classification for daily and weekly charts', () => {
      const dayPolicy = {
        ...resolveDayPolicy('calendar'),
        countDays: vi.fn().mockReturnValue(5),
        isBudgetDay: vi.fn().mockReturnValue(false),
      };
      const analytics: AnalyticsResult = {
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-02'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'day',
        breakdown: { workspaceUser: [row('2026-09-01', [5])] },
      };
      const options = {
        analyticsByGroup: { day: analytics },
        period: 'current' as const,
        view: 'usage' as const,
        monthlyLimit: 300,
        dayPolicy,
        resetAt: Date.parse('2026-10-01T00:00:00Z') / 1000,
      };

      const daily = buildChartData({ ...options, groupBy: 'day' });
      expect(daily[0]?.cumulativeBudget).toBe(300);
      expect(daily[0]?.isWeekend).toBe(true);
      expect(dayPolicy.countDays).toHaveBeenCalledWith(
        new Date('2026-09-01T00:00:00Z'),
        new Date('2026-10-01T00:00:00Z')
      );
      expect(dayPolicy.countDays).toHaveBeenCalledWith(
        new Date('2026-09-01T00:00:00Z'),
        new Date('2026-09-02T00:00:00Z')
      );

      dayPolicy.isBudgetDay.mockClear();
      const weekly = buildChartData({
        ...options,
        groupBy: 'week',
        period: 'days365',
      });
      expect(weekly[0]?.cumulativeBudget).toBe(0);
      expect(weekly[0]?.isWeekend).toBe(false);
      expect(dayPolicy.isBudgetDay).toHaveBeenCalledWith(
        new Date('2026-09-01T00:00:00Z')
      );
      expect(dayPolicy.isBudgetDay).toHaveBeenCalledWith(
        new Date('2026-09-02T00:00:00Z')
      );
    });

    it('builds daily chart rows with cumulative period accounting', () => {
      const analytics: AnalyticsResult = {
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-02'),
        lastResetDate: new Date('2026-09-01'),
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
        dayPolicy: resolveDayPolicy('calendar'),
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
          new Date('2026-09-01'),
          new Date('2026-09-03')
        )
      ).toBe(9);
    });
  });
});
