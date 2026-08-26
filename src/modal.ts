import type { Theme, ThemeColor } from '@earendil-works/pi-coding-agent';
import {
  type Component,
  compositeTuiLine,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from '@earendil-works/pi-tui';
import packageJson from '../package.json' with { type: 'json' };
import {
  type AnalyticsResult,
  type GroupBy,
  sumModelCredits,
  sumModelTokens,
  type WorkspaceUserModelUsage,
} from './analytics.ts';
import type { DayPolicy } from './config.ts';
import { formatTokenCount } from './format.ts';
import { controlLabel, maxLength, padLines, wrapLegend } from './legend.ts';
import { SessionTab, type Viewport } from './session-tab.ts';
import type { SessionCreditUsage } from './session-usage.ts';
import { Spinner } from './spinner.ts';
import { paceColor } from './status.ts';

type DateOrder = 'newest' | 'oldest' | 'usage';
type Period = 'week' | 'days30' | 'reset';
type Scale = 'linear' | 'sqrt' | 'log';
type View = 'usage' | 'models';
type TokenDisplay = 'off' | 'ratio' | 'counts';
type Tab = 'account' | 'session';

const TOKEN_DISPLAYS: TokenDisplay[] = ['off', 'counts', 'ratio'];

const VIEWS: View[] = ['usage', 'models'];

interface ModelChartItem {
  models?: Array<{ label: string; value: number; tokenTotal?: number }>;
}

interface ChartItem extends ModelChartItem {
  label: string;
  value: number;
  periodBudget?: number;
  tokenTotal?: number;
}

interface RenderRequester {
  requestRender(): void;
}

interface UsageModalOptions {
  monthlyUsed: number;
  monthlyLimit: number;
  monthlyPercent: number;
  monthlyRemainingPercent: number;
  avgDailyUsed: number | undefined;
  dailyBudget: number | undefined;
  resetAt: number | undefined;
  resetLabel: string;
  daysLeft: number | undefined;
  projectedOverage: number | undefined;
  daysUntilOut: number | undefined;
  formatCredits(value: number): string;
  sessionCreditUsage?: SessionCreditUsage;
  wholeSessionCreditUsage?: SessionCreditUsage;
  dayPolicy: DayPolicy;
  onDayPolicyChange(policy: DayPolicy): void;
  onAnalyticsNeeded?(groupBy: GroupBy): void;
  onRefresh?(groupBy: GroupBy): void;
  onClose(): void;
}

type UsageSummary = Pick<
  UsageModalOptions,
  | 'avgDailyUsed'
  | 'dailyBudget'
  | 'daysLeft'
  | 'projectedOverage'
  | 'daysUntilOut'
>;

interface GroupAnalyticsState {
  data?: AnalyticsResult;
  loading: boolean;
  error: boolean;
}

type MonthlyUsageFields = Pick<
  UsageModalOptions,
  | 'monthlyUsed'
  | 'monthlyLimit'
  | 'monthlyPercent'
  | 'monthlyRemainingPercent'
  | 'resetAt'
  | 'resetLabel'
>;

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
const TOKEN_DISPLAY_WIDTH = maxLength(TOKEN_DISPLAYS);
const PERIOD_WIDTH = maxLength(PERIODS.map((period) => period.label));
const GROUP_WIDTH = maxLength(GROUPS.map((group) => group.label));
const SORT_WIDTH = maxLength(SORT_ORDERS.map((order) => order.label));
const SCALE_WIDTH = maxLength(SCALES.map((scale) => scale.label));
const DAY_POLICY_WIDTH = maxLength(Object.values(DAY_POLICY_LABELS));

const OTHERS_LABEL = 'others';
const OTHERS_COLOR = [120, 120, 120] as const;

const MODEL_COLORS = [
  [230, 159, 0],
  [86, 180, 233],
  [0, 158, 115],
  [240, 228, 66],
  [0, 114, 178],
  [213, 94, 0],
  [204, 121, 167],
] as const;

function colorToken(
  color: readonly [number, number, number],
  text: string
): string {
  return `\x1b[38;2;${color[0]};${color[1]};${color[2]}m${text}\x1b[39m`;
}

function colorBlock(
  color: readonly [number, number, number],
  length: number
): string {
  if (length === 0) return '';
  return `\x1b[48;2;${color[0]};${color[1]};${color[2]}m${' '.repeat(length)}\x1b[49m`;
}

function renderSegmentedBar(
  segments: Array<{ color: readonly [number, number, number]; value: number }>,
  barLength: number
): string {
  const lengths = calculateSegmentLengths(
    segments.map((s) => s.value),
    barLength
  );
  return segments.map((s, i) => colorBlock(s.color, lengths[i] ?? 0)).join('');
}

function logScaleValue(value: number): number {
  return value <= 0 ? 0 : Math.log10(value) + 1;
}

export function calculateBarLength(
  value: number,
  maxValue: number,
  barWidth: number,
  scale: Scale = 'linear'
): number {
  if (scale === 'log') {
    return Math.round(
      (logScaleValue(value) / logScaleValue(maxValue)) * barWidth
    );
  }
  if (scale === 'sqrt') {
    return Math.round(Math.sqrt(value / maxValue) * barWidth);
  }
  return Math.round((value / maxValue) * barWidth);
}

function getNiceStep(maxValue: number): number {
  const roughStep = maxValue / 5;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const multiplier =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

export function calculateXAxisTicks(maxValue: number, scale: Scale): number[] {
  const roundedMaxValue = Math.max(1, Math.round(maxValue));
  const ticks = [0];
  if (scale === 'linear') {
    let step = 10;
    let multiplier = 5;
    while (roundedMaxValue > step * 10) {
      step *= multiplier;
      multiplier = multiplier === 5 ? 2 : 5;
    }
    for (let value = step; value < roundedMaxValue; value += step) {
      ticks.push(value);
    }
  } else if (scale === 'sqrt') {
    const transformedMax = Math.sqrt(roundedMaxValue);
    const step = getNiceStep(transformedMax);
    let previousValue = 0;
    for (
      let transformedValue = step;
      transformedValue < transformedMax;
      transformedValue += step
    ) {
      const value = Math.round(transformedValue ** 2);
      if (value > previousValue && value < roundedMaxValue) {
        ticks.push(value);
        previousValue = value;
      }
    }
  } else {
    for (let value = 1; value < roundedMaxValue; value *= 10) {
      ticks.push(value);
    }
  }
  if (ticks[ticks.length - 1] !== roundedMaxValue) ticks.push(roundedMaxValue);
  return ticks;
}

export function calculateSegmentLengths(
  values: number[],
  length: number
): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total === 0) return values.map(() => 0);

  const rawLengths = values.map((value) => (length * value) / total);
  const lengths = rawLengths.map(Math.floor);
  const remaining = length - lengths.reduce((sum, value) => sum + value, 0);
  const rankedFractions = rawLengths
    .map((rawLength, index) => ({ index, fraction: rawLength % 1 }))
    .sort((a, b) => b.fraction - a.fraction);

  for (let index = 0; index < remaining; index++) {
    const segment = rankedFractions[index];
    if (segment) lengths[segment.index] = (lengths[segment.index] ?? 0) + 1;
  }

  return lengths;
}

