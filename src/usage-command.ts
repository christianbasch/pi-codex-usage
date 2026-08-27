import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { formatCredits } from './format.ts';
import type { MonthlyUsage } from './monthly-usage.ts';
import {
  estimateSessionCredits,
  formatSessionCreditSummary,
} from './session-usage.ts';
import {
  openUsageDashboard,
  type UsageDashboardDeps,
} from './usage-dashboard.ts';
import { calculateSummary, formatResetAt } from './usage-summary.ts';

export type UsageCommandDeps = UsageDashboardDeps;

export function registerUsageCommand(
  pi: ExtensionAPI,
  deps: UsageCommandDeps
): void {
  pi.registerCommand('usage', {
    description: 'Show the OpenAI Codex monthly usage dashboard',
    handler: async (_args, ctx) => {
      if (ctx.mode === 'tui') {
        await openUsageDashboard(ctx, deps);
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
      const { days } = calculateSummary(usage, dayPolicy);
      const provider = ctx.model?.provider ?? 'No model selected';
      const resetLabel = formatResetAt(usage.resetAt);
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
            (days === undefined ? '' : ` · ${days.toFixed(1)} days left`),
          sessionSummary,
        ].join('\n'),
        'info'
      );
    },
  });
}
