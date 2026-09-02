import type { Theme } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import {
  AccountTab,
  type AccountTabData,
  type AccountTabOptions,
} from './account-tab.ts';
import type { AnalyticsResult } from './analytics.ts';
import { MINUTES_PER_DAY, MINUTES_PER_HOUR } from './format.ts';

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
  minutesUntilOut: 8 * MINUTES_PER_DAY,
  dayPolicy: 'calendar',
};

function createOptions(
  overrides: Partial<AccountTabOptions> = {}
): AccountTabOptions {
  return {
    data: { ...initialData },
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
      minutesUntilOut: 40 * MINUTES_PER_DAY,
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

  it('formats early runout using remaining time formatting', () => {
    const tab = createTab({
      data: {
        ...initialData,
        minutesLeft: 9 * MINUTES_PER_DAY + 5 * MINUTES_PER_HOUR,
        minutesUntilOut: 8 * MINUTES_PER_DAY,
      },
    });

    expect(tab.renderSummaryLines()[2]).toContain(
      'runs out 1d 5h before reset'
    );
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
        minutesUntilOut: 2 * MINUTES_PER_DAY,
      }
    );

    expect(tab.renderSummaryLines()[0]).toContain('7k / 9k');
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

  it('scopes the current period to the monthly reset without a lastResetDate', () => {
    // Analytics requested before the reset time is known carry no
    // lastResetDate. Falling back to the fetched startDate would show the
    // previous period, so the monthly reset must define the period start.
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
    const tab = createTab({
      data: { ...initialData, resetAt, dailyBudget: 383 },
    });
    const day = (date: string) => ({
      date,
      models: [
        {
          model: 'gpt-5.4',
          credits: 5,
          uncached_text_input_tokens: 0,
          cached_text_input_tokens: 0,
          text_output_tokens: 0,
        },
      ],
    });
    tab.setAnalytics({
      startDate: '2026-08-30',
      endDate: '2026-09-02',
      lastResetDate: undefined,
      groupBy: 'day',
      breakdown: {
        workspaceUser: [
          day('2026-08-30'),
          day('2026-08-31'),
          day('2026-09-01'),
          day('2026-09-02'),
        ],
      },
    });

    const rendered = tab.renderChart(100, 6).join('\n');

    expect(rendered).toContain('09-01');
    expect(rendered).toContain('09-02');
    expect(rendered).not.toContain('08-30');
    expect(rendered).not.toContain('08-31');
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

  it('shows the current policy-aware budget beside a zero-usage marker', () => {
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
    const tab = createTab({
      data: {
        ...initialData,
        dailyBudget: 372,
        resetAt,
        dayPolicy: 'weekdays',
      },
    });
    const analytics = {
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      lastResetDate: '2026-09-01',
      groupBy: 'day' as const,
      breakdown: { workspaceUser: [{ date: '2026-09-01', models: [] }] },
    };
    tab.setAnalytics(analytics);

    const [row = '', axis = ''] = tab.renderChart(100, 2);

    expect(row).toContain('372 ▏');
    expect(axis).toContain('0');
    expect(axis).not.toContain('372');

    const calendarTab = createTab({
      data: {
        ...initialData,
        dailyBudget: 271,
        resetAt,
        dayPolicy: 'calendar',
      },
    });
    calendarTab.setAnalytics(analytics);
    const [calendarRow = ''] = calendarTab.renderChart(100, 2);
    expect(calendarRow).toContain('271 ▏');
  });

  it('does not apply the current budget to a row that is not today', () => {
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
    const tab = createTab({
      data: {
        ...initialData,
        dailyBudget: 372,
        resetAt,
        dayPolicy: 'weekdays',
      },
    });
    // The last analytics row is 2026-09-01 but endDate (today) is 2026-09-02.
    // The current daily budget must not be applied to the stale row.
    tab.setAnalytics({
      startDate: '2026-09-01',
      endDate: '2026-09-02',
      lastResetDate: '2026-09-01',
      groupBy: 'day',
      breakdown: { workspaceUser: [{ date: '2026-09-01', models: [] }] },
    });

    const [row = ''] = tab.renderChart(100, 2);

    expect(row).not.toContain('372 ▏');
  });

  it('uses weekday counts for weekly budgets in weekdays mode', () => {
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
    const tab = createTab({
      data: {
        ...initialData,
        dailyBudget: 100,
        resetAt,
        dayPolicy: 'weekdays',
      },
    });
    tab.setAnalytics({
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      lastResetDate: '2026-09-01',
      groupBy: 'week',
      breakdown: { workspaceUser: [{ date: '2026-09-01', models: [] }] },
    });
    tab.handleInput('g');

    const [row = ''] = tab.renderChart(100, 2);

    // A week has 5 weekdays, so the weekly budget is 100 * 5 = 500, not 700.
    expect(row).toContain('500 ▏');
    expect(row).not.toContain('700');
  });

  it('tracks analytics loading and errors', () => {
    const tab = createTab();
    tab.setAnalyticsLoading();
    expect(tab.renderChart(100, 2).join('\n')).toContain('⠋');

    tab.setAnalyticsError();
    expect(tab.renderChart(100, 2).join('\n')).toContain('No usage data');
  });
});