export function calculateSegmentBarLengths(
  values: number[],
  maxValue: number,
  barWidth: number
): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  return calculateSegmentLengths(
    values,
    total === 0 ? 0 : calculateBarLength(total, maxValue, barWidth)
  );
}

export function sortModelSegments(
  models: NonNullable<ModelChartItem['models']>
): NonNullable<ModelChartItem['models']> {
  return [...models].sort((a, b) => {
    if (a.label === OTHERS_LABEL) return 1;
    if (b.label === OTHERS_LABEL) return -1;
    return b.value - a.value || a.label.localeCompare(b.label);
  });
}

function formatChartDate(date: string): string {
  return date.slice(5);
}

function daysBefore(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() - days);
  return result.toISOString().slice(0, 10);
}

function sumModelTokensForModel(model: WorkspaceUserModelUsage): number {
  return (
    sumModelTokens([model], 'uncached_text_input_tokens') +
    sumModelTokens([model], 'cached_text_input_tokens') +
    sumModelTokens([model], 'text_output_tokens')
  );
}

function sumRowTokens(models: WorkspaceUserModelUsage[]): number {
  return models.reduce(
    (total, model) => total + sumModelTokensForModel(model),
    0
  );
}

function buildModelColorMap(
  items: ChartItem[]
): Map<string, readonly [number, number, number]> {
  const models = [
    ...new Set(items.flatMap((item) => item.models?.map((m) => m.label) ?? [])),
  ]
    .filter((m) => m !== OTHERS_LABEL)
    .sort((a, b) => a.localeCompare(b));
  // getChart keeps at most MODEL_COLORS.length named models.
  const map = new Map<string, readonly [number, number, number]>(
    models.map((model, i) => [model, MODEL_COLORS[i]!])
  );
  map.set(OTHERS_LABEL, OTHERS_COLOR);
  return map;
}

