import type { Theme, ThemeColor } from '@earendil-works/pi-coding-agent';
import {
  compositeTuiLine,
  matchesKey,
  visibleWidth,
} from '@earendil-works/pi-tui';
import {
  type AnalyticsResult,
  daysUntilResetForPolicy,
  type GroupBy,
  getLastResetDate,
  sumModelCredits,
  type WorkspaceUserModelUsage,
} from './analytics.ts';
import type { DayPolicy } from './config.ts';
import {
  formatCredits,
  formatPeriodBudget,
  formatRemainingTime,
  formatTokenCount,
} from './format.ts';
import { controlLabel, maxLength, wrapLegend } from './legend.ts';
import { Spinner } from './spinner.ts';
import { paceColor } from './status.ts';
import {
  buildModelColorMap,
  buildModelSegments,
  type ChartItem,
  calculateBarLength,
  calculateXAxisTicks,
  colorToken,
  computeTopModels,
  MODEL_COLORS,
  renderSegmentBar,
  type Scale,
  sumModelTokensForModel,
} from './usage-chart.ts';
import { cycle, cycleOption } from './util.ts';
import type { Viewport } from './viewport.ts';

type DateOrder = 'newest' | 'oldest' | 'usage';
type Period = 'week' | 'days30' | 'reset';
type View = 'usage' | 'models';
type TokenDisplay = 'off' | 'counts';

const TOKEN_DISPLAYS: TokenDisplay[] = ['off', 'counts'];
const CHART_UNIT_LABELS: Record<TokenDisplay, string> = {
  off: 'credits',
  counts: 'tokens',
};
const CHART_VALUE_WIDTH = visibleWidth('999.99k');
const CHART_UNIT_WIDTH = maxLength(Object.values(CHART_UNIT_LABELS));
const VIEWS: View[] = ['usage', 'models'];

export interface AccountTabData {
  monthlyUsed: number;
  monthlyLimit: number;
  monthlyRemaining: number;
  monthlyPercent: number;
  monthlyRemainingPercent: number;
  avgDailyUsed: number | undefined;
  dailyBudget: number | undefined;
  resetAt: number | undefined;
  resetLabel: string;
  minutesLeft: number | undefined;
  projectedOverage: number | undefined;
  minutesUntilOut: number | undefined;
  dayPolicy: DayPolicy;
}

export type AccountTabSummary = Pick<
  AccountTabData,
  | 'avgDailyUsed'
  | 'dailyBudget'
  | 'minutesLeft'
  | 'projectedOverage'
  | 'minutesUntilOut'
>;

export type AccountTabMonthlyUsage = Pick<
  AccountTabData,
  | 'monthlyUsed'
  | 'monthlyLimit'
  | 'monthlyRemaining'
  | 'monthlyPercent'
  | 'monthlyRemainingPercent'
  | 'resetAt'
  | 'resetLabel'
>;

export interface AccountTabOptions {
  data: AccountTabData;
  onDayPolicyChange(policy: DayPolicy): void;
  onAnalyticsNeeded?(groupBy: GroupBy): void;
}

interface RenderRequester {
  requestRender(): void;
}

interface GroupAnalyticsState {
  data?: AnalyticsResult;
  loading: boolean;
  error: boolean;
}

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'week', label: 'week' },
  { id: 'days30', label: '30d' },
  { id: 'reset', label: 'current' },
];

const GROUPS: Array<{ id: GroupBy; label: string }> = [
  { id: 'day', label: 'daily' },
  { id: 'week', label: 'weekly' },
];

const SORT_ORDERS: Array<{ id: DateOrder; label: string }> = [
  { id: 'newest', label: 'newest' },
  { id: 'oldest', label: 'oldest' },
  { id: 'usage', label: 'usage' },
];

const SCALES: Array<{ id: Scale; label: string }> = [
  { id: 'linear', label: 'linear' },
  { id: 'sqrt', label: 'sqrt' },
  { id: 'log', label: 'log' },
];

