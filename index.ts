import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { AnalyticsCoordinator } from './src/analytics-coordinator.ts';
import {
  type DayPolicy,
  dayPolicyLabel,
  loadConfig,
  saveConfig,
} from './src/config.ts';
import { formatCredits } from './src/format.ts';
import { isCurrentPeriod } from './src/monthly-usage.ts';
import { Spinner } from './src/spinner.ts';
import { buildStatusSegments } from './src/status.ts';
import { registerUsageCommand } from './src/usage-command.ts';
import {
  openUsageDashboard,
  type UsageDashboardDeps,
} from './src/usage-dashboard.ts';
import { UsageRuntime } from './src/usage-runtime.ts';
import { calculatePaceRatio } from './src/usage-summary.ts';

const STATUS_KEY = '00-codex-usage';
const PROVIDER = 'openai-codex';

export default function codexUsageExtension(pi: ExtensionAPI) {
  let dayPolicy: DayPolicy = loadConfig().dayPolicy;
  let isCodexSelected = false;
  let currentCtx: ExtensionContext | undefined;
  let lastSpinnerGeneration = 0;
  let lastRenderedStatus: string | undefined;
  const statusSpinner = new Spinner();
  const analyticsCoordinator = new AnalyticsCoordinator();

  const usageRuntime = new UsageRuntime(() =>
    currentCtx
      ? currentCtx.modelRegistry.getApiKeyForProvider(PROVIDER)
      : Promise.resolve(undefined)
  );
  usageRuntime.subscribe(() => {
    if (currentCtx) syncStatus(currentCtx);
  });

  function getAccessToken(ctx: ExtensionContext): Promise<string | undefined> {
    return ctx.modelRegistry.getApiKeyForProvider(PROVIDER);
  }

  function startUsageRefresh(
    ctx: ExtensionContext,
    accessTokenPromise?: Promise<string | undefined>
  ) {
    currentCtx = ctx;
    return usageRuntime.startRefresh(
      accessTokenPromise ? () => accessTokenPromise : undefined
    );
  }

  function renderUsageStatus(ctx: ExtensionContext): string {
    const monthlyUsage = usageRuntime.currentUsage;
    if (monthlyUsage) {
      const paceRatio = calculatePaceRatio(monthlyUsage, dayPolicy);
      const { base, baseColor, pace } = buildStatusSegments(
        monthlyUsage.usedPercent,
        monthlyUsage.limit,
        paceRatio,
        formatCredits
      );
      const modeHint = dayPolicy === 'weekdays' ? ' [wkd]' : ' [cal]';
      return (
        ctx.ui.theme.fg(baseColor, base) +
        (pace ? ctx.ui.theme.fg(pace.color, pace.text) : '') +
        ctx.ui.theme.fg('dim', modeHint)
      );
    }

    const text = usageRuntime.error ?? 'No individual monthly credit limit';
    return ctx.ui.theme.fg('muted', `[Usage: ${text}]`);
  }

  function syncStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) {
      statusSpinner.stop();
      return;
    }

    if (!isCodexSelected) {
      statusSpinner.stop();
      lastRenderedStatus = undefined;
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }

    if (usageRuntime.refreshing) {
      if (lastSpinnerGeneration !== usageRuntime.refreshGeneration) {
        statusSpinner.reset();
        lastSpinnerGeneration = usageRuntime.refreshGeneration;
      }
      statusSpinner.start(() => syncStatus(ctx));
      const spinner = statusSpinner.current;
      if (
        lastRenderedStatus === undefined &&
        (usageRuntime.currentUsage || usageRuntime.error)
      ) {
        lastRenderedStatus = renderUsageStatus(ctx);
      }
      const status = lastRenderedStatus ? ` ${lastRenderedStatus}` : '';
      ctx.ui.setStatus(
        STATUS_KEY,
        `${ctx.ui.theme.fg('muted', spinner)}${status}`
      );
      return;
    }

    statusSpinner.stop();
    lastRenderedStatus = renderUsageStatus(ctx);
    ctx.ui.setStatus(STATUS_KEY, lastRenderedStatus);
  }

  function refreshUsageAndPrefetch(ctx: ExtensionContext): void {
    const accessTokenPromise = getAccessToken(ctx);
    // Prefetching with a reset that has already passed would cache the
    // previous period's breakdown (and its lastResetDate) for the chart.
    const cachedResetAt = isCurrentPeriod(usageRuntime.currentUsage)
      ? usageRuntime.currentUsage.resetAt
      : undefined;
    if (cachedResetAt !== undefined) {
      void analyticsCoordinator.prefetch(
        () => accessTokenPromise,
        cachedResetAt
      );
    }

    const refresh = startUsageRefresh(ctx, accessTokenPromise);
    usageRuntime.applyRefresh(refresh, {
      onError(): void {
        if (cachedResetAt !== undefined) {
          ctx.ui.notify(usageRuntime.error ?? 'Usage unavailable', 'warning');
        }
      },
      onUsage(nextUsage): void {
        if (cachedResetAt === nextUsage.resetAt) return;
        void analyticsCoordinator.prefetch(
          () => accessTokenPromise,
          nextUsage.resetAt
        );
      },
    });
  }

  function setDayPolicy(policy: DayPolicy, ctx: ExtensionContext): void {
    dayPolicy = policy;
    saveConfig({ dayPolicy });
    lastRenderedStatus = undefined;
    syncStatus(ctx);
    ctx.ui.notify(`Usage mode: ${dayPolicyLabel(dayPolicy)}`, 'info');
  }

  const dashboardDeps: UsageDashboardDeps = {
    usageRuntime,
    analyticsCoordinator,
    getDayPolicy: () => dayPolicy,
    setDayPolicy,
    getAccessToken,
    startUsageRefresh,
  };

  registerUsageCommand(pi, {
    usageRuntime,
    getDayPolicy: () => dayPolicy,
    startUsageRefresh,
    openDashboard: (ctx) => openUsageDashboard(ctx, dashboardDeps),
  });

  pi.on('session_start', (_event, ctx) => {
    currentCtx = ctx;
    isCodexSelected = ctx.model?.provider === PROVIDER;

    if (isCodexSelected) {
      refreshUsageAndPrefetch(ctx);
    } else {
      syncStatus(ctx);
    }
  });

  pi.on('session_shutdown', (_event, ctx) => {
    currentCtx = ctx;
    usageRuntime.shutdown();
    statusSpinner.stop();
    lastRenderedStatus = undefined;
    analyticsCoordinator.cancelAll();
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.on('model_select', (event, ctx) => {
    currentCtx = ctx;
    isCodexSelected = event.model.provider === PROVIDER;
    if (isCodexSelected) {
      refreshUsageAndPrefetch(ctx);
    } else {
      syncStatus(ctx);
    }
  });
}
