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
  getPeriodBudgetPerDay,
  sumModelCredits,
  type WorkspaceUserModelUsage,
  type WorkspaceUserTokenUsage,
} from './analytics.ts';
import type { DayPolicy } from './config.ts';
import {
  formatCredits,
  formatPeriodBudget,
  formatRemainingTime,
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
} from './usage-chart.ts';
import { cycle, cycleOption } from './util.ts';
import type { Viewport } from './viewport.ts';

type DateOrder = 'newest' | 'oldest' | 'usage';
type Period = 'current' | 'days365';
type View = 'usage' | 'models';
type CumulativeColumn = 'variance' | 'budget' | 'usage';
type CumulativeMode = 'all' | 'delta' | 'deltaUsage' | 'off';

const CHART_VALUE_WIDTH = visibleWidth('999.99k');
const CHART_VARIANCE_LABEL = 'Σ Δ';
const CHART_VARIANCE_WIDTH = visibleWidth('−999.99k');
const CHART_BUDGET_LABEL = 'Σ budget';
const CHART_BUDGET_WIDTH = visibleWidth(CHART_BUDGET_LABEL);
const CHART_USAGE_LABEL = 'Σ usage';
const CHART_USAGE_WIDTH = visibleWidth(CHART_USAGE_LABEL);
const CUMULATIVE_MODE_OPTIONS: Array<{
  id: CumulativeMode;
  label: string;
}> = [
  { id: 'off', label: 'off' },
  { id: 'delta', label: 'Δ' },
  { id: 'deltaUsage', label: 'Δ+usage' },
  { id: 'all', label: 'all' },
];
const CUMULATIVE_MODE_COLUMNS: Record<
  CumulativeMode,
  readonly CumulativeColumn[]
> = {
  all: ['variance', 'usage', 'budget'],
  delta: ['variance'],
  deltaUsage: ['variance', 'usage'],
  off: [],
};
const CUMULATIVE_COLUMN_LABELS: Record<CumulativeColumn, string> = {
  variance: CHART_VARIANCE_LABEL,
  budget: CHART_BUDGET_LABEL,
  usage: CHART_USAGE_LABEL,
};
const CUMULATIVE_COLUMN_WIDTHS: Record<CumulativeColumn, number> = {
  variance: CHART_VARIANCE_WIDTH,
  budget: CHART_BUDGET_WIDTH,
  usage: CHART_USAGE_WIDTH,
};
function cumulativeColumnsWidth(columns: readonly CumulativeColumn[]): number {
  return columns.reduce(
    (total, column) => total + CUMULATIVE_COLUMN_WIDTHS[column],
    0
  );
}
const MIN_CUMULATIVE_VARIANCE_BAR_WIDTH = 20;
const CUMULATIVE_MODE_WIDTH = maxLength(
  CUMULATIVE_MODE_OPTIONS.map((mode) => mode.label)
);
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

interface CumulativeValues {
  variance: number | null;
  budget: number;
  usage: number;
}

const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'current', label: 'current' },
  { id: 'days365', label: '365d' },
];
const PERIOD_LENGTHS: Record<Exclude<Period, 'current'>, number> = {
  days365: 365,
};

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

function daysAfter(date: string, days: number): string {
  return daysBefore(date, -days);
}

function startOfWeek(date: string): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() - result.getUTCDay());
  return result.toISOString().slice(0, 10);
}

function aggregateWeeklyRows(
  rows: WorkspaceUserTokenUsage[]
): WorkspaceUserTokenUsage[] {
  const weeks = new Map<string, Map<string, WorkspaceUserModelUsage>>();
  for (const row of rows) {
    const week = startOfWeek(row.date);
    const models = weeks.get(week) ?? new Map();
    for (const model of row.models) {
      const total = models.get(model.model);
      if (total) {
        total.credits += model.credits;
        total.uncached_text_input_tokens += model.uncached_text_input_tokens;
        total.cached_text_input_tokens += model.cached_text_input_tokens;
        total.text_output_tokens += model.text_output_tokens;
      } else {
        models.set(model.model, { ...model });
      }
    }
    weeks.set(week, models);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, models]) => ({
      date,
      models: [...models.values()],
    }));
}

function firstDayOfMonth(date: string): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(1);
  return result.toISOString().slice(0, 10);
}

function firstDayOfNextMonth(date: string): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  return result.toISOString().slice(0, 10);
}

/**
 * Owns account-tab state, analytics state, summaries, controls, and chart
 * rendering. The supplied data is copied so UI updates never mutate the
 * command's options object.
 */