const CHART_ROWS = 8;

export class UsageModal implements Component {
  private groupBy: GroupBy = 'day';
  private period: Period = 'reset';
  private scale: Scale = 'linear';
  private view: View = 'usage';
  private tokenDisplay: TokenDisplay = 'off';
  private dateOrder: DateOrder = 'newest';
  private tab: Tab = 'account';
  private readonly viewport: Viewport = {
    scrollOffset: 0,
    maxScrollOffset: 0,
    chartItemCount: 0,
  };
  private readonly sessionTab: SessionTab;
  private readonly analyticsByGroup: Record<GroupBy, GroupAnalyticsState> = {
    day: { loading: true, error: false },
    week: { loading: false, error: false },
  };
  private readonly spinner = new Spinner();
  private readonly abortController = new AbortController();
  private disposed = false;

  constructor(
    private readonly tui: RenderRequester,
    private readonly theme: Theme,
    private readonly options: UsageModalOptions
  ) {
    this.sessionTab = new SessionTab({
      theme,
      formatCredits: options.formatCredits,
      sessionCreditUsage: options.sessionCreditUsage,
      wholeSessionCreditUsage: options.wholeSessionCreditUsage,
    });
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get selectedGroup(): GroupBy {
    return this.groupBy;
  }

  setAnalyticsLoading(groupBy: GroupBy = this.groupBy): void {
    if (this.disposed) return;
    const state = this.analyticsByGroup[groupBy];
    state.loading = true;
    state.error = false;
    this.spinner.reset();
    this.updateSpinner();
    this.viewport.scrollOffset = 0;
    this.tui.requestRender();
  }

  setAnalytics(analytics: AnalyticsResult): void {
    if (this.disposed) return;
    const state = this.analyticsByGroup[analytics.groupBy];
    state.data = analytics;
    state.loading = false;
    state.error = false;
    this.updateSpinner();
    this.tui.requestRender();
  }

  setAnalyticsError(groupBy: GroupBy = this.groupBy): void {
    if (this.disposed) return;
    const state = this.analyticsByGroup[groupBy];
    state.loading = false;
    state.error = true;
    this.updateSpinner();
    this.tui.requestRender();
  }

  refreshSummary(summary: UsageSummary): void {
    Object.assign(this.options, summary);
    this.tui.requestRender();
  }

  refreshUsage(monthly: MonthlyUsageFields, summary: UsageSummary): void {
    Object.assign(this.options, monthly, summary);
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape') || matchesKey(data, 'q')) {
      this.options.onClose();
      return;
    }

    if (matchesKey(data, 'r')) {
      this.options.onRefresh?.(this.groupBy);
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, 'tab')) {
      this.tab = this.tab === 'account' ? 'session' : 'account';
      this.viewport.scrollOffset = 0;
      this.sessionTab.resetScroll();
      this.tui.requestRender();
      return;
    }

