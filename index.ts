import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {
  daysElapsedInPeriod,
  fetchUsageAnalytics,
  periodLengthDays,
} from './analytics.ts';
import { UsageModal } from './modal.ts';
import { buildStatusSegments } from './status.ts';
import {
  daysUntilReset,
  fetchMonthlyUsage,
  type MonthlyUsage,
} from './usage.ts';

const STATUS_KEY = '00-codex-usage';
const PROVIDER = 'openai-codex';

function formatCredits(value: number): string {
  const displayValue = Math.abs(value) >= 1000 ? value / 1000 : value;
  const suffix = Math.abs(value) >= 1000 ? 'k' : '';
  return (
    new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    }).format(displayValue) + suffix
  );
}

function formatResetAt(resetAt: number): string {
  return new Date(resetAt * 1000).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
}

export default function codexUsageExtension(pi: ExtensionAPI) {
  let monthlyUsage: MonthlyUsage | undefined;
  let statusError: string | undefined;
  let isRefreshing = false;
  let isCodexSelected = false;
  let refreshAbortController: AbortController | undefined;

  function syncStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) return;

    if (!isCodexSelected) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }

    if (isRefreshing) {
      ctx.ui.setStatus(
        STATUS_KEY,
        ctx.ui.theme.fg('muted', '[Usage: refreshing…]')
      );
      return;
    }

    if (monthlyUsage) {
      const days = daysUntilReset(monthlyUsage.resetAt);
      const elapsed = daysElapsedInPeriod(monthlyUsage.resetAt);
      const avgDailyUsed =
        elapsed === 0 ? undefined : monthlyUsage.used / elapsed;
      const dailyBudget =
        days === undefined || days === 0
          ? undefined
          : monthlyUsage.remaining / days;
      const paceRatio =
        avgDailyUsed === undefined ||
        dailyBudget === undefined ||
        dailyBudget === 0
          ? undefined
          : avgDailyUsed / dailyBudget;
      const { base, pace } = buildStatusSegments(
        monthlyUsage.usedPercent,
        monthlyUsage.limit,
        paceRatio,
        formatCredits
      );
      const text =
        ctx.ui.theme.fg('muted', base) +
        (pace ? ctx.ui.theme.fg(pace.color, pace.text) : '');
      ctx.ui.setStatus(STATUS_KEY, text);
      return;
    }

    const text = statusError ?? 'No individual monthly credit limit';
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg('muted', `[Usage: ${text}]`));
  }

  async function refreshUsage(ctx: ExtensionContext): Promise<boolean> {
    refreshAbortController?.abort();
    const controller = new AbortController();
    refreshAbortController = controller;

    isRefreshing = true;
    syncStatus(ctx);

    try {
      const accessToken =
        await ctx.modelRegistry.getApiKeyForProvider(PROVIDER);
      if (!accessToken) {
        statusError = 'Sign in with /login openai-codex';
        monthlyUsage = undefined;
        return false;
      }

      monthlyUsage = await fetchMonthlyUsage(accessToken, controller.signal);
      statusError = undefined;
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return false;
      statusError = 'Usage unavailable';
      monthlyUsage = undefined;
      return false;
    } finally {
      if (refreshAbortController === controller) {
        refreshAbortController = undefined;
        isRefreshing = false;
        syncStatus(ctx);
      }
    }
  }

  pi.registerCommand('usage', {
    description: 'Show the OpenAI Codex monthly usage dashboard',
    handler: async (_args, ctx) => {
      const refreshed = await refreshUsage(ctx);
      if (!refreshed || !monthlyUsage) {
        ctx.ui.notify(
          statusError ?? 'No individual monthly credit limit',
          'warning'
        );
        return;
      }

      const usage = monthlyUsage;
      const days = daysUntilReset(usage.resetAt);
      const provider = ctx.model?.provider ?? 'No model selected';
      const dailyBudget =
        days === undefined || days === 0 ? undefined : usage.remaining / days;
      const resetLabel = formatResetAt(usage.resetAt);

      const daysElapsed = daysElapsedInPeriod(usage.resetAt);
      const pLen = periodLengthDays(usage.resetAt);
      const avgDailyUsed =
        daysElapsed === 0 ? undefined : usage.used / daysElapsed;
      const paceRatio =
        avgDailyUsed === undefined ||
        dailyBudget === undefined ||
        dailyBudget === 0
          ? undefined
          : avgDailyUsed / dailyBudget;
      const projectedOverage =
        avgDailyUsed === undefined || days === undefined
          ? undefined
          : usage.used + avgDailyUsed * (pLen - daysElapsed) - usage.limit;
      const daysUntilOut =
        avgDailyUsed === undefined || avgDailyUsed === 0
          ? undefined
          : usage.remaining / avgDailyUsed;

      if (ctx.mode !== 'tui') {
        ctx.ui.notify(
          [
            provider,
            `Credits: ${formatCredits(usage.used)} / ${formatCredits(usage.limit)} (${Math.round(usage.usedPercent)}%)`,
            `Resets ${resetLabel}` +
              (days === undefined ? '' : ` · ${days.toFixed(1)} days left`),
          ].join('\n'),
          'info'
        );
        return;
      }

      await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) => {
          const modal = new UsageModal(tui, theme, {
            monthlyUsed: usage.used,
            monthlyLimit: usage.limit,
            monthlyPercent: usage.usedPercent,
            avgDailyUsed,
            dailyBudget,
            resetAt: usage.resetAt,
            resetLabel,
            daysLeft: days,
            paceRatio,
            projectedOverage,
            daysUntilOut,
            formatCredits,
            onClose: () => done(),
          });

          void (async () => {
            const accessToken =
              await ctx.modelRegistry.getApiKeyForProvider(PROVIDER);
            if (!accessToken) throw new Error('No OpenAI Codex credentials');
            return fetchUsageAnalytics(
              accessToken,
              modal.signal,
              usage.resetAt
            );
          })()
            .then((analytics) => modal.setAnalytics(analytics))
            .catch(() => modal.setAnalyticsError());

          return modal;
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: 'center',
            width: 100,
            maxHeight: 22,
            margin: 1,
          },
        }
      );
    },
  });

  pi.on('session_start', (_event, ctx) => {
    isCodexSelected = ctx.model?.provider === PROVIDER;

    if (isCodexSelected) {
      void refreshUsage(ctx);
    } else {
      syncStatus(ctx);
    }
  });

  pi.on('model_select', (event, ctx) => {
    isCodexSelected = event.model.provider === PROVIDER;
    if (isCodexSelected) {
      void refreshUsage(ctx);
    } else {
      syncStatus(ctx);
    }
  });
}
