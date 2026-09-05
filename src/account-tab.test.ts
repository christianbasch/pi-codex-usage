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

  it('cycles chart periods from current through the full year', () => {
    const tab = createTab();
    const periods = ['current', '7d', '30d', '90d', '180d', '365d'];

    for (const period of periods) {
      expect(tab.renderControlLines(100).join('\n')).toContain(
        `period ${period}`
      );
      tab.handleInput('p');
    }
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
    expect(controls).toContain('period 7d');
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

  it('does not render a daily budget marker for an under-budget day', () => {
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

    // The cumulative column replaces the daily marker for under-budget rows.
    expect(row).not.toContain('▏');
    expect(row).toContain('−364');
    expect(axis).not.toContain('372');
    expect(tab.renderLegendLines(100).join('\\n')).not.toContain(
      'daily budget'
    );
  });

  it('renders the positive cumulative delta in over-budget sections', () => {
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
    // The positive cumulative delta is shown inside the over-budget section.
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
    expect(wdRow).toContain('+136');
    expect(wdAxis).not.toContain('136');

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
    expect(calRow).toContain('+233');
  });

  it('uses cumulative variance instead of the supplied summary value', () => {
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
    // must use the fixed period target (8000/22 = 364), not the supplied
    // summary value.
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

    expect(row).toContain('+136');
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
    // Weekly budget is the fixed daily target * 5 weekdays = 1818, not * 7
    // calendar days. Usage of 2000 is over the weekday target.
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
                credits: 2_000,
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

    expect(row).toContain('+182');
  });

  it('shows cumulative variance without replacing usage or model views', () => {
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
    const model = (credits: number) => ({
      model: 'gpt-5.4',
      credits,
      uncached_text_input_tokens: 0,
      cached_text_input_tokens: 0,
      text_output_tokens: 0,
    });
    const tab = createTab({
      data: {
        ...initialData,
        monthlyUsed: 0,
        monthlyLimit: 300,
        monthlyRemaining: 300,
        monthlyPercent: 0,
        monthlyRemainingPercent: 100,
        dailyBudget: 10,
        resetAt,
      },
    });
    tab.setAnalytics({
      startDate: '2026-09-01',
      endDate: '2026-09-03',
      lastResetDate: '2026-09-01',
      groupBy: 'day',
      breakdown: {
        workspaceUser: [
          { date: '2026-09-02', models: [model(20)] },
          { date: '2026-09-01', models: [model(5)] },
          { date: '2026-09-03', models: [model(1)] },
        ],
      },
    });

    const rowFor = (lines: string[], date: string) =>
      lines.find((line) => line.includes(date)) ?? '';
    const usageChart = tab.renderChart(100, 5);
    expect(usageChart[0]).toContain('cum Δ');
    expect(usageChart[0]).toContain('cum budget');
    expect(usageChart[0]).toContain('cum usage');
    const varianceValue = rowFor(usageChart, '09-01');
    const varianceHeader = usageChart[0] ?? '';
    expect(varianceHeader.indexOf('cum Δ') + 'cum Δ'.length).toBe(
      varianceValue.lastIndexOf('−5') + '−5'.length
    );
    expect(varianceValue).not.toContain('▏');
    expect(rowFor(usageChart, '09-02')).toContain('+5');
    expect(rowFor(usageChart, '09-03')).toContain('−4');

    tab.handleInput('v');
    const modelChart = tab.renderChart(100, 5);
    expect(modelChart[0]).toContain('cum Δ');
    expect(rowFor(modelChart, '09-02')).toContain('+5');
    expect(tab.renderLegendLines(100).join('\\n')).toContain('gpt-5.4');

    tab.handleInput('u');
    expect(tab.renderChart(100, 5)[0]).not.toContain('cum Δ');
  });

  it('shows cumulative variance for the previous month using the current limit', () => {
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
    const emptyDay = (date: string) => ({ date, models: [] });
    const tab = createTab({
      data: {
        ...initialData,
        monthlyUsed: 0,
        monthlyLimit: 300,
        monthlyRemaining: 300,
        monthlyPercent: 0,
        monthlyRemainingPercent: 100,
        dailyBudget: 10,
        resetAt,
      },
    });
    tab.setAnalytics({
      startDate: '2026-08-01',
      endDate: '2026-09-05',
      lastResetDate: '2026-09-01',
      groupBy: 'day',
      breakdown: {
        workspaceUser: [
          ...Array.from({ length: 7 }, (_, index) =>
            emptyDay(`2026-08-${String(index + 1).padStart(2, '0')}`)
          ),
          ...Array.from({ length: 5 }, (_, index) =>
            emptyDay(`2026-09-0${index + 1}`)
          ),
        ],
      },
    });
    tab.handleInput('p');
    tab.handleInput('p');

    const lines = tab.renderChart(100, 20);
    const previousRow = lines.find((line) => line.includes('08-07')) ?? '';
    const currentRow = lines.find((line) => line.includes('09-01')) ?? '';

    // The previous-month value includes Aug 1–7, not just the visible Aug 7
    // row, and uses the current 300-credit limit.
    expect(previousRow).toContain('−68');
    expect(currentRow).toContain('−10');
  });

  it('reaches zero at the end of a previous month that uses the full limit', () => {
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
    const model = {
      model: 'gpt-5.4',
      credits: 8_000,
      uncached_text_input_tokens: 0,
      cached_text_input_tokens: 0,
      text_output_tokens: 0,
    };
    const tab = createTab({
      data: {
        ...initialData,
        monthlyUsed: 0,
        monthlyLimit: 8_000,
        monthlyRemaining: 8_000,
        monthlyPercent: 0,
        monthlyRemainingPercent: 100,
        dailyBudget: 8_000 / 30,
        resetAt,
      },
    });
    tab.setAnalytics({
      startDate: '2026-08-01',
      endDate: '2026-09-05',
      lastResetDate: '2026-09-01',
      groupBy: 'day',
      breakdown: {
        workspaceUser: [
          ...Array.from({ length: 30 }, (_, index) => ({
            date: `2026-08-${String(index + 1).padStart(2, '0')}`,
            models: [],
          })),
          { date: '2026-08-31', models: [model] },
        ],
      },
    });
    tab.handleInput('p');
    tab.handleInput('p');

    const previousLastDay =
      tab.renderChart(100, 40).find((line) => line.includes('08-31')) ?? '';

    expect(previousLastDay).toMatch(/\s0\s+8k\s+8k$/);
  });

  it('marks the incomplete first billing period as N/A', () => {
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
    const mutedTheme = {
      ...theme,
      fg: (color: string, text: string) =>
        color === 'muted' ? `[muted]${text}[/muted]` : text,
    } as Theme;
    const tab = new AccountTab(
      { requestRender() {} },
      mutedTheme,
      createOptions({
        data: {
          ...initialData,
          monthlyUsed: 0,
          monthlyLimit: 300,
          monthlyRemaining: 300,
          monthlyPercent: 0,
          monthlyRemainingPercent: 100,
          dailyBudget: 10,
          resetAt,
        },
      })
    );
    tab.setAnalytics({
      startDate: '2025-09-06',
      endDate: '2026-09-05',
      lastResetDate: '2026-09-01',
      groupBy: 'day',
      breakdown: {
        workspaceUser: [
          { date: '2025-09-06', models: [] },
          { date: '2025-10-01', models: [] },
          { date: '2026-09-05', models: [] },
        ],
      },
    });
    for (let index = 0; index < 5; index++) tab.handleInput('p');
    tab.handleInput('s');

    const lines = tab.renderChart(100, 5);

    expect(lines[1]).toContain('[muted]N/A[/muted]');
    expect(lines[1]).toContain('[muted]60[/muted]');
    expect(lines[1]).toContain('[muted]0[/muted]');
    expect(lines[2]).not.toContain('N/A');
    expect(lines[3]).not.toContain('N/A');
  });

  it('shows cumulative variance for previous-month weekly budgets', () => {
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
    const tab = createTab({
      data: {
        ...initialData,
        monthlyUsed: 0,
        monthlyLimit: 300,
        monthlyRemaining: 300,
        monthlyPercent: 0,
        monthlyRemainingPercent: 100,
        dailyBudget: 10,
        resetAt,
      },
    });
    tab.handleInput('g');
    tab.setAnalytics({
      startDate: '2026-08-01',
      endDate: '2026-09-05',
      lastResetDate: '2026-09-01',
      groupBy: 'week',
      breakdown: {
        workspaceUser: [
          { date: '2026-08-02', models: [] },
          { date: '2026-08-09', models: [] },
          { date: '2026-08-16', models: [] },
          { date: '2026-08-23', models: [] },
        ],
      },
    });
    tab.handleInput('p');
    tab.handleInput('p');

    const lines = tab.renderChart(100, 10);
    const previousRow = lines.find((line) => line.includes('08-23')) ?? '';

    expect(lines[0]).toContain('cum Δ');
    expect(previousRow).toContain('−281');
  });

  it('shows cumulative variance for weekly budgets', () => {
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
    const tab = createTab({
      data: {
        ...initialData,
        monthlyUsed: 0,
        monthlyLimit: 300,
        monthlyRemaining: 300,
        monthlyPercent: 0,
        monthlyRemainingPercent: 100,
        dailyBudget: 10,
        resetAt,
      },
    });
    tab.handleInput('g');
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
                credits: 60,
                uncached_text_input_tokens: 0,
                cached_text_input_tokens: 0,
                text_output_tokens: 0,
              },
            ],
          },
        ],
      },
    });

    const [header = '', row = ''] = tab.renderChart(100, 3);
    expect(header).toContain('cum Δ');
    expect(row).toContain('−10');
  });

  it('attributes a cross-period weekly bucket using daily usage at week end', () => {
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
    const model = (credits: number) => ({
      model: 'gpt-5.4',
      credits,
      uncached_text_input_tokens: 0,
      cached_text_input_tokens: 0,
      text_output_tokens: 0,
    });
    const tab = createTab({
      data: {
        ...initialData,
        monthlyUsed: 0,
        monthlyLimit: 300,
        monthlyRemaining: 300,
        monthlyPercent: 0,
        monthlyRemainingPercent: 100,
        dailyBudget: 10,
        resetAt,
      },
    });
    tab.handleInput('g');
    tab.setAnalytics({
      startDate: '2026-08-30',
      endDate: '2026-09-05',
      lastResetDate: '2026-09-01',
      groupBy: 'week',
      breakdown: {
        workspaceUser: [{ date: '2026-08-30', models: [model(999)] }],
      },
    });
    tab.setAnalytics({
      startDate: '2026-08-30',
      endDate: '2026-09-05',
      lastResetDate: '2026-09-01',
      groupBy: 'day',
      breakdown: {
        workspaceUser: [
          { date: '2026-08-30', models: [model(100)] },
          { date: '2026-08-31', models: [model(100)] },
          ...Array.from({ length: 5 }, (_, index) => ({
            date: `2026-09-0${index + 1}`,
            models: [model(10)],
          })),
        ],
      },
    });
    tab.handleInput('p');

    const row =
      tab.renderChart(100, 3).find((line) => line.includes('08-30')) ?? '';

    expect(row).toContain('250');
    expect(row).toMatch(/\s0\s+50\s+50$/);
  });

  it('scales usage bars independently of budget values', () => {
    const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
    const barTheme = {
      ...theme,
      inverse: (text: string) => text.replaceAll(' ', '#'),
    } as Theme;
    const tab = new AccountTab(
      { requestRender() {} },
      barTheme,
      createOptions({
        data: {
          ...initialData,
          monthlyUsed: 0,
          monthlyLimit: 8_000,
          monthlyRemaining: 8_000,
          monthlyPercent: 0,
          monthlyRemainingPercent: 100,
          dailyBudget: 1_000,
          resetAt,
        },
      })
    );
    const model = (credits: number) => ({
      model: 'gpt-5.4',
      credits,
      uncached_text_input_tokens: 0,
      cached_text_input_tokens: 0,
      text_output_tokens: 0,
    });
    tab.setAnalytics({
      startDate: '2026-09-01',
      endDate: '2026-09-02',
      lastResetDate: '2026-09-01',
      groupBy: 'day',
      breakdown: {
        workspaceUser: [
          { date: '2026-09-01', models: [model(10)] },
          { date: '2026-09-02', models: [model(20)] },
        ],
      },
    });

    const row =
      tab.renderChart(100, 4).find((line) => line.includes('09-02')) ?? '';
    expect((row.match(/#/g) ?? []).length).toBe(53);
  });

  it('keeps fractional chart maxima within the plot width', () => {
    const tab = createTab();
    tab.setAnalytics({
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      lastResetDate: undefined,
      groupBy: 'day',
      breakdown: {
        workspaceUser: [
          {
            date: '2026-09-01',
            models: [
              {
                model: 'gpt-5.4',
                credits: 10.4,
                uncached_text_input_tokens: 0,
                cached_text_input_tokens: 0,
                text_output_tokens: 0,
              },
            ],
          },
        ],
      },
    });

    expect(tab.renderChart(80, 3)).toHaveLength(3);
  });

  const scales = ['linear', 'sqrt', 'log'] as const;
  it.each(scales)(
    'omits the max usage value from x-axis ticks (%s scale)',
    (scale) => {
      const tab = createTab();
      tab.setAnalytics({
        startDate: '2026-09-01',
        endDate: '2026-09-03',
        lastResetDate: undefined,
        groupBy: 'day',
        breakdown: {
          workspaceUser: [
            {
              date: '2026-09-01',
              models: [
                {
                  model: 'gpt-5.4',
                  credits: 1,
                  uncached_text_input_tokens: 0,
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
                  credits: 10,
                  uncached_text_input_tokens: 0,
                  cached_text_input_tokens: 0,
                  text_output_tokens: 0,
                },
              ],
            },
            {
              date: '2026-09-03',
              models: [
                {
                  model: 'gpt-5.4',
                  credits: 126,
                  uncached_text_input_tokens: 0,
                  cached_text_input_tokens: 0,
                  text_output_tokens: 0,
                },
              ],
            },
          ],
        },
      });
      for (let index = 0; index < scales.indexOf(scale); index++) {
        tab.handleInput('l');
      }

      const axis = tab.renderChart(80, 5).at(-1) ?? '';
      expect(axis).toContain('100');
      expect(axis).not.toContain('126');
    }
  );

  it('tracks analytics loading and errors', () => {
    const tab = createTab();
    tab.setAnalyticsLoading();
    expect(tab.renderChart(100, 2).join('\n')).toContain('⠋');

    tab.setAnalyticsError();
    expect(tab.renderChart(100, 2).join('\n')).toContain('No usage data');
  });
});