const DAY_POLICY_LABELS: Record<DayPolicy, string> = {
  calendar: 'cal',
  weekdays: 'wkdays',
};
const VIEW_WIDTH = maxLength(VIEWS);
const PERIOD_WIDTH = maxLength(PERIODS.map((period) => period.label));
const GROUP_WIDTH = maxLength(GROUPS.map((group) => group.label));
const SORT_WIDTH = maxLength(SORT_ORDERS.map((order) => order.label));
const SCALE_WIDTH = maxLength(SCALES.map((scale) => scale.label));
const DAY_POLICY_WIDTH = maxLength(Object.values(DAY_POLICY_LABELS));

function formatChartDate(date: string): string {
  return date.slice(5);
}

function daysBefore(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() - days);
  return result.toISOString().slice(0, 10);
}

function sumRowTokens(models: WorkspaceUserModelUsage[]): number {
  return models.reduce(
    (total, model) => total + sumModelTokensForModel(model),
    0
  );
}

/**
 * Owns account-tab state, analytics state, summaries, controls, and chart
 * rendering. The supplied data is copied so UI updates never mutate the
 * command's options object.
 */
export class AccountTab {
  private groupBy: GroupBy = 'day';
  private period: Period = 'reset';
  private scale: Scale = 'linear';
  private view: View = 'usage';
  private tokenDisplay: TokenDisplay = 'off';
  private dateOrder: DateOrder = 'newest';
  private viewportState: Viewport = {
    scrollOffset: 0,
    maxScrollOffset: 0,
    chartItemCount: 0,
  };
  private data: AccountTabData;
  private analyticsByGroup: Record<GroupBy, GroupAnalyticsState> = {
    day: { loading: true, error: false },
    week: { loading: false, error: false },
  };
  private readonly spinner = new Spinner();
  private disposed = false;

  constructor(
    private readonly tui: RenderRequester,
    private readonly theme: Theme,
    private readonly options: AccountTabOptions
  ) {
    this.data = { ...options.data };
  }

  get selectedGroup(): GroupBy {
    return this.groupBy;
  }

  get viewport(): Viewport {
    return { ...this.viewportState };
  }

  setAnalyticsLoading(groupBy: GroupBy = this.groupBy): void {
    if (this.disposed) return;
    this.updateAnalyticsState(groupBy, { loading: true, error: false });
    this.spinner.reset();
    this.updateSpinner();
    this.viewportState = { ...this.viewportState, scrollOffset: 0 };
    this.tui.requestRender();
  }

  setAnalytics(analytics: AnalyticsResult): void {
    if (this.disposed) return;
    this.updateAnalyticsState(analytics.groupBy, {
      data: analytics,
      loading: false,
      error: false,
    });
    this.updateSpinner();
    this.tui.requestRender();
  }

  setAnalyticsError(groupBy: GroupBy = this.groupBy): void {
    if (this.disposed) return;
    this.updateAnalyticsState(groupBy, { loading: false, error: true });
    this.updateSpinner();
    this.tui.requestRender();
  }

  refreshSummary(summary: AccountTabSummary): void {
    this.data = { ...this.data, ...summary };
    this.tui.requestRender();
  }

  refreshUsage(
    monthly: AccountTabMonthlyUsage,
    summary: AccountTabSummary
  ): void {
    this.data = { ...this.data, ...monthly, ...summary };
    this.tui.requestRender();
  }

  resetScroll(): void {
    this.viewportState = { ...this.viewportState, scrollOffset: 0 };
  }