    if (this.tab === 'session') {
      this.sessionTab.handleInput(data);
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, 's')) {
      const index = SORT_ORDERS.findIndex(
        (order) => order.id === this.dateOrder
      );
      this.dateOrder = SORT_ORDERS[(index + 1) % SORT_ORDERS.length]!.id;
      this.viewport.scrollOffset = 0;
    } else if (matchesKey(data, 'up') || matchesKey(data, 'k')) {
      this.viewport.scrollOffset = Math.max(0, this.viewport.scrollOffset - 1);
    } else if (matchesKey(data, 'down') || matchesKey(data, 'j')) {
      this.viewport.scrollOffset = Math.min(
        this.viewport.maxScrollOffset,
        this.viewport.scrollOffset + 1
      );
    } else if (matchesKey(data, 'g')) {
      const index = GROUPS.findIndex((group) => group.id === this.groupBy);
      this.groupBy = GROUPS[(index + 1) % GROUPS.length]!.id;
      this.viewport.scrollOffset = 0;
      this.updateSpinner();
      const breakdown = this.analyticsByGroup[this.groupBy].data?.breakdown;
      if (!breakdown) {
        this.options.onAnalyticsNeeded?.(this.groupBy);
      }
    } else if (matchesKey(data, 'v')) {
      this.view = VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length]!;
    } else if (matchesKey(data, 't')) {
      const index = TOKEN_DISPLAYS.indexOf(this.tokenDisplay);
      this.tokenDisplay = TOKEN_DISPLAYS[(index + 1) % TOKEN_DISPLAYS.length]!;
    } else if (matchesKey(data, 'l')) {
      const index = SCALES.findIndex((scale) => scale.id === this.scale);
      this.scale = SCALES[(index + 1) % SCALES.length]!.id;
    } else if (matchesKey(data, 'd')) {
      const nextPolicy =
        this.options.dayPolicy === 'weekdays' ? 'calendar' : 'weekdays';
      this.options.dayPolicy = nextPolicy;
      this.options.onDayPolicyChange?.(nextPolicy);
      this.tui.requestRender();
      return;
    } else if (matchesKey(data, 'p')) {
      const idx = PERIODS.findIndex((p) => p.id === this.period);
      this.period = PERIODS[(idx + 1) % PERIODS.length]!.id;
      this.viewport.scrollOffset = 0;
      this.options.onAnalyticsNeeded?.(this.groupBy);
    }
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const innerWidth = Math.max(1, width - 2);
    const border = (text: string) => this.theme.fg('border', text);
    const pad = (text: string) => truncateToWidth(text, innerWidth, '', true);
    const lines: string[] = [];
    const chart = this.tab === 'account' ? this.getChart() : [];

    lines.push(border(`╭${'─'.repeat(innerWidth)}╮`));
    const headerLabel = this.theme.fg('accent', ' [Codex Usage]');
    const tabs = ` ${this.renderTabs()}`;
    const versionLabel = this.theme.fg('muted', `v${packageJson.version}`);
    const headerGap = Math.max(
      1,
      innerWidth -
        visibleWidth(headerLabel) -
        visibleWidth(tabs) -
        visibleWidth(versionLabel) -
        1
    );
    lines.push(
      border('│') +
        pad(`${headerLabel}${tabs}${' '.repeat(headerGap)}${versionLabel} `) +
        border('│')
    );

    lines.push(border('├') + border('─'.repeat(innerWidth)) + border('┤'));

    const summaryLines =
      this.tab === 'account'
        ? [
            this.renderMonthlyLine(),
            this.renderPeriodLine(),
            this.renderProjectedLine(),
          ]
        : this.sessionTab.renderSummaryLines();
    for (const line of summaryLines) {
      lines.push(border('│') + pad(` ${line}`) + border('│'));
    }

    lines.push(border('├') + border('─'.repeat(innerWidth)) + border('┤'));
    const legendWidth = Math.max(1, innerWidth - 1);
    const control = (
      type: string,
      shortcut: string,
      state: string,
      stateWidth: number
    ) => controlLabel(this.theme, type, shortcut, state, stateWidth);
    const accountControlLines = wrapLegend(
      [
        control('view', 'v', this.view, VIEW_WIDTH),
        control('tokens', 't', this.tokenDisplay, TOKEN_DISPLAY_WIDTH),
        control(
          'days',
          'd',
          DAY_POLICY_LABELS[this.options.dayPolicy],
          DAY_POLICY_WIDTH
        ),
        control(
          'period',
          'p',
          PERIODS.find((p) => p.id === this.period)?.label ?? '',
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
      legendWidth
    );
    const sessionControlLines = this.sessionTab.renderControlLines(legendWidth);
    const controlLines = padLines(
      this.tab === 'account' ? accountControlLines : sessionControlLines,
      Math.max(accountControlLines.length, sessionControlLines.length)
    );
    for (const controlLine of controlLines) {
      lines.push(border('│') + pad(` ${controlLine}`) + border('│'));
    }
    const modelColorMap = buildModelColorMap(chart);
    const accountFooterLines = wrapLegend(
      ['j/k or ↑/↓ scroll', 'Tab scope', 'q/Esc close', 'r ↻'],
      legendWidth
    );
    const sessionFooterLines = wrapLegend(
      ['j/k or ↑/↓ scroll', 'Tab scope', 'q/Esc close', 'r ↻'],
      legendWidth
    );
    const footerLines = padLines(
      this.tab === 'account' ? accountFooterLines : sessionFooterLines,
      Math.max(accountFooterLines.length, sessionFooterLines.length)
    );
    const accountLegendLines =
      this.view === 'models'
        ? this.getModelLegendLines(chart, modelColorMap, legendWidth)
        : this.view === 'usage' && this.options.resetAt !== undefined
          ? [
              `${this.theme.fg('accent', '█ on track')}  ${this.theme.fg('error', '█ over budget')}  ${this.theme.fg('dim', '▏ daily budget')}`,
            ]
          : [''];
    const sessionLegendLines = [this.sessionTab.renderTableHeader()];
    const legendLines = padLines(
      this.tab === 'account' ? accountLegendLines : sessionLegendLines,
      Math.max(accountLegendLines.length, sessionLegendLines.length)
    );
    lines.push(border('├') + border('─'.repeat(innerWidth)) + border('┤'));
    for (const legendLine of legendLines) {
      lines.push(border('│') + pad(` ${legendLine}`) + border('│'));
    }

    const chartRows = Math.max(
      1,
      CHART_ROWS +
        3 -
        controlLines.length -
        legendLines.length -
        footerLines.length
    );
    const chartLines =
      this.tab === 'session'
        ? this.sessionTab.renderTable(chartRows)
        : this.renderChart(chart, innerWidth, modelColorMap, chartRows);
    for (const [index, line] of chartLines.entries()) {
      const contentWidth = Math.max(1, innerWidth - 2);
      const content = truncateToWidth(` ${line}`, contentWidth, '', true);
      const padding = ' '.repeat(
        Math.max(0, contentWidth - visibleWidth(content))
      );
      const viewport =
        this.tab === 'session' ? this.sessionTab.viewport : this.viewport;
      const trailingRows = this.tab === 'session' ? 0 : 1;
      lines.push(
        border('│') +
          content +
          padding +
          ' ' +
          this.getScrollbarCell(
            index,
            chartLines.length,
            viewport,
            trailingRows
          ) +
          border('│')
      );
    }

    lines.push(border('├') + border('─'.repeat(innerWidth)) + border('┤'));
    for (const footerLine of footerLines) {
      lines.push(
        border('│') + pad(this.theme.fg('dim', ` ${footerLine}`)) + border('│')
      );
    }
    lines.push(border(`╰${'─'.repeat(innerWidth)}╯`));
    return lines;
  }

  invalidate(): void {}

  dispose(): void {
    this.disposed = true;
    this.spinner.stop();
    this.abortController.abort();
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
    const row = Math.min(
      rows.length - 1,
      Math.floor(Math.max(0, chartRows - 1) / 2)
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

  private getScrollbarCell(
    index: number,
    rowCount: number,
    viewport: Viewport,
    trailingRows: number
  ): string {
    if (viewport.maxScrollOffset === 0 || rowCount === 0) return ' ';

    const contentRowCount = Math.max(1, rowCount - trailingRows);
    if (index >= contentRowCount) return ' ';
    const thumbSize = Math.max(
      1,
      Math.round((contentRowCount * contentRowCount) / viewport.chartItemCount)
    );
    const thumbStart = Math.round(
      (viewport.scrollOffset / viewport.maxScrollOffset) *
        (contentRowCount - thumbSize)
    );
    const isThumb = index >= thumbStart && index < thumbStart + thumbSize;
    return isThumb
      ? this.theme.bg('scrollbarThumb', ' ')
      : this.theme.fg('dim', '│');
  }

  private renderTabs(): string {
    const tab = (id: Tab, label: string) => {
      const text = ` ${label} `;
      return this.tab === id
        ? this.theme.inverse(this.theme.fg('accent', text))
        : this.theme.fg('muted', text);
    };
    return `${tab('account', 'Account')}${tab('session', 'Session')}`;
  }

  private renderMonthlyLine(): string {
    const used = this.options.formatCredits(this.options.monthlyUsed);
    const limit = this.options.formatCredits(this.options.monthlyLimit);
    const usedPct = this.options.monthlyPercent;
    const leftPct = this.options.monthlyRemainingPercent;
    return `Monthly:  ${used} / ${limit} (${usedPct}%) · ${leftPct}% left`;
  }

  private renderProjectedLine(): string {
    if (this.options.projectedOverage === undefined) {
      return 'Forecast: —';
    }
    const overage = this.options.projectedOverage;
    const rounded = Math.round(Math.abs(overage));
    const ratio =
      (this.options.monthlyLimit + overage) / this.options.monthlyLimit;
    const color = overage <= 0 ? 'success' : paceColor(ratio);
    let label: string;
    if (rounded === 0) {
      label = 'on budget';
    } else if (overage > 0) {
      label = `${this.options.formatCredits(rounded)} over budget`;
      if (
        this.options.daysUntilOut !== undefined &&
        this.options.daysLeft !== undefined
      ) {
        const daysEarly = (
          this.options.daysLeft - this.options.daysUntilOut
        ).toFixed(1);
        label += `  (runs out ${daysEarly}d before reset)`;
      }
    } else {
      label = `${this.options.formatCredits(rounded)} under budget`;
    }
    return `Forecast: ${this.theme.fg(color, label)}`;
  }

  private renderPeriodLine(): string {
    const days =
      this.options.daysLeft !== undefined
        ? ` · ${this.options.daysLeft.toFixed(1)}d left`
        : '';
    const budget = this.options.dailyBudget
      ? ` · ${this.options.formatCredits(Math.round(this.options.dailyBudget))}/day`
      : '';
    return `Period:   Resets ${this.options.resetLabel}${days}${budget}`;
  }

  private getPeriodStart(): string {
    const analytics = this.analyticsByGroup[this.groupBy].data;
    if (!analytics) return '';
    if (this.period === 'week') return daysBefore(analytics.endDate, 6);
    if (this.period === 'days30') {
      return daysBefore(analytics.endDate, 29);
    }
    return analytics.lastResetDate ?? analytics.startDate;
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
    const modelTotals = new Map<string, number>();
    for (const row of rows) {
      for (const model of row.models) {
        modelTotals.set(
          model.model,
          (modelTotals.get(model.model) ?? 0) + model.credits
        );
      }
    }
    const topModels = new Set(
      [...modelTotals.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, MODEL_COLORS.length)
        .map(([model]) => model)
    );
    const items = rows.map((row) => {
      const named: Array<{
        label: string;
        value: number;
        tokenTotal: number;
      }> = [];
      let othersTotal = 0;
      let othersTokens = 0;
      for (const model of row.models) {
        const tokenTotal = sumModelTokensForModel(model);
        if (topModels.has(model.model)) {
          named.push({
            label: model.model,
            value: model.credits,
            tokenTotal,
          });
        } else {
          othersTotal += model.credits;
          othersTokens += tokenTotal;
        }
      }
      if (othersTotal > 0)
        named.push({
          label: OTHERS_LABEL,
          value: othersTotal,
          tokenTotal: othersTokens,
        });
      return {
        label: formatChartDate(row.date),
        value: sumModelCredits(row.models),
        tokenTotal: sumRowTokens(row.models),
        periodBudget: budgets.get(row.date),
        models: sortModelSegments(named),
      };
    });
    return items;
  }

  private computePeriodBudgets(): Map<string, number> {
    const analytics = this.analyticsByGroup[this.groupBy].data;
    if (!analytics || !this.options.resetAt) return new Map();

    const periodDays = this.groupBy === 'week' ? 7 : 1;
    const breakdown = analytics.breakdown;
    const lastResetDate = analytics.lastResetDate ?? analytics.startDate;

    // Only rows in the current billing period
    const periodRows = [...breakdown.workspaceUser]
      .filter((row) => row.date >= lastResetDate)
      .sort((a, b) => a.date.localeCompare(b.date));

    const map = new Map<string, number>();
    let cumulativeBefore = 0;
    const resetMs = this.options.resetAt * 1000;

    for (const row of periodRows) {
      const daysToReset =
        (resetMs - new Date(`${row.date}T00:00:00Z`).getTime()) / 86_400_000;
      const remaining = this.options.monthlyLimit - cumulativeBefore;
      if (daysToReset > 0) {
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
        const tokenInfo =
          this.tokenDisplay === 'ratio' && total.credits > 0
            ? ` ${formatTokenCount(total.tokens / total.credits)} tok/cr`
            : this.tokenDisplay === 'counts' && total.tokens > 0
              ? ` ${formatTokenCount(Math.round(total.tokens))} tok`
              : '';
        const label = colorToken(colorMap.get(model)!, `█ ${model}`);
        return label + this.theme.fg('muted', tokenInfo);
      });
    return wrapLegend(labels, width);
  }

  private renderChart(
    items: ChartItem[],
    width: number,
    modelColorMap: Map<string, readonly [number, number, number]>,
    chartRows: number
  ): string[] {
    this.viewport.chartItemCount = items.length;
    if (items.length === 0) {
      this.viewport.maxScrollOffset = 0;
      const rows = Array.from({ length: chartRows }, () => '');
      if (
        !this.analyticsByGroup[this.groupBy].loading &&
        this.analyticsByGroup[this.groupBy].error
      ) {
        rows[0] = this.theme.fg('muted', 'No usage data');
      }
      return this.overlaySpinner(rows, width, chartRows);
    }

    const orderedItems =
      this.dateOrder === 'newest'
        ? [...items].reverse()
        : this.dateOrder === 'usage'
          ? [...items].sort((a, b) => b.value - a.value)
          : items;
    const barRows = Math.max(0, chartRows - 1);
    this.viewport.maxScrollOffset = Math.max(0, orderedItems.length - barRows);
    this.viewport.scrollOffset = Math.min(
      this.viewport.scrollOffset,
      this.viewport.maxScrollOffset
    );
    const visibleItems = orderedItems.slice(
      this.viewport.scrollOffset,
      this.viewport.scrollOffset + barRows
    );
    const maxValue = Math.max(
      Math.round(
        Math.max(
          ...items.map((item) => item.value),
          ...items.map((item) => item.periodBudget ?? 0),
          1
        )
      ),
      1
    );
    const labelWidth = Math.min(
      16,
      Math.max(...items.map((item) => item.label.length), 0)
    );
    const metricWidth = Math.max(
      ...items.flatMap((item) =>
        TOKEN_DISPLAYS.map((display) =>
          visibleWidth(this.formatChartMetric(item, display))
        )
      ),
      1
    );
    const barWidth = Math.max(1, width - labelWidth - metricWidth - 5);

    const rows = visibleItems.map((item) => {
      const label = item.label.padEnd(labelWidth);
      const barValue = item.value;
      const barLength = Math.max(
        barValue > 0 ? 1 : 0,
        calculateBarLength(barValue, maxValue, barWidth, this.scale)
      );
      const markerPos =
        item.periodBudget !== undefined
          ? calculateBarLength(
              item.periodBudget,
              maxValue,
              barWidth,
              this.scale
            )
          : undefined;
      const isOverBudget =
        item.periodBudget !== undefined && barValue > item.periodBudget;
      const bar = this.renderBarArea(
        item,
        barLength,
        markerPos,
        isOverBudget,
        modelColorMap
      );
      const valueLabel = this.formatChartMetric(item);
      // markerPos is measured from the start of the bar, so keep the marker
      // aligned with the over-budget split.
      let markerSuffix = '';
      if (!item.models && markerPos !== undefined && !isOverBudget) {
        const padding = markerPos - barLength - 1 - visibleWidth(valueLabel);
        if (padding >= 1) {
          markerSuffix = ' '.repeat(padding) + this.theme.fg('dim', '▏');
        }
      }
      const barArea = barLength > 0 ? ` ${bar} ` : ' ';
      return `${label}${barArea}${valueLabel}${markerSuffix}`;
    });

    rows.push(this.renderXAxis(maxValue, barWidth, labelWidth));
    while (rows.length < chartRows) {
      rows.push('');
    }

    return this.overlaySpinner(rows, width, chartRows);
  }

  private renderXAxis(
    maxValue: number,
    barWidth: number,
    labelWidth: number
  ): string {
    const ticks = calculateXAxisTicks(maxValue, this.scale);
    const maxLabel = this.options.formatCredits(ticks.at(-1) ?? maxValue);
    const axis = Array.from({ length: barWidth + maxLabel.length }, () => ' ');
    let previousEnd = -1;
    for (const value of ticks) {
      const label = this.options.formatCredits(value);
      const position = calculateBarLength(
        value,
        maxValue,
        barWidth,
        this.scale
      );
      const start = position;
      if (start < previousEnd + 1 || start + label.length > axis.length) {
        continue;
      }
      for (let offset = 0; offset < label.length; offset++) {
        axis[start + offset] = label[offset]!;
      }
      previousEnd = start + label.length;
    }
    return `${' '.repeat(labelWidth + 1)}${this.theme.fg('dim', axis.join(''))}`;
  }

  private formatChartMetric(
    item: ChartItem,
    display: TokenDisplay = this.tokenDisplay
  ): string {
    if (display === 'off' || item.tokenTotal === undefined || item.value <= 0) {
      return this.options.formatCredits(Math.round(item.value));
    }
    const suffix =
      display === 'ratio'
        ? `${formatTokenCount(item.tokenTotal / item.value)} tok/cr`
        : `${formatTokenCount(Math.round(item.tokenTotal))} tok`;
    return `${this.options.formatCredits(Math.round(item.value))} ${this.theme.fg(
      'muted',
      `· ${suffix}`
    )}`;
  }

  private renderBarArea(
    item: ChartItem,
    barLength: number,
    markerPos: number | undefined,
    isOverBudget: boolean,
    modelColorMap: Map<string, readonly [number, number, number]>
  ): string {
    if (item.models)
      return this.renderModelBar(item.models, barLength, modelColorMap);
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
          ? this.options.formatCredits(Math.round(periodBudget))
          : '';
      const labelFits = label.length > 0 && label.length < split;
      const accentPart = labelFits
        ? fill('accent', ' '.repeat(split - label.length) + label)
        : fill('accent', ' '.repeat(split));
      return accentPart + fill('error', ' '.repeat(barLength - split));
    }

    // Under budget: accent bar only — marker line added after value label in renderChart
    return fill('accent', ' '.repeat(barLength));
  }

  private renderModelBar(
    models: NonNullable<ChartItem['models']>,
    barLength: number,
    colorMap: Map<string, readonly [number, number, number]>
  ): string {
    return renderSegmentedBar(
      models.map((model) => ({
        color: colorMap.get(model.label)!,
        value: model.value,
      })),
      barLength
    );
  }
}
