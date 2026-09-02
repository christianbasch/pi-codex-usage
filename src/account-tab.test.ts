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
    tab.handleInput('u');
    tab.handleInput('p');
    tab.handleInput('s');
    tab.handleInput('l');

    const controls = tab.renderControlLines(100).join('\n');
    expect(controls).toContain('view models');
    expect(controls).toContain('unit tokens');
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

    expect(tab.renderChart(100, 4)).toHaveLength(4);
    expect(tab.viewport.chartItemCount).toBe(3);
    expect(tab.viewport.maxScrollOffset).toBe(1);

    tab.handleInput('j');
    expect(tab.viewport.scrollOffset).toBe(1);
  });

  it('keeps the selected unit in a fixed-width column', () => {
    const tab = createTab();
    tab.setAnalytics({
      startDate: '2026-09-01',
      endDate: '2026-09-02',
      lastResetDate: undefined,
      groupBy: 'day',
      breakdown: {
        workspaceUser: [
          {
            date: '2026-09-01',
            models: [
              {
                model: 'gpt-5.4',
                credits: 999_990,
                uncached_text_input_tokens: 999_990,
                cached_text_input_tokens: 0,
                text_output_tokens: 0,
              },
            ],
          },
          {
            date: '2026-09-02',
            models: [
              {
                model: 'gpt-5.4',
                credits: 1_000_000,
                uncached_text_input_tokens: 1_000_000,
                cached_text_input_tokens: 0,
                text_output_tokens: 0,
              },
            ],
          },
        ],
      },
    });

    const [header, millionRow = '', thousandRow = ''] = tab.renderChart(80, 4);
    const valueEnd = (line: string, value: string) =>
      line.lastIndexOf(value) + value.length;
    expect(header).toBe('day   credits');
    expect(millionRow).toContain('1m');
    expect(thousandRow).toContain('999.99k');
    expect(valueEnd(millionRow, '1m')).toBe(valueEnd(thousandRow, '999.99k'));

    tab.handleInput('u');
    const [tokenHeader, tokenMillion = '', tokenThousand = ''] =
      tab.renderChart(80, 4);
    expect(tokenHeader).toBe('day   tokens');
    expect(tokenMillion).toContain('1m');
    expect(tokenThousand).toContain('999.99k');

    tab.handleInput('g');
    const weekHeader = tab.renderChart(80, 4)[0] ?? '';
    expect(weekHeader).toBe('week  tokens');
    expect(weekHeader.indexOf('tokens')).toBe(tokenHeader.indexOf('tokens'));
  });

  it('shows only a bare marker for an under-budget day, not the value', () => {
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
    const tab = createTab({
      data: {
        ...initialData,
        dailyBudget: 372,
        resetAt,
        dayPolicy: 'weekdays',
      },
    });
    tab.setAnalytics({
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      lastResetDate: '2026-09-01',
      groupBy: 'day',
      breakdown: { workspaceUser: [{ date: '2026-09-01', models: [] }] },
    });

    const [, row = '', axis = ''] = tab.renderChart(100, 3);

    // Under budget: just the marker, no value beside it and none on the axis.
    expect(row).toContain('▏');
    expect(row).not.toContain('372');
    expect(axis).not.toContain('372');
  });

  it('renders the policy-aware daily budget on over-budget bars', () => {
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
    // The budget value is still shown inside an over-budget bar, which is the
    // only place a number appears; the policy controls its magnitude.
    const overBudgetDay = {
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      lastResetDate: '2026-09-01',
      groupBy: 'day' as const,
      breakdown: {
        workspaceUser: [
          {
            date: '2026-09-01',
            models: [
              {
                model: 'gpt-5.4',
                credits: 500,
                uncached_text_input_tokens: 0,
                cached_text_input_tokens: 0,
                text_output_tokens: 0,
              },
            ],
          },
        ],
      },
    };

    const weekdays = createTab({
      data: {
        ...initialData,
        dailyBudget: 372,
        resetAt,
        dayPolicy: 'weekdays',
      },
    });
    weekdays.setAnalytics(overBudgetDay);
    const [, wdRow = '', wdAxis = ''] = weekdays.renderChart(100, 3);
    expect(wdRow).toContain('372');
    expect(wdAxis).not.toContain('372');

    const calendar = createTab({
      data: {
        ...initialData,
        dailyBudget: 271,
        resetAt,
        dayPolicy: 'calendar',
      },
    });
    calendar.setAnalytics(overBudgetDay);
    const [, calRow = ''] = calendar.renderChart(100, 3);
    expect(calRow).toContain('271');
  });

  it('uses the historical budget, not the summary budget, for a non-today row', () => {
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
    const tab = createTab({
      data: {
        ...initialData,
        dailyBudget: 372,
        resetAt,
        dayPolicy: 'weekdays',
      },
    });
    // endDate (today) is 2026-09-02, so the 2026-09-01 row is historical and
    // must use remaining/weekdays (8000/22 = 364), not the summary budget 372.
    tab.setAnalytics({
      startDate: '2026-09-01',
      endDate: '2026-09-02',
      lastResetDate: '2026-09-01',
      groupBy: 'day',
      breakdown: {
        workspaceUser: [
          {
            date: '2026-09-01',
            models: [
              {
                model: 'gpt-5.4',
                credits: 500,
                uncached_text_input_tokens: 0,
                cached_text_input_tokens: 0,
                text_output_tokens: 0,
              },
            ],
          },
        ],
      },
    });

    const [, row = ''] = tab.renderChart(100, 3);

    expect(row).toContain('364');
    expect(row).not.toContain('372');
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
    // Weekly budget is dailyBudget * 5 weekdays = 500, not * 7 = 700. Usage of
    // 600 is over 500 (so the 500 label renders) but under 700.
    tab.setAnalytics({
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      lastResetDate: '2026-09-01',
      groupBy: 'week',
      breakdown: {
        workspaceUser: [
          {
            date: '2026-09-01',
            models: [
              {
                model: 'gpt-5.4',
                credits: 600,
                uncached_text_input_tokens: 0,
                cached_text_input_tokens: 0,
                text_output_tokens: 0,
              },
            ],
          },
        ],
      },
    });
    tab.handleInput('g');

    const [, row = ''] = tab.renderChart(100, 3);

    expect(row).toContain('500');
    expect(row).not.toContain('700');
  });

  it('right-aligns the max usage tick at the bar end', () => {
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
    const tab = createTab({
      data: {
        ...initialData,
        dailyBudget: 100,
        resetAt,
        dayPolicy: 'calendar',
      },
    });
    tab.setAnalytics({
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      lastResetDate: '2026-09-01',
      groupBy: 'day',
      breakdown: {
        workspaceUser: [
          {
            date: '2026-09-01',
            models: [
              {
                model: 'gpt-5.4',
                credits: 1000,
                uncached_text_input_tokens: 0,
                cached_text_input_tokens: 0,
                text_output_tokens: 0,
              },
            ],
          },
        ],
      },
    });

    const [, , axis = ''] = tab.renderChart(60, 3);

    // Usage is the scale max, so its top tick lands at the bar end and is
    // right-aligned to stay within the axis instead of being clipped.
    expect(axis.trimEnd()).toMatch(/1k$/);
  });

  it('tracks analytics loading and errors', () => {
    const tab = createTab();
    tab.setAnalyticsLoading();
    expect(tab.renderChart(100, 2).join('\n')).toContain('⠋');

    tab.setAnalyticsError();
    expect(tab.renderChart(100, 2).join('\n')).toContain('No usage data');
  });
});
