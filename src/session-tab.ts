import type { Theme } from '@earendil-works/pi-coding-agent';
import { matchesKey } from '@earendil-works/pi-tui';
import { formatTokenCount } from './format.ts';
import { controlLabel, maxLength, wrapLegend } from './legend.ts';
import type {
  SessionCreditUsage,
  SessionModelCreditUsage,
} from './session-usage.ts';
import { cycleOption } from './util.ts';
import type { Viewport } from './viewport.ts';

type SessionScope = 'branch' | 'session';
type SessionSort = 'total' | 'responses';
type SessionDisplay = 'credits' | 'tokens';

const SESSION_SORTS: Array<{ id: SessionSort; label: string }> = [
  { id: 'total', label: 'total' },
  { id: 'responses', label: 'replies' },
];

const SESSION_DISPLAYS: Array<{ id: SessionDisplay; label: string }> = [
  { id: 'credits', label: 'credits' },
  { id: 'tokens', label: 'tokens' },
];

const SESSION_SCOPE_STATES = ['active branch', 'whole session'] as const;
const SESSION_SORT_WIDTH = maxLength(SESSION_SORTS.map((sort) => sort.label));
const SESSION_DISPLAY_WIDTH = maxLength(
  SESSION_DISPLAYS.map((display) => display.label)
);
const SESSION_SCOPE_WIDTH = maxLength(SESSION_SCOPE_STATES);

export interface SessionTabOptions {
  theme: Theme;
  formatCredits(value: number): string;
  sessionCreditUsage?: SessionCreditUsage;
  wholeSessionCreditUsage?: SessionCreditUsage;
}

/**
 * Renders the session tab: summary lines, the per-model table, control
 * labels, and its own scroll state. Key handling mirrors the modal's
 * account tab (c/s/u, j/k, arrows).
 */
export class SessionTab {
  private scope: SessionScope = 'session';
  private sort: SessionSort = 'total';
  private display: SessionDisplay = 'credits';
  private scrollOffset = 0;
  private maxScrollOffset = 0;
  private chartItemCount = 0;

  constructor(private readonly options: SessionTabOptions) {}

  get viewport(): Viewport {
    return {
      scrollOffset: this.scrollOffset,
      maxScrollOffset: this.maxScrollOffset,
      chartItemCount: this.chartItemCount,
    };
  }

