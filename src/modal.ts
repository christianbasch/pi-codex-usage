import type { Theme } from '@earendil-works/pi-coding-agent';
import {
  type Component,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from '@earendil-works/pi-tui';
import packageJson from '../package.json' with { type: 'json' };
import {
  AccountTab,
  type AccountTabData,
  type AccountTabMonthlyUsage,
  type AccountTabSummary,
} from './account-tab.ts';
import type { GroupBy } from './analytics.ts';
import type { DayPolicy } from './config.ts';
import { padLines, wrapLegend } from './legend.ts';
import { SessionTab } from './session-tab.ts';
import type { SessionCreditUsage } from './session-usage.ts';
import type { Viewport } from './viewport.ts';

type Tab = 'account' | 'session';

interface RenderRequester {
  requestRender(): void;
}

interface UsageModalOptions {
  monthlyUsed: number;
  monthlyLimit: number;
  monthlyRemaining?: number;
  monthlyPercent: number;
  monthlyRemainingPercent: number;
  avgDailyUsed: number | undefined;
  dailyBudget: number | undefined;
  resetAt: number | undefined;
  resetLabel: string;
  minutesLeft: number | undefined;
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

const CHART_ROWS = 8;

export class UsageModal implements Component {
  private tab: Tab = 'account';
  private readonly accountTab: AccountTab;
  private readonly sessionTab: SessionTab;
  private readonly abortController = new AbortController();

  constructor(
    private readonly tui: RenderRequester,
    private readonly theme: Theme,
    private readonly options: UsageModalOptions
  ) {
    const accountData: AccountTabData = {
      monthlyUsed: options.monthlyUsed,
      monthlyLimit: options.monthlyLimit,
      monthlyRemaining: options.monthlyRemaining,
      monthlyPercent: options.monthlyPercent,
      monthlyRemainingPercent: options.monthlyRemainingPercent,
      avgDailyUsed: options.avgDailyUsed,
      dailyBudget: options.dailyBudget,
      resetAt: options.resetAt,
      resetLabel: options.resetLabel,
      minutesLeft: options.minutesLeft,
      projectedOverage: options.projectedOverage,
      daysUntilOut: options.daysUntilOut,
      dayPolicy: options.dayPolicy,
    };
    this.accountTab = new AccountTab(tui, theme, {
      data: accountData,
      formatCredits: options.formatCredits,
      onDayPolicyChange: options.onDayPolicyChange,
      onAnalyticsNeeded: options.onAnalyticsNeeded,
    });
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
    return this.accountTab.selectedGroup;
  }

  setAnalyticsLoading(groupBy: GroupBy = this.selectedGroup): void {
    this.accountTab.setAnalyticsLoading(groupBy);
  }

  setAnalytics(analytics: Parameters<AccountTab['setAnalytics']>[0]): void {
    this.accountTab.setAnalytics(analytics);
  }

  setAnalyticsError(groupBy: GroupBy = this.selectedGroup): void {
    this.accountTab.setAnalyticsError(groupBy);
  }

  refreshSummary(summary: AccountTabSummary): void {
    this.accountTab.refreshSummary(summary);
  }

  refreshUsage(
    monthly: AccountTabMonthlyUsage,
    summary: AccountTabSummary
  ): void {
    this.accountTab.refreshUsage(monthly, summary);
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape') || matchesKey(data, 'q')) {
      this.options.onClose();
      return;
    }

    if (matchesKey(data, 'r')) {
      this.options.onRefresh?.(this.selectedGroup);
      this.tui.requestRender();
      return;
    }

    if (matchesKey(data, 'tab')) {
      this.tab = this.tab === 'account' ? 'session' : 'account';
      this.accountTab.resetScroll();
      this.sessionTab.resetScroll();
      this.tui.requestRender();
      return;
    }

    if (this.tab === 'session') {
      this.sessionTab.handleInput(data);
    } else {
      this.accountTab.handleInput(data);
    }
    this.tui.requestRender();
  }

  render(width: number): string[] {
    const innerWidth = Math.max(1, width - 2);
    const border = (text: string) => this.theme.fg('border', text);
    const pad = (text: string) => truncateToWidth(text, innerWidth, '', true);
    const lines: string[] = [];
    const isAccount = this.tab === 'account';

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

    const summaryLines = isAccount
      ? this.accountTab.renderSummaryLines()
      : this.sessionTab.renderSummaryLines();
    for (const line of summaryLines) {
      lines.push(border('│') + pad(` ${line}`) + border('│'));
    }

    lines.push(border('├') + border('─'.repeat(innerWidth)) + border('┤'));
    const legendWidth = Math.max(1, innerWidth - 1);
    const accountControlLines = this.accountTab.renderControlLines(legendWidth);
    const sessionControlLines = this.sessionTab.renderControlLines(legendWidth);
    const controlLines = padLines(
      isAccount ? accountControlLines : sessionControlLines,
      Math.max(accountControlLines.length, sessionControlLines.length)
    );
    for (const controlLine of controlLines) {
      lines.push(border('│') + pad(` ${controlLine}`) + border('│'));
    }

    const accountFooterLines = wrapLegend(
      ['j/k or ↑/↓ scroll', 'Tab scope', 'q/Esc close', 'r ↻'],
      legendWidth
    );
    const sessionFooterLines = wrapLegend(
      ['j/k or ↑/↓ scroll', 'Tab scope', 'q/Esc close', 'r ↻'],
      legendWidth
    );
    const footerLines = padLines(
      isAccount ? accountFooterLines : sessionFooterLines,
      Math.max(accountFooterLines.length, sessionFooterLines.length)
    );
    const accountLegendLines = this.accountTab.renderLegendLines(legendWidth);
    const sessionLegendLines = [this.sessionTab.renderTableHeader()];
    const legendLines = padLines(
      isAccount ? accountLegendLines : sessionLegendLines,
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
    const chartLines = isAccount
      ? this.accountTab.renderChart(innerWidth, chartRows)
      : this.sessionTab.renderTable(chartRows);
    const viewport = isAccount
      ? this.accountTab.viewport
      : this.sessionTab.viewport;
    const trailingRows = isAccount ? 1 : 0;
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
    this.accountTab.dispose();
    this.abortController.abort();
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
}