  handleInput(data: string): void {
    if (matchesKey(data, 's')) {
      this.dateOrder = cycleOption(SORT_ORDERS, this.dateOrder);
      this.viewportState = { ...this.viewportState, scrollOffset: 0 };
    } else if (matchesKey(data, 'up') || matchesKey(data, 'k')) {
      this.viewportState = {
        ...this.viewportState,
        scrollOffset: Math.max(0, this.viewportState.scrollOffset - 1),
      };
    } else if (matchesKey(data, 'down') || matchesKey(data, 'j')) {
      this.viewportState = {
        ...this.viewportState,
        scrollOffset: Math.min(
          this.viewportState.maxScrollOffset,
          this.viewportState.scrollOffset + 1
        ),
      };
    } else if (matchesKey(data, 'g')) {
      this.groupBy = cycleOption(GROUPS, this.groupBy);
      this.viewportState = { ...this.viewportState, scrollOffset: 0 };
      this.updateSpinner();
      const breakdown = this.analyticsByGroup[this.groupBy].data?.breakdown;
      if (!breakdown) {
        this.options.onAnalyticsNeeded?.(this.groupBy);
      }
    } else if (matchesKey(data, 'v')) {
      this.view = cycle(VIEWS, this.view);
    } else if (matchesKey(data, 'u')) {
      this.tokenDisplay = cycle(TOKEN_DISPLAYS, this.tokenDisplay);
    } else if (matchesKey(data, 'l')) {
      this.scale = cycleOption(SCALES, this.scale);
    } else if (matchesKey(data, 'd')) {
      const nextPolicy =
        this.data.dayPolicy === 'weekdays' ? 'calendar' : 'weekdays';
      this.data = { ...this.data, dayPolicy: nextPolicy };
      this.options.onDayPolicyChange(nextPolicy);
    } else if (matchesKey(data, 'p')) {
      this.period = cycleOption(PERIODS, this.period);
      this.viewportState = { ...this.viewportState, scrollOffset: 0 };
      this.options.onAnalyticsNeeded?.(this.groupBy);
    }
  }

  renderSummaryLines(): string[] {
    return [
      this.renderMonthlyLine(),
      this.renderPeriodLine(),
      this.renderProjectedLine(),
    ];
  }

  renderControlLines(width: number): string[] {
    const control = (
      type: string,
      shortcut: string,
      state: string,
      stateWidth: number
    ) => controlLabel(this.theme, type, shortcut, state, stateWidth);
    return wrapLegend(
      [
        control('view', 'v', this.view, VIEW_WIDTH),
        control(
          'unit',
          'u',
          CHART_UNIT_LABELS[this.tokenDisplay],
          CHART_UNIT_WIDTH
        ),
        control(
          'days',
          'd',
          DAY_POLICY_LABELS[this.data.dayPolicy],
          DAY_POLICY_WIDTH
        ),
        control(
          'period',
          'p',
          PERIODS.find((period) => period.id === this.period)?.label ?? '',
          PERIOD_WIDTH
        ),
        control(
          'group',
          'g',
          GROUPS.find((group) => group.id === this.groupBy)?.label ?? '',
          GROUP_WIDTH
        ),
        control(
          'sort',
          's',
          SORT_ORDERS.find((order) => order.id === this.dateOrder)?.label ?? '',
          SORT_WIDTH
        ),
        control(
          'scale',
          'l',
          SCALES.find((scale) => scale.id === this.scale)?.label ?? '',
          SCALE_WIDTH
        ),
      ],
      width
    );
  }

  renderLegendLines(width: number): string[] {
    const chart = this.getChart();
    if (this.view === 'models') {
      return this.getModelLegendLines(chart, buildModelColorMap(chart), width);
    }
    if (
      this.view === 'usage' &&
      this.tokenDisplay === 'off' &&
      this.data.resetAt !== undefined
    ) {
      return [
        `${this.theme.fg('accent', '█ on track')}  ${this.theme.fg('error', '█ over budget')}  ${this.theme.fg('dim', '▏ daily budget')}`,
      ];
    }
    return [''];
  }

  renderChart(width: number, chartRows: number): string[] {
    const chart = this.getChart();
    return this.renderChartRows(
      chart,
      width,
      buildModelColorMap(chart),
      chartRows
    );
  }

  invalidate(): void {}

  dispose(): void {
    this.disposed = true;
    this.spinner.stop();
  }