  resetScroll(): void {
    this.scrollOffset = 0;
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'c') && this.options.wholeSessionCreditUsage) {
      this.scope = this.scope === 'branch' ? 'session' : 'branch';
      this.scrollOffset = 0;
    } else if (matchesKey(data, 's')) {
      this.sort = cycleOption(SESSION_SORTS, this.sort);
      this.scrollOffset = 0;
    } else if (matchesKey(data, 'u')) {
      this.display = cycleOption(SESSION_DISPLAYS, this.display);
    } else if (matchesKey(data, 'up') || matchesKey(data, 'k')) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
    } else if (matchesKey(data, 'down') || matchesKey(data, 'j')) {
      this.scrollOffset = Math.min(this.maxScrollOffset, this.scrollOffset + 1);
    }
  }

  renderSummaryLines(): string[] {
    const usage = this.getSessionCreditUsage();
    if (!usage) {
      return ['Session:  —', 'Replies:  —', 'Models:   —'];
    }

    const priorityResponses = usage.models.reduce(
      (total, model) => total + model.priorityResponses,
      0
    );
    const compactions = `${usage.compactionCount} compaction${usage.compactionCount === 1 ? '' : 's'}`;
    const sessionTotal =
      this.display === 'tokens'
        ? `${formatTokenCount(this.sessionTotalTokens(usage))} tokens`
        : `~${this.options.formatCredits(usage.totalCredits)} credits`;
    const topModel = usage.models.find((model) => model.priced);
    const otherModelCount = topModel ? usage.models.length - 1 : 0;
    const otherModelSuffix =
      otherModelCount > 0
        ? this.options.theme.fg(
            'muted',
            ` +${otherModelCount} other${otherModelCount === 1 ? '' : 's'}`
          )
        : '';
    const modelSummary = topModel
      ? `${topModel.model}${otherModelSuffix}`
      : '—';
    return [
      `Session:  ${sessionTotal} · ${compactions}`,
      `Replies:  ${usage.responseCount} (${priorityResponses} priority)`,
      `Models:   ${modelSummary}`,
    ];
  }

  renderTableHeader(): string {
    const { model, value, count } = this.tableWidths();
    const labels =
      this.display === 'tokens'
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
    return this.options.theme.bold(this.options.theme.fg('accent', header));
  }

  renderTable(rows: number): string[] {
    const allLines = this.getTableLines();
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

  renderControlLines(width: number): string[] {
    const { theme } = this.options;
    return wrapLegend(
      [
        controlLabel(
          theme,
          'scope',
          'c',
          this.scopeLabel(),
          SESSION_SCOPE_WIDTH
        ),
        controlLabel(
          theme,
          'sort',
          's',
          SESSION_SORTS.find((sort) => sort.id === this.sort)?.label ?? '',
          SESSION_SORT_WIDTH
        ),
        controlLabel(
          theme,
          'unit',
          'u',
          SESSION_DISPLAYS.find((display) => display.id === this.display)
            ?.label ?? '',
          SESSION_DISPLAY_WIDTH
        ),
      ],
      width
    );
  }

  private scopeLabel(): string {
    return this.scope === 'branch'
      ? SESSION_SCOPE_STATES[0]
      : SESSION_SCOPE_STATES[1];
  }

  private getSessionCreditUsage(): SessionCreditUsage | undefined {
    return this.scope === 'session'
      ? (this.options.wholeSessionCreditUsage ??
          this.options.sessionCreditUsage)
      : this.options.sessionCreditUsage;
  }

  private tableWidths(): {
    model: number;
    value: number;
    count: number;
  } {
    return { model: 20, value: 12, count: 10 };
  }

  private formatTableValue(value: number, priced = true): string {
    const { value: width } = this.tableWidths();
    const formatted =
      this.display === 'tokens'
        ? formatTokenCount(value)
        : priced
          ? this.options.formatCredits(value)
          : '—';
    return formatted.padStart(width);
  }

  private modelTotalTokens(model: SessionModelCreditUsage): number {
    return (
      (model.inputTokens ?? 0) +
      (model.cachedInputTokens ?? 0) +
      (model.outputTokens ?? 0)
    );
  }

  private sessionTotalTokens(usage: SessionCreditUsage): number {
    return usage.models.reduce(
      (total, model) => total + this.modelTotalTokens(model),
      0
    );
  }

  private renderTableRow(
    model: SessionModelCreditUsage,
    label = model.model,
    emphasize = false
  ): string {
    const { model: modelWidth, count } = this.tableWidths();
    const values =
      this.display === 'tokens'
        ? [
            model.inputTokens ?? 0,
            model.cachedInputTokens ?? 0,
            model.outputTokens ?? 0,
            this.modelTotalTokens(model),
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
      this.formatTableValue(values[0]!, model.priced) +
      ' ' +
      this.formatTableValue(values[1]!, model.priced) +
      ' ' +
      this.formatTableValue(values[2]!, model.priced) +
      ' ' +
      this.formatTableValue(values[3]!, model.priced) +
      ' ' +
      String(model.responses).padStart(count) +
      ' ' +
      String(model.priorityResponses).padStart(count);
    return emphasize
      ? this.options.theme.bold(this.options.theme.fg('accent', row))
      : row;
  }

  private getTableLines(): string[] {
    const usage = this.getSessionCreditUsage();
    if (!usage) return ['No session estimate'];

    const models = [...usage.models].sort((a, b) => {
      const aTotal =
        this.display === 'tokens' ? this.modelTotalTokens(a) : a.credits;
      const bTotal =
        this.display === 'tokens' ? this.modelTotalTokens(b) : b.credits;
      const primary =
        this.sort === 'responses' ? b.responses - a.responses : bTotal - aTotal;
      return primary || bTotal - aTotal || a.model.localeCompare(b.model);
    });
    const lines =
      models.length > 0
        ? models.map((model) => this.renderTableRow(model))
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
        this.renderTableRow(
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
}
