import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import type { DayPolicy } from './config.ts';
import { formatCredits, formatRemainingTime } from './format.ts';
import type { MonthlyUsage } from './monthly-usage.ts';
import {
  estimateSessionCredits,
  formatSessionCreditSummary,
} from './session-usage.ts';
import type { UsageRefresh, UsageRuntime } from './usage-runtime.ts';
import { formatResetAt, minutesRemainingForPolicy } from './usage-summary.ts';

export interface UsageCommandDeps {
  usageRuntime: UsageRuntime;
  getDayPolicy(): DayPolicy;
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