  private updateAnalyticsState(
    groupBy: GroupBy,
    update: Partial<GroupAnalyticsState>
  ): void {
    this.analyticsByGroup = {
      ...this.analyticsByGroup,
      [groupBy]: {
        ...this.analyticsByGroup[groupBy],
        ...update,
      },
    };
  }

  private updateSpinner(): void {
    if (this.analyticsByGroup[this.groupBy].loading) {
      this.spinner.start(() => this.tui.requestRender());
    } else {
      this.spinner.stop();
    }
  }

  private overlaySpinner(
    rows: string[],
    width: number,
    chartRows: number
  ): string[] {
    if (!this.analyticsByGroup[this.groupBy].loading || rows.length === 0) {
      return rows;
    }
    const dataRows = Math.max(0, chartRows - 2);
    const row = Math.min(
      rows.length - 1,
      dataRows > 0 ? 1 + Math.floor(dataRows / 2) : 0
    );
    const column = Math.floor(width / 2);
    rows[row] = compositeTuiLine(
      rows[row] ?? '',
      this.spinner.current,
      column,
      1,
      width
    );
    return rows;
  }

  private renderMonthlyLine(): string {
    const used = formatCredits(this.data.monthlyUsed);
    const limit = formatCredits(this.data.monthlyLimit);
    return `Monthly:  ${used} / ${limit} (${this.data.monthlyPercent}%) · ${this.data.monthlyRemainingPercent}% left`;
  }

  private renderProjectedLine(): string {
    if (this.data.projectedOverage === undefined) {
      return 'Forecast: —';
    }
    const overage = this.data.projectedOverage;
    const rounded = Math.round(Math.abs(overage));
    const ratio = (this.data.monthlyLimit + overage) / this.data.monthlyLimit;
    const color = overage <= 0 ? 'success' : paceColor(ratio);
    let label: string;
    if (rounded === 0) {
      label = 'on budget';
    } else if (overage > 0) {
      label = `${formatCredits(rounded)} over budget`;
      if (
        this.data.minutesUntilOut !== undefined &&
        this.data.minutesLeft !== undefined
      ) {
        const minutesEarly = this.data.minutesLeft - this.data.minutesUntilOut;
        const formattedEarly = formatRemainingTime(minutesEarly);
        if (formattedEarly !== undefined) {
          label += `  (runs out ${formattedEarly} before reset)`;
        }
      }
    } else {
      label = `${formatCredits(rounded)} under budget`;
    }
    return `Forecast: ${this.theme.fg(color, label)}`;
  }

  private renderPeriodLine(): string {
    const remainingTime = formatRemainingTime(this.data.minutesLeft);
    const remaining =
      remainingTime === undefined ? '' : ` · ${remainingTime} left`;
    const budget = formatPeriodBudget(
      this.data.minutesLeft,
      this.data.monthlyRemaining,
      this.data.dailyBudget
    );
    return `Period:   Resets ${this.data.resetLabel}${remaining}${
      budget ? ` · ${budget}` : ''
    }`;
  }

  /**
   * First date belonging to the current billing period. Analytics fetched
   * before the reset time is known carry no `lastResetDate`, and falling back
   * to `startDate` would widen the period to the fetched range and pull in the
   * previous period. The monthly reset is authoritative, so derive from it.
   */
  private periodStartDate(analytics: AnalyticsResult): string {
    if (analytics.lastResetDate !== undefined) return analytics.lastResetDate;
    if (this.data.resetAt !== undefined) {
      return getLastResetDate(this.data.resetAt);
    }
    return analytics.startDate;
  }

  private getPeriodStart(): string {
    const analytics = this.analyticsByGroup[this.groupBy].data;
    if (!analytics) return '';
    if (this.period === 'week') return daysBefore(analytics.endDate, 6);
    if (this.period === 'days30') {
      return daysBefore(analytics.endDate, 29);
    }
    return this.periodStartDate(analytics);
  }

