import type { Theme, ThemeColor } from '@earendil-works/pi-coding-agent';
import {
  type Component,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from '@earendil-works/pi-tui';
import packageJson from '../package.json' with { type: 'json' };
import {
  type GroupBy,
  sumModelCredits,
  sumModelTokens,
  type UsageAnalytics,
  type WorkspaceUserModelUsage,
} from './analytics.ts';
import type { DayPolicy } from './config.ts';
import type {
  SessionCreditUsage,
  SessionModelCreditUsage,
} from './session-usage.ts';
import { paceColor } from './status.ts';

type DateOrder = 'newest' | 'oldest' | 'usage';
type Period = 'week' | 'days30' | 'reset';
type Scale = 'linear' | 'sqrt' | 'log';
type View = 'Usage' | 'Models';
type TokenDisplay = 'off' | 'ratio' | 'counts';
type Tab = 'account' | 'session';
type SessionScope = 'branch' | 'session';
type SessionSort = 'total' | 'responses';
type SessionDisplay = 'credits' | 'tokens';

const TOKEN_DISPLAYS: TokenDisplay[] = ['off', 'counts', 'ratio'];

const VIEWS: View[] = ['Usage', 'Models'];

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
  onClose(): void;
}

const PERIODS: Array<{ id: Period; key: string; label: string }> = [
  { id: 'week', key: '1', label: 'Week' },
  { id: 'days30', key: '2', label: '30d' },
  { id: 'reset', key: '3', label: 'Period' },
];

const GROUPS: Array<{ id: GroupBy; label: string }> = [
  { id: 'day', label: 'Daily' },
  { id: 'week', label: 'Weekly' },
];

const SORT_ORDERS: Array<{ id: DateOrder; label: string }> = [
  { id: 'newest', label: 'Newest' },
  { id: 'oldest', label: 'Oldest' },
  { id: 'usage', label: 'Usage' },
];

const SESSION_SORTS: Array<{ id: SessionSort; label: string }> = [
  { id: 'total', label: 'Total' },
  { id: 'responses', label: 'Replies' },
];

const SESSION_DISPLAYS: Array<{ id: SessionDisplay; label: string }> = [
  { id: 'credits', label: 'Credits' },
  { id: 'tokens', label: 'Tokens' },
];

const SCALES: Array<{ id: Scale; label: string }> = [
  { id: 'linear', label: 'Linear' },
  { id: 'sqrt', label: 'Sqrt' },
  { id: 'log', label: 'Log' },
];

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

export function calculateBarLength(
  value: number,
  maxValue: number,
  barWidth: number,
  scale: Scale = 'linear'
): number {
  if (scale === 'log') {
    return Math.round(
      (Math.log(value + 1) / Math.log(maxValue + 1)) * barWidth
    );
  }
  if (scale === 'sqrt') {
    return Math.round(Math.sqrt(value / maxValue) * barWidth);
  }
  return Math.round((value / maxValue) * barWidth);
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

function formatResponseCount(count: number): string {
  return `${count} repl${count === 1 ? 'y' : 'ies'}`;
}

function formatTokenCount(value: number): string {
  const absolute = Math.abs(value);
  const divisor =
    absolute >= 1_000_000 ? 1_000_000 : absolute >= 1_000 ? 1_000 : 1;
  const suffix = divisor === 1_000_000 ? 'm' : divisor === 1_000 ? 'k' : '';
  return (
    new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    }).format(value / divisor) + suffix
  );
}

