import type { Theme } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import {
  AccountTab,
  type AccountTabData,
  type AccountTabOptions,
} from './account-tab.ts';
import type { AnalyticsResult } from './analytics.ts';
import { MINUTES_PER_DAY } from './format.ts';

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  inverse: (text: string) => text,
} as unknown as Theme;

const initialData: AccountTabData = {
  monthlyUsed: 5190,
  monthlyLimit: 8000,
  monthlyRemaining: 2810,
  monthlyPercent: 65,
  monthlyRemainingPercent: 35,
  avgDailyUsed: 240,
  dailyBudget: 187,
  resetAt: undefined,
  resetLabel: 'July 31',
  minutesLeft: 14.5 * MINUTES_PER_DAY,
  projectedOverage: 2400,
  daysUntilOut: 8,
  dayPolicy: 'calendar',
};

function createOptions(
  overrides: Partial<AccountTabOptions> = {}
): AccountTabOptions {
  return {
    data: { ...initialData },
    formatCredits: String,
    onDayPolicyChange() {},
    ...overrides,
  };
}

function createAnalytics(): AnalyticsResult {
  return {
    startDate: '2026-07-01',
    endDate: '2026-07-04',
    lastResetDate: '2026-07-01',
    groupBy: 'day',
    breakdown: {
      workspaceUser: [
        {
          date: '2026-07-01',
          models: [
            {
              model: 'gpt-5.4',
              credits: 1,
              uncached_text_input_tokens: 10,
              cached_text_input_tokens: 5,
              text_output_tokens: 2,
            },
          ],
        },
        {
          date: '2026-07-02',
          models: [
            {
              model: 'gpt-5.4',
              credits: 2,
              uncached_text_input_tokens: 20,
              cached_text_input_tokens: 10,
              text_output_tokens: 4,
            },
          ],
        },
        {
          date: '2026-07-03',
          models: [
            {
              model: 'gpt-5.4',
              credits: 3,
              uncached_text_input_tokens: 30,
              cached_text_input_tokens: 15,
              text_output_tokens: 6,
            },
          ],
        },
      ],
    },
  };
}

function createTab(overrides: Partial<AccountTabOptions> = {}): AccountTab {
  return new AccountTab({ requestRender() {} }, theme, {
    ...createOptions(),
    ...overrides,
  });
}

describe('AccountTab state updates', () => {
  it('changes day policy without mutating the initial options data', () => {
    const options = createOptions();
    let selectedPolicy = options.data.dayPolicy;
    const tab = createTab({
      ...options,
      onDayPolicyChange(policy) {
        selectedPolicy = policy;
      },
    });

    tab.handleInput('d');

    expect(selectedPolicy).toBe('weekdays');
    expect(tab.renderControlLines(100).join('\n')).toContain('days wkdays');
    expect(options.data.dayPolicy).toBe('calendar');
  });

  it('refreshes summary data without mutating the initial options data', () => {
    const options = createOptions();
    const tab = createTab(options);

    tab.refreshSummary({
      avgDailyUsed: 100,
      dailyBudget: 200,
      minutesLeft: 2_880,
      projectedOverage: -10,
      daysUntilOut: 40,
    });

    expect(tab.renderSummaryLines()[1]).toContain('2d left');
    expect(options.data.minutesLeft).toBe(20_880);
    expect(options.data.dailyBudget).toBe(187);
  });

  it('shows absolute remaining credits when less than a day remains', () => {
    const tab = createTab({
      data: {
        ...initialData,
        monthlyUsed: 7_900,
        monthlyLimit: 8_000,
        monthlyRemaining: 100,
        minutesLeft: 720,
        dailyBudget: 200,
      },
    });

    const period = tab.renderSummaryLines()[1] ?? '';
    expect(period).toContain('100 remaining');
    expect(period).not.toContain('/day');
  });

  it('refreshes monthly data without mutating the initial options data', () => {
    const options = createOptions();
    const tab = createTab(options);

    tab.refreshUsage(
      {
        monthlyUsed: 7000,
        monthlyLimit: 9000,
        monthlyRemaining: 2000,
        monthlyPercent: 77,
        monthlyRemainingPercent: 23,
        resetAt: 1_785_542_400,
        resetLabel: 'August 1',
      },
      {
        avgDailyUsed: 300,
        dailyBudget: 100,
        minutesLeft: 4_320,
        projectedOverage: 100,
        daysUntilOut: 2,
      }
    );

    expect(tab.renderSummaryLines()[0]).toContain('7000 / 9000');
    expect(options.data.monthlyUsed).toBe(5190);
    expect(options.data.resetLabel).toBe('July 31');
  });
});

describe('AccountTab controls and analytics', () => {
  it('requests analytics when switching to an unloaded group', () => {
    let requestedGroup: string | undefined;
    const tab = createTab({
      onAnalyticsNeeded(groupBy) {
        requestedGroup = groupBy;
      },
    });

    expect(tab.selectedGroup).toBe('day');
    tab.handleInput('g');

    expect(tab.selectedGroup).toBe('week');
    expect(requestedGroup).toBe('week');
  });

  it('cycles account controls through their available values', () => {
    const tab = createTab();

    tab.handleInput('v');
    tab.handleInput('t');
    tab.handleInput('p');
    tab.handleInput('s');
    tab.handleInput('l');

    const controls = tab.renderControlLines(100).join('\n');
    expect(controls).toContain('view models');
    expect(controls).toContain('tokens counts');
    expect(controls).toContain('period week');
    expect(controls).toContain('sort oldest');
    expect(controls).toContain('scale sqrt');
  });

  it('renders analytics and maintains its account viewport', () => {
    const tab = createTab();
    tab.setAnalytics(createAnalytics());

    expect(tab.renderChart(100, 3)).toHaveLength(3);
    expect(tab.viewport.chartItemCount).toBe(3);
    expect(tab.viewport.maxScrollOffset).toBe(1);

    tab.handleInput('j');
    expect(tab.viewport.scrollOffset).toBe(1);
  });

  it('tracks analytics loading and errors', () => {
    const tab = createTab();
    tab.setAnalyticsLoading();
    expect(tab.renderChart(100, 2).join('\n')).toContain('⠋');

    tab.setAnalyticsError();
    expect(tab.renderChart(100, 2).join('\n')).toContain('No usage data');
  });
});