export class AccountTab {
  private groupBy: GroupBy = 'day';
  private period: Period = 'current';
  private scale: Scale = 'linear';
  private view: View = 'usage';
  private cumulativeMode: CumulativeMode = 'delta';
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
    } else if (matchesKey(data, 'c')) {
      this.cumulativeMode = cycleOption(
        CUMULATIVE_MODE_OPTIONS,
        this.cumulativeMode
      );
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
          'cols',
          'c',
          CUMULATIVE_MODE_OPTIONS.find(
            (mode) => mode.id === this.cumulativeMode
          )?.label ?? '',
          CUMULATIVE_MODE_WIDTH
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
    if (this.view === 'usage' && this.data.resetAt !== undefined) {
      return [
        `${this.theme.fg('accent', '█ on track')}  ${this.theme.fg('error', '█ over budget')}`,
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

  private getChartAnalytics(): AnalyticsResult | undefined {
    return (
      this.analyticsByGroup[this.groupBy].data ??
      (this.groupBy === 'week' ? this.analyticsByGroup.day.data : undefined)
    );
  }

  private getPeriodStart(analytics: AnalyticsResult): string {
    if (this.period === 'current') return this.periodStartDate(analytics);
    return daysBefore(analytics.endDate, PERIOD_LENGTHS[this.period] - 1);
  }

  private getChart(): ChartItem[] {
    const analytics = this.getChartAnalytics();
    if (!analytics) return [];
    const dailyAnalytics = this.analyticsByGroup.day.data;
    const dailyRows =
      this.groupBy === 'week' &&
      dailyAnalytics !== undefined &&
      dailyAnalytics.startDate <= analytics.startDate &&
      dailyAnalytics.endDate >= analytics.endDate
        ? dailyAnalytics.breakdown.workspaceUser.filter(
            (row) =>
              row.date >= analytics.startDate && row.date <= analytics.endDate
          )
        : undefined;
    const accountingRows = dailyRows ?? analytics.breakdown.workspaceUser;
    const rows = dailyRows
      ? aggregateWeeklyRows(dailyRows)
      : analytics.breakdown.workspaceUser;
    const periodStart = this.getPeriodStart(analytics);
    const currentPeriodStart = this.periodStartDate(analytics);
    const cumulativeValues =
      this.groupBy === 'week' && dailyRows === undefined
        ? new Map<string, CumulativeValues>()
        : this.computeCumulativeValues(
            accountingRows,
            rows,
            currentPeriodStart,
            analytics.startDate,
            analytics.endDate
          );

    const visibleRows = rows.filter((row) => row.date >= periodStart);
    if (this.view === 'usage') {
      return visibleRows.map((row) => {
        const cumulative = cumulativeValues.get(row.date);
        return {
          label: formatChartDate(row.date),
          value: sumModelCredits(row.models),
          cumulativeVariance: cumulative?.variance,
          cumulativeBudget: cumulative?.budget,
          cumulativeUsage: cumulative?.usage,
        };
      });
    }
    const topModels = computeTopModels(visibleRows, MODEL_COLORS.length);
    return visibleRows.map((row) => {
      const cumulative = cumulativeValues.get(row.date);
      return {
        label: formatChartDate(row.date),
        value: sumModelCredits(row.models),
        cumulativeVariance: cumulative?.variance,
        cumulativeBudget: cumulative?.budget,
        cumulativeUsage: cumulative?.usage,
        models: buildModelSegments(row, topModels),
      };
    });
  }

  private computeCumulativeValues(
    accountingRows: WorkspaceUserTokenUsage[],
    chartRows: WorkspaceUserTokenUsage[],
    currentPeriodStart: string,
    rangeStart: string,
    rangeEnd: string
  ): Map<string, CumulativeValues> {
    if (this.data.resetAt === undefined) return new Map();
    if (this.groupBy === 'week') {
      return this.computeWeeklyValues(
        accountingRows,
        chartRows,
        currentPeriodStart,
        rangeStart,
        rangeEnd
      );
    }

    const currentPeriodEnd = new Date(this.data.resetAt * 1000)
      .toISOString()
      .slice(0, 10);
    const firstPeriodStart = firstDayOfMonth(rangeStart);
    const chartPoints = chartRows.map((row) => {
      const bucketEnd = daysAfter(row.date, 1);
      return {
        row,
        end: bucketEnd < currentPeriodEnd ? bucketEnd : currentPeriodEnd,
      };
    });
    const values = new Map<string, CumulativeValues>();
    let periodStart = firstPeriodStart;

    while (periodStart < currentPeriodEnd) {
      const periodEnd =
        periodStart < currentPeriodStart
          ? firstDayOfNextMonth(periodStart)
          : currentPeriodEnd;
      const periodIsIncomplete =
        periodStart === firstPeriodStart && rangeStart > periodStart;
      const resetAt = Date.parse(`${periodEnd}T00:00:00Z`) / 1000;
      const budgetPerDay = getPeriodBudgetPerDay(
        this.data.monthlyLimit,
        periodStart,
        periodEnd,
        this.data.dayPolicy
      );

      if (budgetPerDay !== undefined) {
        const periodDays = daysUntilResetForPolicy(
          periodStart,
          resetAt,
          this.data.dayPolicy
        );
        const periodPoints = chartPoints
          .filter(({ end }) => end > periodStart && end <= periodEnd)
          .sort((a, b) => a.end.localeCompare(b.end));
        for (const { row, end } of periodPoints) {
          const cumulativeUsage = accountingRows
            .filter(
              (accountingRow) =>
                accountingRow.date >= periodStart && accountingRow.date < end
            )
            .reduce(
              (total, accountingRow) =>
                total + sumModelCredits(accountingRow.models),
              0
            );
          const elapsedBudgetDays =
            periodDays -
            daysUntilResetForPolicy(end, resetAt, this.data.dayPolicy);
          const cumulativeBudget = budgetPerDay * elapsedBudgetDays;
          values.set(row.date, {
            variance: periodIsIncomplete
              ? null
              : cumulativeUsage - cumulativeBudget,
            budget: cumulativeBudget,
            usage: cumulativeUsage,
          });
        }
      }

      if (periodEnd <= periodStart) break;
      periodStart = periodEnd;
    }

    return values;
  }

  private computeWeeklyValues(
    accountingRows: WorkspaceUserTokenUsage[],
    chartRows: WorkspaceUserTokenUsage[],
    currentPeriodStart: string,
    rangeStart: string,
    rangeEnd: string
  ): Map<string, CumulativeValues> {
    const currentPeriodEnd = new Date(this.data.resetAt! * 1000)
      .toISOString()
      .slice(0, 10);
    const firstPeriodStart = firstDayOfMonth(rangeStart);
    const availableEnd = daysAfter(rangeEnd, 1);
    const values = new Map<string, CumulativeValues>();

    for (const row of chartRows) {
      const start = row.date < rangeStart ? rangeStart : row.date;
      let end = daysAfter(row.date, 7);
      if (end > availableEnd) end = availableEnd;
      if (end > currentPeriodEnd) end = currentPeriodEnd;
      if (end <= start) continue;

      let segmentStart = start;
      let budget = 0;
      let usage = 0;
      let incomplete = false;
      let valid = true;
      while (segmentStart < end) {
        const periodStart = firstDayOfMonth(segmentStart);
        const periodEnd =
          periodStart < currentPeriodStart
            ? firstDayOfNextMonth(periodStart)
            : currentPeriodEnd;
        const segmentEnd = end < periodEnd ? end : periodEnd;
        if (segmentEnd <= segmentStart) {
          valid = false;
          break;
        }
        const periodValues = this.getPeriodCumulativeValues(
          accountingRows,
          periodStart,
          segmentEnd,
          currentPeriodStart,
          currentPeriodEnd
        );
        if (periodValues === undefined) {
          valid = false;
          break;
        }
        budget += periodValues.budget;
        usage += periodValues.usage;
        incomplete ||=
          rangeStart > firstPeriodStart && periodStart === firstPeriodStart;
        segmentStart = segmentEnd;
      }
      if (!valid) continue;

      values.set(row.date, {
        variance: incomplete ? null : usage - budget,
        budget,
        usage,
      });
    }

    return values;
  }

  private getPeriodCumulativeValues(
    accountingRows: WorkspaceUserTokenUsage[],
    periodStart: string,
    end: string,
    currentPeriodStart: string,
    currentPeriodEnd: string
  ): { budget: number; usage: number } | undefined {
    let budget = 0;
    for (let date = periodStart; date < end; date = daysAfter(date, 1)) {
      const dailyBudget = this.getDailyBudgetForDate(
        date,
        currentPeriodStart,
        currentPeriodEnd
      );
      if (dailyBudget === undefined) return undefined;
      budget += dailyBudget;
    }
    const usage = accountingRows
      .filter(
        (accountingRow) =>
          accountingRow.date >= periodStart && accountingRow.date < end
      )
      .reduce(
        (total, accountingRow) => total + sumModelCredits(accountingRow.models),
        0
      );
    return { budget, usage };
  }

  private getDailyBudgetForDate(
    date: string,
    currentPeriodStart: string,
    currentPeriodEnd: string
  ): number | undefined {
    const periodStart = firstDayOfMonth(date);
    const periodEnd =
      periodStart < currentPeriodStart
        ? firstDayOfNextMonth(periodStart)
        : currentPeriodEnd;
    if (date >= periodEnd) return undefined;
    const resetAt = Date.parse(`${periodEnd}T00:00:00Z`) / 1000;
    const budgetPerDay = getPeriodBudgetPerDay(
      this.data.monthlyLimit,
      periodStart,
      periodEnd,
      this.data.dayPolicy
    );
    if (budgetPerDay === undefined) return undefined;
    const budgetDays =
      daysUntilResetForPolicy(date, resetAt, this.data.dayPolicy) -
      daysUntilResetForPolicy(daysAfter(date, 1), resetAt, this.data.dayPolicy);
    return budgetPerDay * budgetDays;
  }

  private getModelLegendLines(
    items: ChartItem[],
    colorMap: Map<string, readonly [number, number, number]>,
    width: number
  ): string[] {
    const totals = new Map<string, number>();
    for (const item of items) {
      for (const model of item.models ?? []) {
        totals.set(model.label, (totals.get(model.label) ?? 0) + model.value);
      }
    }

    const labels = [...totals.entries()]
      .filter(([, total]) => total > 0)
      .map(([model]) => model)
      .sort((a, b) => a.localeCompare(b))
      .map((model) => {
        const total = totals.get(model)!;
        const label = colorToken(colorMap.get(model)!, `█ ${model}`);
        return (
          label + this.theme.fg('muted', ` ${formatCredits(Math.round(total))}`)
        );
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
    const hasCumulativeVariance = items.some(
      (item) => item.cumulativeVariance !== undefined
    );
    const requestedColumns = CUMULATIVE_MODE_COLUMNS[this.cumulativeMode];
    const requestedColumnsWidth = cumulativeColumnsWidth(requestedColumns);
    const requestedColumnSpacing =
      requestedColumns.length > 0 ? requestedColumns.length + 5 : 5;
    const varianceBarWidth =
      width -
      labelWidth -
      CHART_VALUE_WIDTH -
      requestedColumnsWidth -
      requestedColumnSpacing;
    const showCumulativeVariance =
      hasCumulativeVariance &&
      requestedColumns.length > 0 &&
      varianceBarWidth >= MIN_CUMULATIVE_VARIANCE_BAR_WIDTH;
    const cumulativeColumns = showCumulativeVariance ? requestedColumns : [];
    const cumulativeWidth = cumulativeColumnsWidth(cumulativeColumns);
    const barWidth = Math.max(
      1,
      width -
        labelWidth -
        CHART_VALUE_WIDTH -
        cumulativeWidth -
        (cumulativeColumns.length > 0 ? cumulativeColumns.length + 5 : 5)
    );
    const header = this.renderChartHeader(
      labelWidth,
      barWidth,
      cumulativeColumns
    );
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
    // Keep the geometry scale at the actual usage maximum. Budget values are
    // displayed separately and must not compress the usage bars.
    const maxValue = Math.max(chartMaxValue, 1);

    const rows = [header];
    rows.push(
      ...visibleItems.map((item) => {
        const label = item.label.padEnd(labelWidth);
        const barValue = this.getChartValue(item);
        const barLength = Math.max(
          barValue > 0 ? 1 : 0,
          calculateBarLength(barValue, maxValue, barWidth, this.scale)
        );
        const positiveCumulativeVariance = Math.max(
          0,
          item.cumulativeVariance ?? 0
        );
        const overBudgetLength =
          positiveCumulativeVariance > 0 && barLength > 0
            ? Math.min(
                barLength,
                Math.max(
                  1,
                  calculateBarLength(
                    positiveCumulativeVariance,
                    maxValue,
                    barWidth,
                    this.scale
                  )
                )
              )
            : 0;
        const bar = this.renderBarArea(
          item,
          barLength,
          overBudgetLength,
          positiveCumulativeVariance,
          modelColorMap
        );
        const valueLabel = this.formatChartValue(item);

        // Keep the selected value before the fixed-width plot region so the
        // chart remains easy to scan.
        const plotTail = ' '.repeat(barWidth - barLength);

        const valueColumn = valueLabel.padStart(CHART_VALUE_WIDTH);
        const formatCumulativeColumn = (value: string, columnWidth: number) =>
          ` ${' '.repeat(
            Math.max(0, columnWidth - visibleWidth(value))
          )}${value}`;
        const cumulativeColumnsText = cumulativeColumns
          .map((column) => {
            const value =
              column === 'variance'
                ? this.formatCumulativeVariance(item.cumulativeVariance)
                : column === 'budget'
                  ? this.formatCumulativeBudget(item.cumulativeBudget)
                  : this.formatCumulativeUsage(item.cumulativeUsage);
            return formatCumulativeColumn(
              value,
              CUMULATIVE_COLUMN_WIDTHS[column]
            );
          })
          .join('');
        return `${label} ${valueColumn} ${barLength > 0 ? bar : ''}${plotTail}${cumulativeColumnsText}`;
      })
    );

    if (chartRows > 1) {
      rows.push(
        this.renderXAxis(
          maxValue,
          barWidth,
          labelWidth,
          CHART_VALUE_WIDTH,
          chartMaxValue,
          cumulativeColumns
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
    chartMaxValue: number,
    cumulativeColumns: readonly CumulativeColumn[]
  ): string {
    // Axis ticks come from observed usage only. Budget targets are not
    // observed usage and should not become axis labels. With no usage, 0 is
    // the only meaningful tick.
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
    const cumulativePadding =
      cumulativeColumns.length > 0
        ? ' '.repeat(
            cumulativeColumnsWidth(cumulativeColumns) + cumulativeColumns.length
          )
        : '';
    return `${' '.repeat(labelWidth + valueWidth + 2)}${this.theme.fg(
      'dim',
      axis.join('')
    )}${cumulativePadding}`;
  }

  private renderChartHeader(
    labelWidth: number,
    barWidth: number,
    cumulativeColumns: readonly CumulativeColumn[]
  ): string {
    const prefix = `${this.groupBy.padEnd(labelWidth)} credits`;
    return this.theme.fg(
      'dim',
      cumulativeColumns.length > 0
        ? `${prefix}${' '.repeat(barWidth + 2)}${cumulativeColumns
            .map((column) =>
              column === 'variance'
                ? CUMULATIVE_COLUMN_LABELS[column].padStart(
                    CUMULATIVE_COLUMN_WIDTHS[column]
                  )
                : CUMULATIVE_COLUMN_LABELS[column]
            )
            .join(' ')}`
        : prefix
    );
  }

  private getChartValue(item: ChartItem): number {
    return item.value;
  }

  private formatChartValue(item: ChartItem): string {
    return formatCredits(Math.round(this.getChartValue(item)));
  }

  private formatCumulativeVariance(value: number | null | undefined): string {
    if (value === undefined) return '';
    if (value === null) return this.theme.fg('muted', 'N/A');
    const rounded = Math.round(value);
    const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
    const color = rounded > 0 ? 'error' : rounded < 0 ? 'success' : 'muted';
    return this.theme.fg(color, `${sign}${formatCredits(Math.abs(rounded))}`);
  }

  private formatCumulativeBudget(value: number | undefined): string {
    if (value === undefined) return '';
    return this.theme.fg('muted', formatCredits(Math.round(value)));
  }

  private formatCumulativeUsage(value: number | undefined): string {
    if (value === undefined) return '';
    return this.theme.fg('muted', formatCredits(Math.round(value)));
  }

  private formatChartAxisValue(value: number): string {
    return formatCredits(value);
  }

  private renderBarArea(
    item: ChartItem,
    barLength: number,
    overBudgetLength: number,
    overBudgetAmount: number,
    modelColorMap: Map<string, readonly [number, number, number]>
  ): string {
    if (item.models)
      return this.renderModelBar(item.models, barLength, modelColorMap);
    return this.renderUsageBar(barLength, overBudgetLength, overBudgetAmount);
  }

  private renderUsageBar(
    barLength: number,
    overBudgetLength: number,
    overBudgetAmount: number
  ): string {
    const fill = (color: ThemeColor, content: string) =>
      this.theme.fg(color, this.theme.inverse(content));

    if (overBudgetLength > 0) {
      const split = barLength - overBudgetLength;
      const label = `+${formatCredits(Math.round(overBudgetAmount))}`;
      const labelFits = label.length > 0 && label.length < overBudgetLength;
      const errorPart = labelFits
        ? fill('error', ' '.repeat(overBudgetLength - label.length) + label)
        : fill('error', ' '.repeat(overBudgetLength));
      return fill('accent', ' '.repeat(split)) + errorPart;
    }

    // Under budget: accent bar only; the cumulative variance is rendered
    // alongside the plot.
    return fill('accent', ' '.repeat(barLength));
  }

  private renderModelBar(
    models: NonNullable<ChartItem['models']>,
    barLength: number,
    colorMap: Map<string, readonly [number, number, number]>
  ): string {
    return renderSegmentBar(
      models.map((model) => ({
        color: colorMap.get(model.label)!,
        value: model.value,
      })),
      barLength
    );
  }
}