  private getChart(): ChartItem[] {
    const analytics = this.analyticsByGroup[this.groupBy].data;
    if (!analytics) return [];
    const breakdown = analytics.breakdown;
    const periodStart = this.getPeriodStart();
    const budgets = this.computePeriodBudgets();

    const rows = breakdown.workspaceUser.filter(
      (row) => row.date >= periodStart
    );
    if (this.view === 'usage') {
      return rows.map((row) => ({
        label: formatChartDate(row.date),
        value: sumModelCredits(row.models),
        tokenTotal: sumRowTokens(row.models),
        periodBudget: budgets.get(row.date),
      }));
    }
    const topModels = computeTopModels(rows, MODEL_COLORS.length);
    return rows.map((row) => ({
      label: formatChartDate(row.date),
      value: sumModelCredits(row.models),
      tokenTotal: sumRowTokens(row.models),
      periodBudget: budgets.get(row.date),
      models: buildModelSegments(row, topModels),
    }));
  }

  private computePeriodBudgets(): Map<string, number> {
    const analytics = this.analyticsByGroup[this.groupBy].data;
    if (!analytics || !this.data.resetAt) return new Map();

    const periodDays =
      this.groupBy === 'week'
        ? this.data.dayPolicy === 'weekdays'
          ? 5
          : 7
        : 1;
    const breakdown = analytics.breakdown;
    const lastResetDate = this.periodStartDate(analytics);

    // Only rows in the current billing period
    const periodRows = [...breakdown.workspaceUser]
      .filter((row) => row.date >= lastResetDate)
      .sort((a, b) => a.date.localeCompare(b.date));

    const map = new Map<string, number>();
    let cumulativeBefore = 0;

    for (const row of periodRows) {
      const daysToReset = daysUntilResetForPolicy(
        row.date,
        this.data.resetAt,
        this.data.dayPolicy
      );
      const remaining = this.data.monthlyLimit - cumulativeBefore;
      if (
        row.date === analytics.endDate &&
        this.data.dailyBudget !== undefined
      ) {
        // The row for today uses the summary budget so the marker follows
        // the selected calendar/weekdays policy and current remaining
        // credits instead of the historical full-period budget.
        map.set(row.date, this.data.dailyBudget * periodDays);
      } else if (daysToReset > 0) {
        map.set(row.date, Math.max(0, remaining / daysToReset) * periodDays);
      }
      cumulativeBefore += sumModelCredits(row.models);
    }

    return map;
  }

  private getModelLegendLines(
    items: ChartItem[],
    colorMap: Map<string, readonly [number, number, number]>,
    width: number
  ): string[] {
    const totals = new Map<string, { credits: number; tokens: number }>();
    for (const item of items) {
      for (const model of item.models ?? []) {
        const total = totals.get(model.label) ?? { credits: 0, tokens: 0 };
        total.credits += model.value;
        total.tokens += model.tokenTotal ?? 0;
        totals.set(model.label, total);
      }
    }

    const labels = [...totals.entries()]
      .filter(([, total]) => total.credits > 0)
      .map(([model]) => model)
      .sort((a, b) => a.localeCompare(b))
      .map((model) => {
        const total = totals.get(model)!;
        const unitInfo =
          this.tokenDisplay === 'off'
            ? ` ${formatCredits(Math.round(total.credits))}`
            : total.tokens > 0
              ? ` ${formatTokenCount(Math.round(total.tokens))}`
              : '';
        const label = colorToken(colorMap.get(model)!, `█ ${model}`);
        return label + this.theme.fg('muted', unitInfo);
      });
    return wrapLegend(labels, width);
  }

