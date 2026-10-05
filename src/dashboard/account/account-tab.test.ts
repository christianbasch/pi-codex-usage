import type { Theme } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, it } from 'vitest';
import { resolveDayPolicy } from '../../shared/day-policy.ts';
import { MINUTES_PER_DAY, MINUTES_PER_HOUR } from '../../shared/format.ts';
import type { AnalyticsResult } from '../../shared/usage/analytics.ts';
import {
  AccountTab,
  type AccountTabData,
  type AccountTabOptions,
} from './account-tab.ts';

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  inverse: (text: string) => text,
  getColorMode: () => 'truecolor',
} as unknown as Theme;

const initialData: AccountTabData = {
  monthlyUsed: 5190,
  monthlyLimit: 8000,
  monthlyRemaining: 2810,
  monthlyPercent: 65,
  monthlyRemainingPercent: 35,
  dailyBudget: 187,
  resetAt: undefined,
  resetLabel: 'July 31',
  minutesLeft: 14.5 * MINUTES_PER_DAY,
  projectedOverage: 2400,
  minutesUntilOut: 8 * MINUTES_PER_DAY,
  dayPolicy: resolveDayPolicy('calendar'),
  displayMode: 'credits',
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
    startDate: new Date('2026-07-01'),
    endDate: new Date('2026-07-04'),
    lastResetDate: new Date('2026-07-01'),
    groupBy: 'day',
    breakdown: {
      workspaceUser: [
        {
          date: new Date('2026-07-01'),
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
          date: new Date('2026-07-02'),
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
          date: new Date('2026-07-03'),
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

describe('AccountTab', () => {
  describe('budget comparison display', () => {
    function comparisonTab(
      dayPolicy = resolveDayPolicy('calendar'),
      limit = 1000,
      used = 550,
      tabTheme: Theme = theme
    ) {
      const tab = new AccountTab(
        { requestRender() {} },
        tabTheme,
        createOptions({
          data: {
            ...initialData,
            monthlyLimit: limit,
            resetAt: Date.parse('2026-07-01T00:00:00Z') / 1000,
            dayPolicy,
          },
        })
      );
      tab.setAnalytics({
        startDate: new Date('2026-06-01'),
        endDate: new Date('2026-06-15'),
        lastResetDate: new Date('2026-06-01'),
        groupBy: 'day',
        breakdown: {
          workspaceUser: [
            {
              date: new Date('2026-06-15'),
              models: [
                {
                  model: 'gpt-5.4',
                  credits: used,
                  uncached_text_input_tokens: 0,
                  cached_text_input_tokens: 0,
                  text_output_tokens: 0,
                },
              ],
            },
          ],
        },
      });
      return tab;
    }

    it('changes only the comparison column and header in each mode', () => {
      const tab = comparisonTab();
      const summary = tab.renderSummaryLines();
      let prefix: string | undefined;
      for (const [mode, header, value] of [
        ['pace', 'Σ pace', '1.10'],
        ['pp', 'Σ Δ pp', '+5.0'],
        ['credits', 'Σ Δ cr', '+50'],
      ] as const) {
        tab.setDisplayMode(mode);
        const lines = tab.renderChart(100, 3);
        expect(lines[0]).toContain(header);
        expect(lines.slice(1).join('\n')).not.toMatch(/pp|×/);
        expect(lines[1]?.trimEnd()).toMatch(
          new RegExp(`${value.replace(/[.+]/g, '\\$&')}$`)
        );
        const currentPrefix = lines[1]!.slice(0, -9);
        if (prefix === undefined) prefix = currentPrefix;
        expect(currentPrefix).toBe(prefix);
        expect(tab.renderSummaryLines()).toEqual(summary);
        expect(lines[0]!.indexOf(header) + header.length).toBe(
          lines[1]!.length
        );
        for (const width of [40, 60, 100]) {
          expect(
            tab
              .renderChart(width, 3)
              .every((line) => visibleWidth(line) <= width)
          ).toBe(true);
        }
      }
      tab.handleInput('c');
      tab.handleInput('c');
      const credits = tab.renderChart(100, 3)[1] ?? '';
      expect(credits).toMatch(/\s\+50\s+550\s+500$/);
      tab.setDisplayMode('pp');
      expect(tab.renderChart(100, 3)[1]).toMatch(/\s\+5\.0\s+550\s+500$/);
      tab.handleInput('v');
      expect(tab.renderChart(100, 3)[0]).toContain('Σ Δ pp');
      expect(tab.renderChart(100, 3)[1]).toContain('+5.0');
    });

    it('uses policy-specific checkpoints for pace and pp', () => {
      const tab = comparisonTab(resolveDayPolicy('weekdays'));
      tab.setDisplayMode('pace');
      expect(tab.renderChart(100, 3)[1]).toContain('1.10');
      tab.setDisplayMode('pp');
      expect(tab.renderChart(100, 3)[1]).toContain('+5.0');
      tab.handleInput('g');
      tab.handleInput('p');
      // The available daily range ends June 15, so the weekly checkpoint also
      // has 11 of the period's 22 weekdays elapsed.
      expect(tab.renderChart(100, 3)[1]).toContain('+5.0');
    });

    it.each([
      [440, 'success', 'success'],
      [499, 'success', 'success'],
      [500, 'success', 'success'],
      [501, 'warning', 'success'],
      [505, 'warning', 'warning'],
      [525, 'warning', 'warning'],
      [526, 'warning', 'warning'],
      [528, 'warning', 'error'],
      [550, 'warning', 'error'],
      [560, 'error', 'error'],
    ] as const)(
      'uses mode-specific colors at %i credits',
      (used, deviationColor, paceColor) => {
        const taggedTheme = {
          ...theme,
          fg: (color: string, text: string) => `[${color}]${text}[/${color}]`,
        } as Theme;
        const tab = comparisonTab(undefined, 1000, used, taggedTheme);
        for (const mode of ['pace', 'pp', 'credits'] as const) {
          tab.setDisplayMode(mode);
          const row = tab.renderChart(100, 3)[1] ?? '';
          const color = mode === 'pace' ? paceColor : deviationColor;
          expect(row.trimEnd().endsWith(`[/${color}]`)).toBe(true);
        }
      }
    );

    it('combines period limits for a week crossing a billing boundary', () => {
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
          monthlyLimit: 300,
          resetAt: Date.parse('2026-10-01T00:00:00Z') / 1000,
        },
      });
      tab.setAnalytics({
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-09-05'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'day',
        breakdown: {
          workspaceUser: [
            { date: new Date('2026-08-31'), models: [model(330)] },
            { date: new Date('2026-09-05'), models: [model(50)] },
          ],
        },
      });
      tab.handleInput('g');
      tab.handleInput('p');
      tab.handleInput('c');
      tab.handleInput('c');
      for (const [mode, value] of [
        ['pace', '1.09'],
        ['pp', '+5.0'],
        ['credits', '+30'],
      ] as const) {
        tab.setDisplayMode(mode);
        const row = tab.renderChart(100, 3)[1] ?? '';
        expect(row).toContain(value);
        expect(row).toMatch(/\s380\s+350$/);
      }
    });

    it('shows no pace when the first checkpoint has no expected weekday spend', () => {
      const tab = createTab({
        data: {
          ...initialData,
          monthlyLimit: 300,
          dayPolicy: resolveDayPolicy('weekdays'),
          resetAt: Date.parse('2026-09-01T00:00:00Z') / 1000,
        },
      });
      tab.setAnalytics({
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-01'),
        lastResetDate: new Date('2026-08-01'),
        groupBy: 'day',
        breakdown: {
          workspaceUser: [{ date: new Date('2026-08-01'), models: [] }],
        },
      });
      tab.setDisplayMode('pace');
      expect(tab.renderChart(100, 3)[1]).toContain('N/A');
      tab.setDisplayMode('pp');
      expect(tab.renderChart(100, 3)[1]).toContain('0.0');
      tab.setDisplayMode('credits');
      expect(tab.renderChart(100, 3)[1]?.trimEnd()).toMatch(/\s0$/);
    });

    it.each(['pace', 'pp'] as const)(
      'shows N/A in %s mode with a zero budget limit',
      (mode) => {
        const tab = comparisonTab(resolveDayPolicy('calendar'), 0);
        tab.setDisplayMode(mode);
        expect(tab.renderChart(100, 3)[1]).toContain('N/A');
      }
    );
  });

  describe('AccountTab state updates', () => {
    it('changes day policy without mutating the initial options data', () => {
      const options = createOptions();
      let selectedPolicy = options.data.dayPolicy.id;
      const tab = createTab({
        ...options,
        onDayPolicyChange(policy) {
          selectedPolicy = policy;
        },
      });

      tab.handleInput('d');

      expect(selectedPolicy).toBe('weekdays');
      expect(tab.renderControlLines(100).join('\n')).toContain('days wkdays');
      expect(options.data.dayPolicy.id).toBe('calendar');

      tab.handleInput('d');
      expect(selectedPolicy).toBe('calendar');
      expect(tab.renderControlLines(100).join('\n')).toContain('days cal');
    });

    it('refreshes summary data without mutating the initial options data', () => {
      const options = createOptions();
      const tab = createTab(options);

      tab.refreshSummary({
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

    it('cycles chart periods between current and the full year', () => {
      const tab = createTab();
      const periods = ['current', '365d'];

      for (const period of periods) {
        expect(tab.renderControlLines(100).join('\n')).toContain(
          `period ${period}`
        );
        tab.handleInput('p');
      }
    });

    it('cycles cumulative chart columns with c', () => {
      const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
      const tab = createTab({
        data: {
          ...initialData,
          monthlyLimit: 300,
          monthlyRemaining: 300,
          resetAt,
        },
      });
      tab.setAnalytics({
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-01'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'day',
        breakdown: {
          workspaceUser: [{ date: new Date('2026-09-01'), models: [] }],
        },
      });

      const header = () => tab.renderChart(100, 3)[0] ?? '';
      expect(tab.renderControlLines(100).join('\n')).toContain('cols Δ');
      expect(header()).toContain('Σ Δ');
      expect(header()).not.toContain('Σ budget');
      expect(header()).not.toContain('Σ usage');

      tab.handleInput('c');
      expect(header()).toContain('Σ Δ');
      expect(header()).not.toContain('Σ budget');
      expect(header()).toContain('Σ usage');

      tab.handleInput('c');
      expect(header()).toContain('Σ Δ');
      expect(header()).toContain('Σ budget');
      expect(header()).toContain('Σ usage');
      expect(header().indexOf('Σ Δ')).toBeLessThan(header().indexOf('Σ usage'));
      expect(header().indexOf('Σ usage')).toBeLessThan(
        header().indexOf('Σ budget')
      );

      tab.handleInput('c');
      expect(header()).not.toContain('Σ Δ');
      expect(header()).not.toContain('Σ budget');
      expect(header()).not.toContain('Σ usage');

      tab.handleInput('c');
      expect(header()).toContain('Σ Δ');
      expect(header()).not.toContain('Σ budget');
      expect(header()).not.toContain('Σ usage');
    });

    it('cycles account controls through their available values', () => {
      const tab = createTab();

      tab.handleInput('v');
      tab.handleInput('p');
      tab.handleInput('s');
      tab.handleInput('l');

      const controls = tab.renderControlLines(100).join('\n');
      expect(controls).toContain('view models');
      expect(controls).toContain('period 365d');
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
        date: new Date(date),
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
        startDate: new Date('2026-08-30'),
        endDate: new Date('2026-09-02'),
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

    it('keeps account credit values in a fixed-width column', () => {
      const tab = createTab();
      tab.setAnalytics({
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-02'),
        lastResetDate: undefined,
        groupBy: 'day',
        breakdown: {
          workspaceUser: [
            {
              date: new Date('2026-09-01'),
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
              date: new Date('2026-09-02'),
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

      const [header, millionRow = '', thousandRow = ''] = tab.renderChart(
        80,
        4
      );
      const valueEnd = (line: string, value: string) =>
        line.lastIndexOf(value) + value.length;
      expect(header).toBe('day   credits');
      expect(millionRow).toContain('1m');
      expect(thousandRow).toContain('999.99k');
      expect(valueEnd(millionRow, '1m')).toBe(valueEnd(thousandRow, '999.99k'));
    });

    it('mutes the date and credit columns on weekend days', () => {
      const mutedTheme = {
        ...theme,
        fg: (color: string, text: string) =>
          color === 'muted' ? `[muted]${text}[/muted]` : text,
      } as Theme;
      const tab = new AccountTab(
        { requestRender() {} },
        mutedTheme,
        createOptions()
      );
      tab.setAnalytics({
        startDate: new Date('2026-09-04'),
        endDate: new Date('2026-09-06'),
        lastResetDate: undefined,
        groupBy: 'day',
        breakdown: {
          workspaceUser: ['2026-09-04', '2026-09-05', '2026-09-06'].map(
            (date, index) => ({
              date: new Date(date),
              models: [
                {
                  model: 'gpt-5.4',
                  credits: index + 1,
                  uncached_text_input_tokens: 0,
                  cached_text_input_tokens: 0,
                  text_output_tokens: 0,
                },
              ],
            })
          ),
        },
      });

      const rowFor = (lines: string[], date: string) =>
        lines.find((line) => line.includes(date)) ?? '';
      const calendarLines = tab.renderChart(100, 5);

      expect(rowFor(calendarLines, '09-06')).not.toContain('[muted]');
      expect(rowFor(calendarLines, '09-05')).not.toContain('[muted]');
      expect(rowFor(calendarLines, '09-04')).not.toContain('[muted]');

      tab.handleInput('d');
      const weekdaysLines = tab.renderChart(100, 5);

      expect(rowFor(weekdaysLines, '09-06')).toMatch(
        /\[muted\]09-06\s+3\[\/muted\]/
      );
      expect(rowFor(weekdaysLines, '09-05')).toMatch(
        /\[muted\]09-05\s+2\[\/muted\]/
      );
      expect(rowFor(weekdaysLines, '09-04')).not.toContain('[muted]');
    });

    it('shows cumulative variance for an under-budget day', () => {
      const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
      const tab = createTab({
        data: {
          ...initialData,
          dailyBudget: 372,
          resetAt,
          dayPolicy: resolveDayPolicy('weekdays'),
        },
      });
      tab.setAnalytics({
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-01'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'day',
        breakdown: {
          workspaceUser: [{ date: new Date('2026-09-01'), models: [] }],
        },
      });

      const [, row = ''] = tab.renderChart(100, 3);

      expect(row).toContain('−364');
    });

    it('renders the positive cumulative delta in over-budget sections', () => {
      const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
      // The positive cumulative delta is shown inside the over-budget section.
      const overBudgetDay = {
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-01'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'day' as const,
        breakdown: {
          workspaceUser: [
            {
              date: new Date('2026-09-01'),
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
          dayPolicy: resolveDayPolicy('weekdays'),
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
          dayPolicy: resolveDayPolicy('calendar'),
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
          dayPolicy: resolveDayPolicy('weekdays'),
        },
      });
      // endDate (today) is 2026-09-02, so the 2026-09-01 row is historical and
      // must use the fixed period target (8000/22 = 364), not the supplied
      // summary value.
      tab.setAnalytics({
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-02'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'day',
        breakdown: {
          workspaceUser: [
            {
              date: new Date('2026-09-01'),
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
      const resetAt = Date.parse('2026-12-01T00:00:00Z') / 1000;
      const tab = createTab({
        data: {
          ...initialData,
          dailyBudget: 100,
          resetAt,
          dayPolicy: resolveDayPolicy('weekdays'),
        },
      });
      // The Nov 1–7 bucket has five weekdays, while the monthly target is
      // spread over 21 weekdays. Usage of 2000 is over the bucket target.
      const weeklyRow = {
        date: new Date('2026-11-01'),
        models: [
          {
            model: 'gpt-5.4',
            credits: 2_000,
            uncached_text_input_tokens: 0,
            cached_text_input_tokens: 0,
            text_output_tokens: 0,
          },
        ],
      };
      tab.setAnalytics({
        startDate: new Date('2026-11-01'),
        endDate: new Date('2026-11-07'),
        lastResetDate: new Date('2026-11-01'),
        groupBy: 'week',
        breakdown: { workspaceUser: [weeklyRow] },
      });
      tab.setAnalytics({
        startDate: new Date('2026-11-01'),
        endDate: new Date('2026-11-07'),
        lastResetDate: new Date('2026-11-01'),
        groupBy: 'day',
        breakdown: { workspaceUser: [weeklyRow] },
      });
      tab.handleInput('g');

      const [, row = ''] = tab.renderChart(100, 3);

      expect(row).toContain('+95');
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
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-03'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'day',
        breakdown: {
          workspaceUser: [
            { date: new Date('2026-09-02'), models: [model(20)] },
            { date: new Date('2026-09-01'), models: [model(5)] },
            { date: new Date('2026-09-03'), models: [model(1)] },
          ],
        },
      });

      const rowFor = (lines: string[], date: string) =>
        lines.find((line) => line.includes(date)) ?? '';
      tab.handleInput('c');
      tab.handleInput('c');
      const usageChart = tab.renderChart(100, 5);
      expect(usageChart[0]).toContain('Σ Δ');
      expect(usageChart[0]).toContain('Σ budget');
      expect(usageChart[0]).toContain('Σ usage');
      const varianceValue = rowFor(usageChart, '09-01');
      const varianceHeader = usageChart[0] ?? '';
      expect(varianceHeader.indexOf('Σ Δ cr') + 'Σ Δ cr'.length).toBe(
        varianceValue.lastIndexOf('−5') + '−5'.length
      );
      expect(rowFor(usageChart, '09-02')).toContain('+5');
      expect(rowFor(usageChart, '09-03')).toContain('−4');

      tab.handleInput('v');
      const modelChart = tab.renderChart(100, 5);
      expect(modelChart[0]).toContain('Σ Δ');
      expect(rowFor(modelChart, '09-02')).toContain('+5');
      expect(tab.renderLegendLines(100).join('\\n')).toContain('gpt-5.4');
    });

    it('uses the terminal color mode for model legends and bars', () => {
      const tab = new AccountTab(
        { requestRender() {} },
        { ...theme, getColorMode: () => '256color' } as Theme,
        createOptions()
      );
      tab.setAnalytics(createAnalytics());
      tab.handleInput('v');

      expect(tab.renderLegendLines(100).join('')).toContain('\x1b[38;5;');
      expect(tab.renderChart(100, 5).join('')).toContain('\x1b[48;5;');
    });

    it('shows fractional model credits in the legend', () => {
      const tab = createTab();
      tab.setAnalytics({
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-01'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'day',
        breakdown: {
          workspaceUser: [
            {
              date: new Date('2026-09-01'),
              models: [
                {
                  model: 'codex-auto-review',
                  credits: 0.2,
                  uncached_text_input_tokens: 0,
                  cached_text_input_tokens: 0,
                  text_output_tokens: 0,
                },
              ],
            },
          ],
        },
      });
      tab.handleInput('v');

      expect(tab.renderLegendLines(100).join('\\n')).toContain(' 0.2');
    });

    it('sorts the model legend by descending total credits', () => {
      const model = (name: string, credits: number) => ({
        model: name,
        credits,
        uncached_text_input_tokens: 0,
        cached_text_input_tokens: 0,
        text_output_tokens: 0,
      });
      const tab = createTab();
      tab.setAnalytics({
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-02'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'day',
        breakdown: {
          workspaceUser: [
            {
              date: new Date('2026-09-01'),
              models: [model('alpha', 10), model('zeta', 1)],
            },
            { date: new Date('2026-09-02'), models: [model('zeta', 20)] },
          ],
        },
      });
      tab.handleInput('v');

      const legend = tab.renderLegendLines(100).join('\\n');
      expect(legend.indexOf('zeta')).toBeLessThan(legend.indexOf('alpha'));
    });

    it('renders every positive model segment with at least one character', () => {
      const model = (name: string, credits: number) => ({
        model: name,
        credits,
        uncached_text_input_tokens: 0,
        cached_text_input_tokens: 0,
        text_output_tokens: 0,
      });
      const tab = createTab();
      tab.setAnalytics({
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-02'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'day',
        breakdown: {
          workspaceUser: [
            {
              date: new Date('2026-09-01'),
              models: [model('gpt-large', 1000)],
            },
            {
              date: new Date('2026-09-02'),
              models: [model('gpt-small-1', 0.1), model('gpt-small-2', 0.1)],
            },
          ],
        },
      });
      tab.handleInput('v');

      const row =
        tab.renderChart(100, 4).find((line) => line.includes('09-02')) ?? '';
      expect(row.match(/\x1b\[48;2;/g)).toHaveLength(2);
    });

    it('shows cumulative variance for the previous month using the current limit', () => {
      const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
      const emptyDay = (date: string) => ({ date: new Date(date), models: [] });
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
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-09-05'),
        lastResetDate: new Date('2026-09-01'),
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
      tab.handleInput('c');
      tab.handleInput('c');

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
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-09-05'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'day',
        breakdown: {
          workspaceUser: [
            ...Array.from({ length: 30 }, (_, index) => ({
              date: new Date(`2026-08-${String(index + 1).padStart(2, '0')}`),
              models: [],
            })),
            { date: new Date('2026-08-31'), models: [model] },
          ],
        },
      });
      tab.handleInput('p');
      tab.handleInput('c');
      tab.handleInput('c');

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
        startDate: new Date('2025-09-06'),
        endDate: new Date('2026-09-05'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'day',
        breakdown: {
          workspaceUser: [
            { date: new Date('2025-09-06'), models: [] },
            { date: new Date('2025-10-01'), models: [] },
            { date: new Date('2026-09-05'), models: [] },
          ],
        },
      });
      tab.handleInput('p');
      tab.handleInput('c');
      tab.handleInput('c');
      tab.handleInput('s');

      const lines = tab.renderChart(100, 5);

      expect(lines[1]).toContain('[muted]N/A[/muted]');
      expect(lines[1]).toContain('[muted]60[/muted]');
      expect(lines[1]).toContain('[muted]0[/muted]');
      expect(lines[2]).not.toContain('N/A');
      expect(lines[3]).not.toContain('N/A');
      for (const mode of ['pace', 'pp', 'credits'] as const) {
        tab.setDisplayMode(mode);
        expect(tab.renderChart(100, 5)[1]).toContain('[muted]N/A[/muted]');
      }
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
      const weeklyRows = [
        { date: new Date('2026-08-02'), models: [] },
        { date: new Date('2026-08-09'), models: [] },
        { date: new Date('2026-08-16'), models: [] },
        { date: new Date('2026-08-23'), models: [] },
      ];
      tab.setAnalytics({
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-09-05'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'week',
        breakdown: { workspaceUser: weeklyRows },
      });
      tab.setAnalytics({
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-09-05'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'day',
        breakdown: { workspaceUser: weeklyRows },
      });
      tab.handleInput('p');
      tab.handleInput('c');
      tab.handleInput('c');

      const lines = tab.renderChart(100, 10);
      const previousRow = lines.find((line) => line.includes('08-23')) ?? '';

      expect(lines[0]).toContain('Σ Δ');
      expect(previousRow).toMatch(/\s−281\s+0\s+281$/);
    });

    it('does not show weekly cumulative values without daily accounting data', () => {
      const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
      const tab = createTab({
        data: { ...initialData, resetAt },
      });
      tab.handleInput('g');
      tab.setAnalytics({
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-06'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'week',
        breakdown: {
          workspaceUser: [{ date: new Date('2026-09-06'), models: [] }],
        },
      });

      const [header = ''] = tab.renderChart(100, 3);

      expect(header).not.toContain('Σ Δ');
    });

    it('shows cumulative variance for weekly budgets', () => {
      const resetAt = Date.parse('2026-12-01T00:00:00Z') / 1000;
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
      const weeklyRow = {
        date: new Date('2026-11-01'),
        models: [
          {
            model: 'gpt-5.4',
            credits: 60,
            uncached_text_input_tokens: 0,
            cached_text_input_tokens: 0,
            text_output_tokens: 0,
          },
        ],
      };
      tab.setAnalytics({
        startDate: new Date('2026-11-01'),
        endDate: new Date('2026-11-07'),
        lastResetDate: new Date('2026-11-01'),
        groupBy: 'week',
        breakdown: { workspaceUser: [weeklyRow] },
      });
      tab.setAnalytics({
        startDate: new Date('2026-11-01'),
        endDate: new Date('2026-11-07'),
        lastResetDate: new Date('2026-11-01'),
        groupBy: 'day',
        breakdown: { workspaceUser: [weeklyRow] },
      });
      tab.handleInput('p');
      tab.handleInput('c');
      tab.handleInput('c');

      const [header = '', row = ''] = tab.renderChart(100, 3);
      expect(header).toContain('Σ Δ');
      expect(row).toContain('−10');
    });

    it('inherits weekly cumulative values and combines shared periods', () => {
      const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
      const model = (credits: number) => ({
        model: 'gpt-5.4',
        credits,
        uncached_text_input_tokens: 0,
        cached_text_input_tokens: 0,
        text_output_tokens: 0,
      });
      const dateAt = (offset: number) =>
        new Date(Date.parse('2026-08-01T00:00:00Z') + offset * 86_400_000)
          .toISOString()
          .slice(0, 10);
      const dailyRows = Array.from({ length: 43 }, (_, offset) => {
        const date = dateAt(offset);
        const credits =
          date === '2026-08-30' || date === '2026-08-31'
            ? 100
            : date === '2026-08-23'
              ? 20
              : date >= '2026-09-01'
                ? 10
                : 0;
        return {
          date: new Date(date),
          models: credits ? [model(credits)] : [],
        };
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
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-09-12'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'week',
        breakdown: {
          workspaceUser: [
            { date: new Date('2026-08-23'), models: [model(999)] },
            { date: new Date('2026-08-30'), models: [model(999)] },
            { date: new Date('2026-09-06'), models: [model(999)] },
          ],
        },
      });
      tab.setAnalytics({
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-09-12'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'day',
        breakdown: { workspaceUser: dailyRows },
      });
      tab.handleInput('p');
      tab.handleInput('c');
      tab.handleInput('c');

      const lines = tab.renderChart(100, 6);
      const rowFor = (date: string) =>
        lines.find((line) => line.includes(date)) ?? '';

      expect(rowFor('08-23')).toMatch(/\s−261\s+20\s+281$/);
      expect(rowFor('08-30')).toMatch(/\s−80\s+270\s+350$/);
      expect(rowFor('09-06')).toMatch(/\s0\s+120\s+120$/);
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
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-02'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'day',
        breakdown: {
          workspaceUser: [
            { date: new Date('2026-09-01'), models: [model(10)] },
            { date: new Date('2026-09-02'), models: [model(20)] },
          ],
        },
      });
      tab.handleInput('c');
      tab.handleInput('c');

      const row =
        tab.renderChart(100, 4).find((line) => line.includes('09-02')) ?? '';
      expect((row.match(/#/g) ?? []).length).toBe(56);
    });

    it('positions over-budget sections using the selected chart scale', () => {
      const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
      const barTheme = {
        ...theme,
        fg: (color: string, text: string) =>
          color === 'error' ? `[error]${text}[/error]` : text,
        inverse: (text: string) => text.replaceAll(' ', '#'),
      } as Theme;
      const analytics = {
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-01'),
        lastResetDate: new Date('2026-09-01'),
        groupBy: 'day' as const,
        breakdown: {
          workspaceUser: [
            {
              date: new Date('2026-09-01'),
              models: [
                {
                  model: 'gpt-5.4',
                  credits: 80,
                  uncached_text_input_tokens: 0,
                  cached_text_input_tokens: 0,
                  text_output_tokens: 0,
                },
              ],
            },
          ],
        },
      };
      const errorLengths = (['linear', 'sqrt', 'log'] as const).map((scale) => {
        const tab = new AccountTab(
          { requestRender() {} },
          barTheme,
          createOptions({
            data: {
              ...initialData,
              monthlyLimit: 1_500,
              resetAt,
            },
          })
        );
        tab.setAnalytics(analytics);
        tab.handleInput('c');
        tab.handleInput('c');
        tab.handleInput('c');
        for (
          let index = 0;
          index < ['linear', 'sqrt', 'log'].indexOf(scale);
          index++
        ) {
          tab.handleInput('l');
        }

        const row = tab.renderChart(100, 3)[1] ?? '';
        return row.match(/\[error\](.*?)\[\/error\]/)?.[1].length ?? 0;
      });

      expect(errorLengths).toEqual([31, 17, 6]);
    });

    it('keeps fractional chart maxima within the plot width', () => {
      const tab = createTab();
      tab.setAnalytics({
        startDate: new Date('2026-09-01'),
        endDate: new Date('2026-09-01'),
        lastResetDate: undefined,
        groupBy: 'day',
        breakdown: {
          workspaceUser: [
            {
              date: new Date('2026-09-01'),
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
          startDate: new Date('2026-09-01'),
          endDate: new Date('2026-09-03'),
          lastResetDate: undefined,
          groupBy: 'day',
          breakdown: {
            workspaceUser: [
              {
                date: new Date('2026-09-01'),
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
                date: new Date('2026-09-02'),
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
                date: new Date('2026-09-03'),
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
});
