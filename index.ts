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
import { isCurrentPeriod } from './src/monthly-usage.ts';
import { buildStatusSegments, type StatusSegment } from './src/status.ts';
import { StatusShimmer } from './src/status-shimmer.ts';
import { registerUsageCommand } from './src/usage-command.ts';
import {
  openUsageDashboard,
  type UsageDashboardDeps,
} from './src/usage-dashboard.ts';
import { UsageRuntime } from './src/usage-runtime.ts';

const STATUS_KEY = '00-codex-usage';
const PROVIDER = 'openai-codex';
const USAGE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export default function codexUsageExtension(pi: ExtensionAPI) {
  let dayPolicy: DayPolicy = loadConfig().dayPolicy;
  let isCodexSelected = false;
  let currentCtx: ExtensionContext | undefined;
  let lastStatusSegments: StatusSegment[] | undefined;
  let sessionUpdateHandler: ((ctx: ExtensionContext) => void) | undefined;
  let usageRefreshTimer: ReturnType<typeof setInterval> | undefined;
  const statusShimmer = new StatusShimmer();
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

  function registerSessionUpdate(
    handler: (ctx: ExtensionContext) => void
  ): () => void {
    sessionUpdateHandler = handler;
    return () => {
      if (sessionUpdateHandler === handler) sessionUpdateHandler = undefined;
    };
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

  function renderStatusSegments(
    ctx: ExtensionContext,
    segments: StatusSegment[]
  ): string {
    return segments
      .map((segment) => {
        const text = ctx.ui.theme.fg(segment.color, segment.text);
        return segment.bold ? ctx.ui.theme.bold(text) : text;
      })
      .join('');
  }

  function syncStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) {
      statusShimmer.clear();
      return;
    }

    if (!isCodexSelected) {
      statusShimmer.clear();
      lastStatusSegments = undefined;
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }

    if (usageRuntime.refreshing) {
      if (lastStatusSegments === undefined) {
        lastStatusSegments = buildStatusSegments(usageRuntime, dayPolicy);
      }
      statusShimmer.begin(
        usageRuntime.refreshGeneration,
        lastStatusSegments,
        () => syncStatus(ctx)
      );
      ctx.ui.setStatus(STATUS_KEY, statusShimmer.render(ctx.ui.theme));
      return;
    }

    if (
      statusShimmer.finish(() => {
        if (currentCtx) syncStatus(currentCtx);
      })
    ) {
      ctx.ui.setStatus(STATUS_KEY, statusShimmer.render(ctx.ui.theme));
      return;
    }

    lastStatusSegments = buildStatusSegments(usageRuntime, dayPolicy);
    ctx.ui.setStatus(STATUS_KEY, renderStatusSegments(ctx, lastStatusSegments));
  }

  function stopPeriodicUsageRefresh(): void {
    if (usageRefreshTimer === undefined) return;
    clearInterval(usageRefreshTimer);
    usageRefreshTimer = undefined;
  }

  function startPeriodicUsageRefresh(): void {
    stopPeriodicUsageRefresh();
    usageRefreshTimer = setInterval(() => {
      if (!isCodexSelected || !currentCtx) return;
      void startUsageRefresh(currentCtx).promise;
    }, USAGE_REFRESH_INTERVAL_MS);
    usageRefreshTimer.unref();
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
    statusShimmer.clear();
    lastStatusSegments = undefined;
    syncStatus(ctx);
    ctx.ui.notify(`Usage mode: ${dayPolicyLabel(dayPolicy)}`, 'info');
  }

  const dashboardDeps: UsageDashboardDeps = {
    usageRuntime,
    analyticsCoordinator,
    getDayPolicy: () => dayPolicy,
    setDayPolicy,
    getAccessToken,
    registerSessionUpdate,
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
      startPeriodicUsageRefresh();
    } else {
      stopPeriodicUsageRefresh();
      syncStatus(ctx);
    }
  });

  pi.on('session_shutdown', (_event, ctx) => {
    currentCtx = ctx;
    sessionUpdateHandler = undefined;
    stopPeriodicUsageRefresh();
    statusShimmer.clear();
    lastStatusSegments = undefined;
    usageRuntime.shutdown();
    analyticsCoordinator.cancelAll();
    if (ctx.hasUI) ctx.ui.setStatus(STATUS_KEY, undefined);
  });

  pi.on('message_end', (_event, ctx) => {
    setTimeout(() => sessionUpdateHandler?.(ctx), 0);
  });

  pi.on('turn_end', (_event, ctx) => {
    sessionUpdateHandler?.(ctx);
  });

  pi.on('agent_settled', (_event, ctx) => {
    sessionUpdateHandler?.(ctx);
  });

  pi.on('session_compact', (_event, ctx) => {
    sessionUpdateHandler?.(ctx);
  });

  pi.on('session_tree', (_event, ctx) => {
    sessionUpdateHandler?.(ctx);
  });

  pi.on('model_select', (event, ctx) => {
    currentCtx = ctx;
    isCodexSelected = event.model.provider === PROVIDER;
    if (isCodexSelected) {
      refreshUsageAndPrefetch(ctx);
      startPeriodicUsageRefresh();
    } else {
      stopPeriodicUsageRefresh();
      syncStatus(ctx);
    }
  });
}