  private renderChartRows(
    items: ChartItem[],
    width: number,
    modelColorMap: Map<string, readonly [number, number, number]>,
    chartRows: number
  ): string[] {
    this.viewportState = {
      ...this.viewportState,
      chartItemCount: items.length,
    };
    const labelWidth = Math.min(
      16,
      Math.max(5, ...items.map((item) => item.label.length))
    );
    const header = this.renderChartHeader(labelWidth);
    if (items.length === 0) {
      this.viewportState = { ...this.viewportState, maxScrollOffset: 0 };
      const rows = Array.from({ length: chartRows }, () => '');
      if (chartRows > 0) rows[0] = header;
      if (
        chartRows > 1 &&
        !this.analyticsByGroup[this.groupBy].loading &&
        this.analyticsByGroup[this.groupBy].error
      ) {
        rows[1] = this.theme.fg('muted', 'No usage data');
      }
      return this.overlaySpinner(rows, width, chartRows);
    }

    const orderedItems =
      this.dateOrder === 'newest'
        ? [...items].reverse()
        : this.dateOrder === 'usage'
          ? [...items].sort(
              (a, b) => this.getChartValue(b) - this.getChartValue(a)
            )
          : items;
    const barRows = Math.max(0, chartRows - 2);
    this.viewportState = {
      ...this.viewportState,
      maxScrollOffset: Math.max(0, orderedItems.length - barRows),
    };
    this.viewportState = {
      ...this.viewportState,
      scrollOffset: Math.min(
        this.viewportState.scrollOffset,
        this.viewportState.maxScrollOffset
      ),
    };
    const visibleItems = orderedItems.slice(
      this.viewportState.scrollOffset,
      this.viewportState.scrollOffset + barRows
    );
    const chartMaxValue = Math.max(
      ...items.map((item) => this.getChartValue(item)),
      0
    );
    const budgetMaxValue =
      this.tokenDisplay === 'off'
        ? Math.max(...items.map((item) => item.periodBudget ?? 0), 0)
        : 0;
    const maxValue = Math.max(
      Math.round(Math.max(chartMaxValue, budgetMaxValue, 1)),
      1
    );
    const barWidth = Math.max(1, width - labelWidth - CHART_VALUE_WIDTH - 5);

    const rows = [header];
    rows.push(
      ...visibleItems.map((item) => {
        const label = item.label.padEnd(labelWidth);
        const barValue = this.getChartValue(item);
        const barLength = Math.max(
          barValue > 0 ? 1 : 0,
          calculateBarLength(barValue, maxValue, barWidth, this.scale)
        );
        const markerPos =
          this.tokenDisplay === 'off' && item.periodBudget !== undefined
            ? calculateBarLength(
                item.periodBudget,
                maxValue,
                barWidth,
                this.scale
              )
            : undefined;
        const isOverBudget =
          this.tokenDisplay === 'off' &&
          item.periodBudget !== undefined &&
          item.value > item.periodBudget;
        const bar = this.renderBarArea(
          item,
          barLength,
          markerPos,
          isOverBudget,
          modelColorMap
        );
        const valueLabel = this.formatChartValue(item);

        // The marker is part of the fixed-width plot region. Keeping the
        // selected value before that region makes the chart easy to scan and
        // leaves the full bar width available for the selected unit.
        const trailingPad = barWidth - barLength;
        let plotTail: string;
        if (
          !item.models &&
          markerPos !== undefined &&
          !isOverBudget &&
          markerPos > barLength
        ) {
          const markerOffset = markerPos - barLength - 1;
          plotTail =
            ' '.repeat(markerOffset) +
            this.theme.fg('dim', '▏') +
            ' '.repeat(trailingPad - markerOffset - 1);
        } else {
          plotTail = ' '.repeat(trailingPad);
        }

        const valueColumn = valueLabel.padStart(CHART_VALUE_WIDTH);
        return `${label} ${valueColumn} ${barLength > 0 ? bar : ''}${plotTail}`;
      })
    );

    if (chartRows > 1) {
      rows.push(
        this.renderXAxis(
          maxValue,
          barWidth,
          labelWidth,
          CHART_VALUE_WIDTH,
          chartMaxValue
        )
      );
    }
    while (rows.length < chartRows) {
      rows.push('');
    }

    return this.overlaySpinner(rows, width, chartRows);
  }

