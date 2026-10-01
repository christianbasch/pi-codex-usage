import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import type { BudgetDayPolicy } from '../shared/day-policy.ts';
import {
  formatCredits,
  formatRemainingTime,
  formatResetAt,
} from '../shared/format.ts';
import type { MonthlyUsage } from '../shared/usage/monthly-usage.ts';
import {
  estimateSessionCredits,
  formatSessionCreditSummary,
} from '../shared/usage/session-usage.ts';
import type {
  UsageRefresh,
  UsageRuntime,
} from '../shared/usage/usage-runtime.ts';
import { minutesRemainingForPolicy } from '../shared/usage/usage-summary.ts';

export interface UsageCommandDeps {
  usageRuntime: UsageRuntime;
  getDayPolicy(): BudgetDayPolicy;
  startUsageRefresh(ctx: ExtensionContext): UsageRefresh;
  openDashboard(ctx: ExtensionContext): Promise<void>;
}

export function registerUsageCommand(
  pi: ExtensionAPI,
  deps: UsageCommandDeps
): void {
  pi.registerCommand('usage', {
    description: 'Show the OpenAI Codex monthly usage dashboard',
    handler: async (_args, ctx) => {
      if (ctx.mode === 'tui') {
        await deps.openDashboard(ctx);
        return;
      }

      const dayPolicy = deps.getDayPolicy();
      const monthlyRefresh = deps.startUsageRefresh(ctx);
      const refreshed = await monthlyRefresh.promise;
      if (!deps.usageRuntime.isCurrentRefresh(monthlyRefresh.generation)) {
        return;
      }
      if (!refreshed) {
        ctx.ui.notify(
          deps.usageRuntime.error ?? 'No individual monthly credit limit',
          'warning'
        );
        return;
      }

      const usage: MonthlyUsage = refreshed;
      const provider = ctx.model?.provider ?? 'No model selected';
      const resetLabel = formatResetAt(usage.resetAt);
      const remainingMinutes = minutesRemainingForPolicy(usage, dayPolicy);
      const remainingTime = formatRemainingTime(remainingMinutes);
      const sessionEntries = ctx.sessionManager.getEntries();
      const sessionSummary = formatSessionCreditSummary(
        estimateSessionCredits(sessionEntries),
        formatCredits
      );
      ctx.ui.notify(
        [
          provider,
          `Credits: ${formatCredits(usage.used)} / ${formatCredits(usage.limit)} (${Math.round(usage.usedPercent)}%)`,
          `Resets ${resetLabel}` +
            (remainingTime === undefined ? '' : ` · ${remainingTime} left`),
          sessionSummary,
        ].join('\n'),
        'info'
      );
    },
  });
}