function wrapLegend(entries: string[], width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const entry of entries) {
    const candidate = current ? `${current}  ${entry}` : entry;
    if (current && visibleWidth(candidate) > width) {
      lines.push(current);
      current = entry;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function padLines(lines: string[], count: number): string[] {
  return [
    ...lines,
    ...Array.from({ length: Math.max(0, count - lines.length) }, () => ''),
  ];
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

const CHART_ROWS = 7;

export class UsageModal implements Component {
  private groupBy: GroupBy = 'day';
  private period: Period = 'reset';
  private scale: Scale = 'linear';
  private view: View = 'Usage';
  private tokenDisplay: TokenDisplay = 'off';
  private dateOrder: DateOrder = 'newest';
  private tab: Tab = 'account';
  private sessionScope: SessionScope = 'session';
  private sessionSort: SessionSort = 'total';
  private sessionDisplay: SessionDisplay = 'credits';
  private scrollOffset = 0;
  private maxScrollOffset = 0;
  private chartItemCount = 0;
  private analytics: UsageAnalytics | undefined;
  private analyticsError: string | undefined;
  private readonly abortController = new AbortController();
  private disposed = false;

  constructor(
    private readonly tui: RenderRequester,
    private readonly theme: Theme,
    private readonly options: UsageModalOptions
  ) {}

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  setAnalytics(analytics: UsageAnalytics): void {
    if (this.disposed) return;
    this.analytics = analytics;
    this.analyticsError = undefined;
    this.tui.requestRender();
  }

  setAnalyticsError(): void {
    if (this.disposed) return;
    this.analyticsError = 'Usage analytics unavailable';
    this.tui.requestRender();
  }

  refreshSummary(
    summary: Pick<
      UsageModalOptions,
      | 'avgDailyUsed'
      | 'dailyBudget'
      | 'daysLeft'
      | 'projectedOverage'
      | 'daysUntilOut'
    >
  ): void {
    Object.assign(this.options, summary);
    this.tui.requestRender();
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape') || matchesKey(data, 'q')) {
      this.options.onClose();
      return;
    }

    if (matchesKey(data, 'tab')) {
      this.tab = this.tab === 'account' ? 'session' : 'account';
      this.scrollOffset = 0;
      this.tui.requestRender();
      return;
    }

    if (this.tab === 'session') {
      if (matchesKey(data, 'b') && this.options.wholeSessionCreditUsage) {
        this.sessionScope =
          this.sessionScope === 'branch' ? 'session' : 'branch';
        this.scrollOffset = 0;
      } else if (matchesKey(data, 's')) {
        const index = SESSION_SORTS.findIndex(
          (sort) => sort.id === this.sessionSort
        );
        this.sessionSort =
          SESSION_SORTS[(index + 1) % SESSION_SORTS.length]!.id;
        this.scrollOffset = 0;
      } else if (matchesKey(data, 't')) {
        const index = SESSION_DISPLAYS.findIndex(
          (display) => display.id === this.sessionDisplay
        );
        this.sessionDisplay =
          SESSION_DISPLAYS[(index + 1) % SESSION_DISPLAYS.length]!.id;
      } else if (matchesKey(data, 'left') || matchesKey(data, 'k')) {
        this.scrollOffset = Math.max(0, this.scrollOffset - 1);
      } else if (matchesKey(data, 'right') || matchesKey(data, 'j')) {
        this.scrollOffset = Math.min(
          this.maxScrollOffset,
          this.scrollOffset + 1
        );
      }
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, 's')) {
      const index = SORT_ORDERS.findIndex(
        (order) => order.id === this.dateOrder
      );
      this.dateOrder = SORT_ORDERS[(index + 1) % SORT_ORDERS.length]!.id;
      this.scrollOffset = 0;
    } else if (matchesKey(data, 'left') || matchesKey(data, 'k')) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
    } else if (matchesKey(data, 'right') || matchesKey(data, 'j')) {
      this.scrollOffset = Math.min(this.maxScrollOffset, this.scrollOffset + 1);
    } else if (matchesKey(data, 'g')) {
      const index = GROUPS.findIndex((group) => group.id === this.groupBy);
      this.groupBy = GROUPS[(index + 1) % GROUPS.length]!.id;
      this.scrollOffset = 0;
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
      this.scrollOffset = 0;
    } else {
      const period = PERIODS.find((candidate) => data === candidate.key);
      if (period) {
        this.period = period.id;
        this.scrollOffset = 0;
      }
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
    const headerLabel = this.theme.fg('accent', ' [Codex]');
    const versionLabel = this.theme.fg('muted', `v${packageJson.version}`);
    const headerGap = Math.max(
      1,
      innerWidth - visibleWidth(headerLabel) - visibleWidth(versionLabel) - 1
    );
    lines.push(
      border('│') +
        pad(`${headerLabel}${' '.repeat(headerGap)}${versionLabel} `) +
        border('│')
    );

    lines.push(border('│') + pad(this.renderTabs()) + border('│'));

    const summaryLines =
      this.tab === 'account'
        ? [
            this.renderMonthlyLine(),
            this.renderSessionLine(),
            '',
            this.renderPeriodLine(),
            this.renderProjectedLine(),
          ]
        : this.renderSessionSummaryLines();
    for (const line of summaryLines) {
      lines.push(border('│') + pad(` ${line}`) + border('│'));
    }

    lines.push(border('├') + border('─'.repeat(innerWidth)) + border('┤'));
    const legendWidth = Math.max(1, innerWidth - 1);
    const accountControlLines = wrapLegend(
      [
        `v ${this.view}`,
        `t Tokens ${this.tokenDisplay}`,
        `p ${PERIODS.find((p) => p.id === this.period)?.label ?? ''}`,
        `g ${GROUPS.find((group) => group.id === this.groupBy)?.label ?? ''}`,
        `s ${SORT_ORDERS.find((order) => order.id === this.dateOrder)?.label ?? ''}`,
        `l ${SCALES.find((scale) => scale.id === this.scale)?.label ?? ''}`,
      ],
      legendWidth
    );
    const sessionControlLines = wrapLegend(
      [
        `b ${this.renderSessionScope()}`,
        `s ${SESSION_SORTS.find((sort) => sort.id === this.sessionSort)?.label ?? ''}`,
        `t ${SESSION_DISPLAYS.find((display) => display.id === this.sessionDisplay)?.label ?? ''}`,
      ],
      legendWidth
    );
    const controlLines = padLines(
      this.tab === 'account' ? accountControlLines : sessionControlLines,
      Math.max(accountControlLines.length, sessionControlLines.length)
    );
    for (const controlLine of controlLines) {
      lines.push(border('│') + pad(` ${controlLine}`) + border('│'));
    }
    const modelColorMap = buildModelColorMap(chart);
    const accountFooterLines = wrapLegend(
      [
        'v view',
        't tokens',
        'd days',
        'p period',
        'g interval',
        's order',
        'l scale',
        'j/k scroll',
        'Tab tabs',
        'q close',
      ],
      legendWidth
    );
    const sessionFooterLines = wrapLegend(
      [
        'b scope',
        's sort',
        't tokens/credits',
        'j/k scroll',
        'Tab tabs',
        'q close',
      ],
      legendWidth
    );
    const footerLines = padLines(
      this.tab === 'account' ? accountFooterLines : sessionFooterLines,
      Math.max(accountFooterLines.length, sessionFooterLines.length)
    );
    const accountLegendLines =
      this.view === 'Models'
        ? this.getModelLegendLines(chart, modelColorMap, legendWidth)
        : this.view === 'Usage' && this.options.resetAt !== undefined
          ? [
              `${this.theme.fg('accent', '█ on track')}  ${this.theme.fg('error', '█ over budget')}  ${this.theme.fg('dim', '▏ daily budget')}`,
            ]
          : [''];
    const sessionLegendLines = [this.renderSessionTableHeader()];
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
        ? this.renderSessionTable(chartRows)
        : this.renderChart(chart, innerWidth, modelColorMap, chartRows);
    for (const [index, line] of chartLines.entries()) {
      const contentWidth = Math.max(1, innerWidth - 2);
      const content = truncateToWidth(` ${line}`, contentWidth, '', true);
      const padding = ' '.repeat(
        Math.max(0, contentWidth - visibleWidth(content))
      );
      lines.push(
        border('│') +
          content +
          padding +
          ' ' +
          this.getScrollbarCell(index, chartLines.length) +
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
    this.abortController.abort();
  }

  private getScrollbarCell(index: number, rowCount: number): string {
    if (this.maxScrollOffset === 0 || rowCount === 0) return ' ';

    const thumbSize = Math.max(
      1,
      Math.round((rowCount * rowCount) / this.chartItemCount)
    );
    const thumbStart = Math.round(
      (this.scrollOffset / this.maxScrollOffset) * (rowCount - thumbSize)
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
    return `${tab('account', 'Account')}  ${tab('session', 'Session')}`;
  }

  private renderMonthlyLine(): string {
    const used = this.options.formatCredits(this.options.monthlyUsed);
    const limit = this.options.formatCredits(this.options.monthlyLimit);
    const usedPct = this.options.monthlyPercent;
    const leftPct = this.options.monthlyRemainingPercent;
    return `Monthly:  ${used} / ${limit} (${usedPct}%) · ${leftPct}% left`;
  }

  private getSessionCreditUsage(): SessionCreditUsage | undefined {
    return this.sessionScope === 'session'
      ? (this.options.wholeSessionCreditUsage ??
          this.options.sessionCreditUsage)
      : this.options.sessionCreditUsage;
  }

  private renderSessionScope(): string {
    return this.sessionScope === 'branch' ? 'Active branch' : 'Whole Session';
  }

  private renderSessionLine(): string {
    const usage =
      this.options.wholeSessionCreditUsage ?? this.options.sessionCreditUsage;
    if (!usage) return 'Session:  —';

    const total = this.options.formatCredits(usage.totalCredits);
    const topModel = usage.models.find((model) => model.priced);
    const top = topModel ? ` · top ${topModel.model}` : '';
    return `Session:  ~${total} credits · ${formatResponseCount(usage.responseCount)}${top}`;
  }

  private renderSessionSummaryLines(): string[] {
    const usage = this.getSessionCreditUsage();
    if (!usage) {
      return ['Session estimate: —', 'Replies:  —', '', '', ''];
    }

    const priorityResponses = usage.models.reduce(
      (total, model) => total + model.priorityResponses,
      0
    );
    const compactions = `${usage.compactionCount} compaction${usage.compactionCount === 1 ? '' : 's'}`;
    const sessionTotal =
      this.sessionDisplay === 'tokens'
        ? `${formatTokenCount(this.sessionTotalTokens(usage))} tokens`
        : `~${this.options.formatCredits(usage.totalCredits)} credits`;
    return [
      `Session:  ${sessionTotal} · ${compactions}`,
      `Replies:  ${usage.responseCount} (${priorityResponses} priority)`,
      '',
      '',
      '',
    ];
  }

  private sessionTableWidths(): {
    model: number;
    value: number;
    count: number;
  } {
    return { model: 20, value: 12, count: 10 };
  }

  private formatSessionTableValue(value: number, priced = true): string {
    const { value: width } = this.sessionTableWidths();
    const formatted =
      this.sessionDisplay === 'tokens'
        ? formatTokenCount(value)
        : priced
          ? this.options.formatCredits(value)
          : '—';
    return formatted.padStart(width);
  }

  private sessionModelTotalTokens(model: SessionModelCreditUsage): number {
    return (
      (model.inputTokens ?? 0) +
      (model.cachedInputTokens ?? 0) +
      (model.outputTokens ?? 0)
    );
  }

  private sessionTotalTokens(usage: SessionCreditUsage): number {
    return usage.models.reduce(
      (total, model) => total + this.sessionModelTotalTokens(model),
      0
    );
  }

  private renderSessionTableHeader(): string {
    const { model, value, count } = this.sessionTableWidths();
    const labels =
      this.sessionDisplay === 'tokens'
        ? ['Input tok', 'Cached tok', 'Output tok', 'Total tok']
        : ['Input cr', 'Cached cr', 'Output cr', 'Total cr'];
    const header =
      'Model'.padEnd(model) +
      ' ' +
      labels[0]!.padStart(value) +
      ' ' +
      labels[1]!.padStart(value) +
      ' ' +
      labels[2]!.padStart(value) +
      ' ' +
      labels[3]!.padStart(value) +
      ' ' +
      'Replies'.padStart(count) +
      ' ' +
      'Priority'.padStart(count);
    return this.theme.bold(this.theme.fg('accent', header));
  }

  private renderSessionTableRow(
    model: SessionModelCreditUsage,
    label = model.model,
    emphasize = false
  ): string {
    const { model: modelWidth, count } = this.sessionTableWidths();
    const values =
      this.sessionDisplay === 'tokens'
        ? [
            model.inputTokens ?? 0,
            model.cachedInputTokens ?? 0,
            model.outputTokens ?? 0,
            this.sessionModelTotalTokens(model),
          ]
        : [
            model.inputCredits,
            model.cachedInputCredits,
            model.outputCredits,
            model.credits,
          ];
    const row =
      label.slice(0, modelWidth).padEnd(modelWidth) +
      ' ' +
      this.formatSessionTableValue(values[0]!, model.priced) +
      ' ' +
      this.formatSessionTableValue(values[1]!, model.priced) +
      ' ' +
      this.formatSessionTableValue(values[2]!, model.priced) +
      ' ' +
      this.formatSessionTableValue(values[3]!, model.priced) +
      ' ' +
      String(model.responses).padStart(count) +
      ' ' +
      String(model.priorityResponses).padStart(count);
    return emphasize ? this.theme.bold(this.theme.fg('accent', row)) : row;
  }

  private getSessionTableLines(): string[] {
    const usage = this.getSessionCreditUsage();
    if (!usage) return ['No session estimate'];

    const models = [...usage.models].sort((a, b) => {
      const aTotal =
        this.sessionDisplay === 'tokens'
          ? this.sessionModelTotalTokens(a)
          : a.credits;
      const bTotal =
        this.sessionDisplay === 'tokens'
          ? this.sessionModelTotalTokens(b)
          : b.credits;
      const primary =
        this.sessionSort === 'responses'
          ? b.responses - a.responses
          : bTotal - aTotal;
      return primary || bTotal - aTotal || a.model.localeCompare(b.model);
    });
    const lines =
      models.length > 0
        ? models.map((model) => this.renderSessionTableRow(model))
        : ['No Codex replies'];
    const total = models.reduce(
      (sum, model) => ({
        inputTokens: sum.inputTokens + (model.inputTokens ?? 0),
        cachedInputTokens:
          sum.cachedInputTokens + (model.cachedInputTokens ?? 0),
        outputTokens: sum.outputTokens + (model.outputTokens ?? 0),
        inputCredits:
          sum.inputCredits + (model.priced ? model.inputCredits : 0),
        cachedInputCredits:
          sum.cachedInputCredits +
          (model.priced ? model.cachedInputCredits : 0),
        outputCredits:
          sum.outputCredits + (model.priced ? model.outputCredits : 0),
        credits: sum.credits + (model.priced ? model.credits : 0),
        responses: sum.responses + model.responses,
        priorityResponses: sum.priorityResponses + model.priorityResponses,
      }),
      {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        inputCredits: 0,
        cachedInputCredits: 0,
        outputCredits: 0,
        credits: 0,
        responses: 0,
        priorityResponses: 0,
      }
    );
    if (models.length > 1) {
      lines.push(
        this.renderSessionTableRow(
          {
            model: 'total',
            inputTokens: total.inputTokens,
            cachedInputTokens: total.cachedInputTokens,
            outputTokens: total.outputTokens,
            inputCredits: total.inputCredits,
            cachedInputCredits: total.cachedInputCredits,
            outputCredits: total.outputCredits,
            credits: total.credits,
            responses: total.responses,
            priorityResponses: total.priorityResponses,
            priced: true,
          },
          'Total',
          true
        )
      );
    }
    return lines;
  }

  private renderSessionTable(rows: number): string[] {
    const allLines = this.getSessionTableLines();
    this.chartItemCount = allLines.length;
    this.maxScrollOffset = Math.max(0, allLines.length - rows);
    this.scrollOffset = Math.min(this.scrollOffset, this.maxScrollOffset);
    const visibleLines = allLines.slice(
      this.scrollOffset,
      this.scrollOffset + rows
    );
    while (visibleLines.length < rows) visibleLines.push('');
    return visibleLines;
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
    if (!this.analytics) return '';
    if (this.period === 'week') return daysBefore(this.analytics.endDate, 6);
    if (this.period === 'days30') {
      return daysBefore(this.analytics.endDate, 29);
    }
    return this.analytics.lastResetDate ?? this.analytics.startDate;
  }

  private getChart(): ChartItem[] {
    if (!this.analytics) return [];
    const breakdown =
      this.analytics[this.groupBy === 'day' ? 'daily' : 'weekly'];
    const periodStart = this.getPeriodStart();
    const budgets = this.computePeriodBudgets();

    const rows = breakdown.workspaceUser.filter(
      (row) => row.date >= periodStart
    );
    if (this.view === 'Usage') {
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
    if (!this.analytics || !this.options.resetAt) return new Map();

    const periodDays = this.groupBy === 'week' ? 7 : 1;
    const breakdown =
      this.analytics[this.groupBy === 'day' ? 'daily' : 'weekly'];
    const lastResetDate =
      this.analytics.lastResetDate ?? this.analytics.startDate;

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
    this.chartItemCount = items.length;
    if (items.length === 0) {
      this.maxScrollOffset = 0;
      const rows = [
        this.theme.fg(
          'muted',
          this.analyticsError ? 'No usage data' : 'Loading charts…'
        ),
      ];
      while (rows.length < chartRows) rows.push('');
      return rows;
    }

    const orderedItems =
      this.dateOrder === 'newest'
        ? [...items].reverse()
        : this.dateOrder === 'usage'
          ? [...items].sort((a, b) => b.value - a.value)
          : items;
    this.maxScrollOffset = Math.max(0, orderedItems.length - chartRows);
    this.scrollOffset = Math.min(this.scrollOffset, this.maxScrollOffset);
    const visibleItems = orderedItems.slice(
      this.scrollOffset,
      this.scrollOffset + chartRows
    );
    const maxValue = Math.max(
      ...items.map((item) => item.value),
      ...items.map((item) => item.periodBudget ?? 0),
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
      // Reserve the metric column before placing the marker so the marker
      // reaches the right edge of the chart area.
      const markerColumn =
        markerPos === undefined ? undefined : markerPos + metricWidth;
      // For under-budget Usage bars, append the thin marker line after the value label.
      let markerSuffix = '';
      if (!item.models && markerColumn !== undefined && !isOverBudget) {
        const padding = markerColumn - barLength - 1 - visibleWidth(valueLabel);
        if (padding >= 1) {
          markerSuffix = ' '.repeat(padding) + this.theme.fg('dim', '▏');
        }
      }
      return `${label} ${bar} ${valueLabel}${markerSuffix}`;
    });

    while (rows.length < chartRows) {
      rows.push('');
    }

    return rows;
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
