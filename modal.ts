import type { Theme, ThemeColor } from '@earendil-works/pi-coding-agent';
import {
  type Component,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from '@earendil-works/pi-tui';
import {
  type GroupBy,
  sumModelCredits,
  sumModelTokens,
  type UsageAnalytics,
} from './analytics.ts';

type DateOrder = 'newest' | 'oldest' | 'usage';
type Period = 'week' | 'days30' | 'reset';
type Scale = 'linear' | 'log';
type View = 'Usage' | 'Tokens' | 'Models';

const VIEWS: View[] = ['Usage', 'Tokens', 'Models'];
interface ModelChartItem {
  models?: Array<{ label: string; value: number }>;
}

interface ChartItem extends ModelChartItem {
  label: string;
  value: number;
  periodBudget?: number;
  tokens?: {
    input: number;
    cached: number;
    output: number;
  };
}

interface RenderRequester {
  requestRender(): void;
}

interface UsageModalOptions {
  monthlyUsed: number;
  monthlyLimit: number;
  monthlyPercent: number;
  avgDailyUsed: number | undefined;
  dailyBudget: number | undefined;
  resetAt: number | undefined;
  resetLabel: string;
  daysLeft: number | undefined;
  paceRatio: number | undefined;
  projectedOverage: number | undefined;
  daysUntilOut: number | undefined;
  formatCredits(value: number): string;
  onClose(): void;
}

const PERIODS: Array<{ id: Period; key: string; label: string }> = [
  { id: 'week', key: '1', label: 'Week' },
  { id: 'days30', key: '2', label: '30d' },
  { id: 'reset', key: '3', label: 'Period' },
];

const CONTROL_LABEL_WIDTH = Math.max(
  ...VIEWS.map((v) => v.length),
  ...PERIODS.map((p) => p.label.length),
  'Daily'.length,
  'Weekly'.length,
  'Newest'.length,
  'Oldest'.length,
  'Usage'.length
);

const OTHERS_LABEL = 'others';
const OTHERS_COLOR = [120, 120, 120] as const;

// Okabe–Ito palette: distinct for common color-vision deficiencies.
const TOKEN_COLORS = {
  input: [0, 114, 178],
  cached: [0, 158, 115],
  output: [213, 94, 0],
} as const;

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

export function calculateTokenBarLengths(
  tokens: NonNullable<ChartItem['tokens']>,
  maxValue: number,
  barWidth: number
): { input: number; cached: number; output: number } {
  const lengths = calculateSegmentBarLengths(
    [tokens.input, tokens.cached, tokens.output],
    maxValue,
    barWidth
  );
  return {
    input: lengths[0] ?? 0,
    cached: lengths[1] ?? 0,
    output: lengths[2] ?? 0,
  };
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
  private dateOrder: DateOrder = 'newest';
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

  handleInput(data: string): void {
    if (matchesKey(data, 'escape') || matchesKey(data, 'q')) {
      this.options.onClose();
      return;
    }

    if (matchesKey(data, 's')) {
      this.dateOrder =
        this.dateOrder === 'newest'
          ? 'oldest'
          : this.dateOrder === 'oldest'
            ? 'usage'
            : 'newest';
      this.scrollOffset = 0;
    } else if (matchesKey(data, 'left') || matchesKey(data, 'k')) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
    } else if (matchesKey(data, 'right') || matchesKey(data, 'j')) {
      this.scrollOffset = Math.min(this.maxScrollOffset, this.scrollOffset + 1);
    } else if (matchesKey(data, 'g')) {
      this.groupBy = this.groupBy === 'day' ? 'week' : 'day';
      this.scrollOffset = 0;
    } else if (matchesKey(data, 'v')) {
      this.view =
        VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length] ?? 'usage';
      this.scrollOffset = 0;
    } else if (matchesKey(data, 'l')) {
      this.scale = this.scale === 'linear' ? 'log' : 'linear';
    } else if (matchesKey(data, 'p')) {
      const idx = PERIODS.findIndex((p) => p.id === this.period);
      this.period = PERIODS[(idx + 1) % PERIODS.length]?.id ?? 'reset';
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
    const pad = (text: string) =>
      truncateToWidth(text, innerWidth, '...', true);
    const lines: string[] = [];
    const chart = this.getChart();

    lines.push(border(`╭${'─'.repeat(innerWidth)}╮`));
    lines.push(
      border('│') + pad(this.theme.fg('accent', ' [Codex]')) + border('│')
    );
    lines.push(border('│') + pad(` ${this.renderMonthlyLine()}`) + border('│'));
    lines.push(
      border('│') + pad(` ${this.renderDailyAvgLine()}`) + border('│')
    );
    lines.push(border('│') + pad('') + border('│'));
    lines.push(border('│') + pad(` ${this.renderPeriodLine()}`) + border('│'));
    const paceLine = this.renderPaceLine();
    if (paceLine) {
      lines.push(border('│') + pad(` ${paceLine}`) + border('│'));
    }
    lines.push(border('├') + border('─'.repeat(innerWidth)) + border('┤'));
    lines.push(
      border('│') +
        pad(
          ` ${this.theme.fg('accent', `v ${this.view.padEnd(CONTROL_LABEL_WIDTH)}`)}  ${this.theme.fg('border', '│')}  ${this.theme.fg('accent', `p ${(PERIODS.find((p) => p.id === this.period)?.label ?? '').padEnd(CONTROL_LABEL_WIDTH)}`)}  ${this.theme.fg('border', '│')}  ${this.theme.fg('accent', `g ${(this.groupBy === 'day' ? 'Daily' : 'Weekly').padEnd(CONTROL_LABEL_WIDTH)}`)}  ${this.theme.fg('border', '│')}  ${this.theme.fg('accent', `s ${(this.dateOrder === 'newest' ? 'Newest' : this.dateOrder === 'oldest' ? 'Oldest' : 'Usage').padEnd(CONTROL_LABEL_WIDTH)}`)}  ${this.theme.fg('border', '│')}  ${this.theme.fg('accent', `l ${(this.scale === 'linear' ? 'Linear' : 'Log').padEnd(CONTROL_LABEL_WIDTH)}`)}`
        ) +
        border('│')
    );
    const modelColorMap = buildModelColorMap(chart);
    const legend =
      this.view === 'Tokens'
        ? ` ${colorToken(TOKEN_COLORS.input, '█ input')}  ` +
          `${colorToken(TOKEN_COLORS.cached, '█ cached')}  ` +
          `${colorToken(TOKEN_COLORS.output, '█ output')}`
        : this.view === 'Models'
          ? this.getModelLegend(chart, modelColorMap)
          : this.view === 'Usage' && this.options.resetAt !== undefined
            ? ` ${this.theme.fg('accent', '█ on track')}  ${this.theme.fg('error', '█ over budget')}  ${this.theme.fg('dim', '▏ daily budget')}`
            : undefined;
    lines.push(border('├') + border('─'.repeat(innerWidth)) + border('┤'));
    lines.push(border('│') + pad(legend ?? '') + border('│'));

    const chartLines = this.renderChart(chart, innerWidth, modelColorMap);
    for (const [index, line] of chartLines.entries()) {
      const contentWidth = Math.max(1, innerWidth - 2);
      const content = truncateToWidth(` ${line}`, contentWidth, '...', true);
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
    lines.push(
      border('│') +
        pad(
          this.theme.fg(
            'dim',
            ` v view · p period · g interval · s order · l scale · j/k scroll · q/esc close`
          )
        ) +
        border('│')
    );
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
    return isThumb ? this.theme.fg('muted', '█') : this.theme.fg('dim', '│');
  }

  private renderMonthlyLine(): string {
    const used = this.options.formatCredits(this.options.monthlyUsed);
    const limit = this.options.formatCredits(this.options.monthlyLimit);
    const usedPct = Math.round(this.options.monthlyPercent);
    const leftPct = 100 - usedPct;
    return `Monthly:  ${used} / ${limit} (${usedPct}%) · ${leftPct}% left`;
  }

  private renderDailyAvgLine(): string {
    if (
      this.options.avgDailyUsed === undefined ||
      this.options.dailyBudget === undefined ||
      this.options.dailyBudget === 0
    ) {
      return 'Daily avg: —';
    }

    const avg = this.options.formatCredits(
      Math.round(this.options.avgDailyUsed)
    );
    const budget = this.options.formatCredits(
      Math.round(this.options.dailyBudget)
    );
    const percent =
      (this.options.avgDailyUsed / this.options.dailyBudget) * 100;
    const overuse = percent > 100;

    if (overuse) {
      return this.theme.fg(
        'error',
        `Daily avg: ${avg} / ${budget} (${Math.round(percent)}%)`
      );
    }

    return `Daily avg: ${avg} / ${budget} (${Math.round(percent)}%)`;
  }

  private renderPeriodLine(): string {
    const days =
      this.options.daysLeft !== undefined
        ? ` · ${this.options.daysLeft.toFixed(1)} days left`
        : '';
    return `Period:   Resets ${this.options.resetLabel}${days}`;
  }

  private renderPaceLine(): string | undefined {
    if (
      this.options.paceRatio === undefined ||
      this.options.projectedOverage === undefined ||
      this.options.daysUntilOut === undefined
    ) {
      return undefined;
    }

    const ratio = this.options.paceRatio.toFixed(1);
    const overage = this.options.projectedOverage;
    const overageLabel =
      overage > 0
        ? `+${this.options.formatCredits(overage)} over`
        : `${this.options.formatCredits(Math.abs(overage))} under`;
    const outLabel = `credits out in ${Math.round(this.options.daysUntilOut)} days`;
    const overusing = this.options.paceRatio > 1;
    const text = `Pace:     ${ratio}\u00d7 \u00b7 projected ${overageLabel} \u00b7 ${outLabel}`;
    return overusing ? this.theme.fg('error', text) : text;
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
        periodBudget: budgets.get(row.date),
      }));
    }
    if (this.view === 'Tokens') {
      return rows.map((row) => ({
        label: formatChartDate(row.date),
        value: sumModelCredits(row.models),
        periodBudget: budgets.get(row.date),
        tokens: {
          input: sumModelTokens(row.models, 'uncached_text_input_tokens'),
          cached: sumModelTokens(row.models, 'cached_text_input_tokens'),
          output: sumModelTokens(row.models, 'text_output_tokens'),
        },
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
      const named: Array<{ label: string; value: number }> = [];
      let othersTotal = 0;
      for (const model of row.models) {
        if (topModels.has(model.model)) {
          named.push({ label: model.model, value: model.credits });
        } else {
          othersTotal += model.credits;
        }
      }
      if (othersTotal > 0)
        named.push({ label: OTHERS_LABEL, value: othersTotal });
      return {
        label: formatChartDate(row.date),
        value: sumModelCredits(row.models),
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

  private getModelLegend(
    items: ChartItem[],
    colorMap: Map<string, readonly [number, number, number]>
  ): string | undefined {
    const labels = [
      ...new Set(
        items.flatMap((item) => item.models?.map((model) => model.label) ?? [])
      ),
    ]
      .sort((a, b) => a.localeCompare(b))
      .map((model) =>
        colorToken(
          colorMap.get(model)!,
          `█ ${model === OTHERS_LABEL ? model : model.replace('gpt-', '')}`
        )
      );
    return labels.length > 0 ? ` ${labels.join('  ')}` : undefined;
  }

  private renderChart(
    items: ChartItem[],
    width: number,
    modelColorMap: Map<string, readonly [number, number, number]>
  ): string[] {
    this.chartItemCount = items.length;
    if (items.length === 0) {
      return [
        this.theme.fg(
          'muted',
          this.analyticsError ? ' No usage data' : ' Loading charts…'
        ),
      ];
    }

    const orderedItems =
      this.dateOrder === 'newest'
        ? [...items].reverse()
        : this.dateOrder === 'usage'
          ? [...items].sort((a, b) => b.value - a.value)
          : items;
    this.maxScrollOffset = Math.max(0, orderedItems.length - CHART_ROWS);
    this.scrollOffset = Math.min(this.scrollOffset, this.maxScrollOffset);
    const visibleItems = orderedItems.slice(
      this.scrollOffset,
      this.scrollOffset + CHART_ROWS
    );
    const maxValue = Math.max(...items.map((item) => item.value), 1);
    const labelWidth = Math.min(
      16,
      Math.max(...items.map((item) => item.label.length), 0)
    );
    const barWidth = Math.max(4, width - labelWidth - 13);

    const rows = visibleItems.map((item) => {
      const label = item.label.padEnd(labelWidth);
      const barLength = Math.max(
        item.value > 0 ? 1 : 0,
        calculateBarLength(item.value, maxValue, barWidth, this.scale)
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
        item.periodBudget !== undefined && item.value > item.periodBudget;
      const bar = this.renderBarArea(
        item,
        barLength,
        markerPos,
        isOverBudget,
        modelColorMap
      );
      const valueLabel = this.options.formatCredits(Math.round(item.value));
      // For under-budget Usage bars, append the thin marker line after the value label.
      let markerSuffix = '';
      if (
        !item.tokens &&
        !item.models &&
        markerPos !== undefined &&
        !isOverBudget
      ) {
        const padding = markerPos - barLength - 1 - valueLabel.length;
        if (padding >= 1) {
          markerSuffix = ' '.repeat(padding) + this.theme.fg('dim', '▏');
        }
      }
      return `${label} ${bar} ${valueLabel}${markerSuffix}`;
    });

    while (rows.length < CHART_ROWS) {
      rows.push('');
    }

    return rows;
  }

  private renderBarArea(
    item: ChartItem,
    barLength: number,
    markerPos: number | undefined,
    isOverBudget: boolean,
    modelColorMap: Map<string, readonly [number, number, number]>
  ): string {
    if (item.tokens) return this.renderTokenBar(item.tokens, barLength);
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

  private renderTokenBar(
    tokens: NonNullable<ChartItem['tokens']>,
    barLength: number
  ): string {
    return renderSegmentedBar(
      [
        { color: TOKEN_COLORS.input, value: tokens.input },
        { color: TOKEN_COLORS.cached, value: tokens.cached },
        { color: TOKEN_COLORS.output, value: tokens.output },
      ],
      barLength
    );
  }
}