  private renderXAxis(
    scaleMaxValue: number,
    barWidth: number,
    labelWidth: number,
    valueWidth: number,
    chartMaxValue: number
  ): string {
    // Budget values may extend the geometric scale in credits mode so their
    // markers remain visible, but they are not observed usage and should not
    // become axis labels. With no usage, 0 is the only meaningful tick.
    const ticks =
      chartMaxValue > 0 ? calculateXAxisTicks(chartMaxValue, this.scale) : [0];
    const axis = Array.from({ length: barWidth }, () => ' ');
    const lastTick = ticks.at(-1);
    let previousEnd = -1;
    for (const value of ticks) {
      const label = this.formatChartAxisValue(value);
      const position = calculateBarLength(
        value,
        scaleMaxValue,
        barWidth,
        this.scale
      );
      const start =
        value === lastTick
          ? Math.min(position, axis.length - label.length)
          : position;
      if (start < previousEnd + 1 || start + label.length > axis.length) {
        continue;
      }
      for (let offset = 0; offset < label.length; offset++) {
        axis[start + offset] = label[offset]!;
      }
      previousEnd = start + label.length;
    }
    return `${' '.repeat(labelWidth + valueWidth + 2)}${this.theme.fg(
      'dim',
      axis.join('')
    )}`;
  }

  private renderChartHeader(labelWidth: number): string {
    return this.theme.fg(
      'dim',
      `${this.groupBy.padEnd(labelWidth)} ${CHART_UNIT_LABELS[this.tokenDisplay]}`
    );
  }

  private getChartValue(item: ChartItem): number {
    return this.tokenDisplay === 'counts' ? (item.tokenTotal ?? 0) : item.value;
  }

  private formatChartValue(item: ChartItem): string {
    const value = this.getChartValue(item);
    return this.tokenDisplay === 'off'
      ? formatCredits(Math.round(value))
      : formatTokenCount(Math.round(value));
  }

  private formatChartAxisValue(value: number): string {
    return this.tokenDisplay === 'off'
      ? formatCredits(value)
      : formatTokenCount(value);
  }

  private renderBarArea(
    item: ChartItem,
    barLength: number,
    markerPos: number | undefined,
    isOverBudget: boolean,
    modelColorMap: Map<string, readonly [number, number, number]>
  ): string {
    if (item.models)
      return this.renderModelBar(
        item.models,
        barLength,
        modelColorMap,
        this.tokenDisplay
      );
    return this.renderUsageBar(
      barLength,
      markerPos,
      item.periodBudget,
      isOverBudget
    );
  }

  private renderUsageBar(
    barLength: number,
    markerPos: number | undefined,
    periodBudget: number | undefined,
    isOverBudget: boolean
  ): string {
    const fill = (color: ThemeColor, content: string) =>
      this.theme.fg(color, this.theme.inverse(content));

    if (isOverBudget && markerPos !== undefined) {
      // Clamp split to ensure at least 1 error cell when rounding collapses the gap
      const split = Math.min(markerPos, barLength - 1);
      const label =
        periodBudget !== undefined
          ? formatCredits(Math.round(periodBudget))
          : '';
      const labelFits = label.length > 0 && label.length < split;
      const accentPart = labelFits
        ? fill('accent', ' '.repeat(split - label.length) + label)
        : fill('accent', ' '.repeat(split));
      return accentPart + fill('error', ' '.repeat(barLength - split));
    }

    // Under budget: accent bar only — marker line is added in renderChartRows.
    return fill('accent', ' '.repeat(barLength));
  }

  private renderModelBar(
    models: NonNullable<ChartItem['models']>,
    barLength: number,
    colorMap: Map<string, readonly [number, number, number]>,
    display: TokenDisplay
  ): string {
    return renderSegmentBar(
      models.map((model) => ({
        color: colorMap.get(model.label)!,
        value: display === 'off' ? model.value : (model.tokenTotal ?? 0),
      })),
      barLength
    );
  }
}
