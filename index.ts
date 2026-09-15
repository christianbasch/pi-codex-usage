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
import { buildStatusSegments } from './src/status.ts';
import {
  StatusShimmer,
  type StatusShimmerSegment,
} from './src/status-shimmer.ts';
import { registerUsageCommand } from './src/usage-command.ts';
import {
  openUsageDashboard,
  type UsageDashboardDeps,
} from './src/usage-dashboard.ts';
import { UsageRuntime } from './src/usage-runtime.ts';
import { calculatePaceRatio } from './src/usage-summary.ts';

const STATUS_KEY = '00-codex-usage';
const PROVIDER = 'openai-codex';
const INITIAL_STATUS_SKELETON = '▒▒▒▒▒▒ ▒▒▒▒▒';
const MINIMUM_STATUS_ANIMATION_DURATION_MS = 2_200;
const USAGE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export default function codexUsageExtension(pi: ExtensionAPI) {
  let dayPolicy: DayPolicy = loadConfig().dayPolicy;
  let isCodexSelected = false;
  let currentCtx: ExtensionContext | undefined;
  let lastShimmerGeneration = 0;
  let lastStatusSegments: StatusShimmerSegment[] | undefined;
  let statusAnimationShownAt: number | undefined;
  let statusAnimationTimer: ReturnType<typeof setTimeout> | undefined;
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

  function buildUsageStatusSegments(): StatusShimmerSegment[] {
    const monthlyUsage = usageRuntime.currentUsage;
    if (monthlyUsage) {
      const paceRatio = calculatePaceRatio(monthlyUsage, dayPolicy);
      const { base, baseColor, pace } = buildStatusSegments(
        monthlyUsage.usedPercent,
        monthlyUsage.limit,
        paceRatio,
        formatCredits
      );
      const segments: StatusShimmerSegment[] = [
        { text: base, color: baseColor },
      ];
      if (pace) segments.push(pace);
      segments.push({
        text: dayPolicy === 'weekdays' ? ' [wkd]' : ' [cal]',
        color: 'dim',
        shimmer: false,
      });
      return segments;
    }

    const text = usageRuntime.error ?? 'No individual monthly credit limit';
    return [{ text: `[Usage: ${text}]`, color: 'muted' }];
  }

  function buildInitialSkeletonSegments(): StatusShimmerSegment[] {
    return [
      { text: INITIAL_STATUS_SKELETON, color: 'dim' },
      {
        text: dayPolicy === 'weekdays' ? ' [wkd]' : ' [cal]',
        color: 'dim',
        shimmer: false,
      },
    ];
  }

  function renderStatusSegments(
    ctx: ExtensionContext,
    segments: StatusShimmerSegment[]
  ): string {
    return segments
      .map((segment) => ctx.ui.theme.fg(segment.color, segment.text))
      .join('');
  }

  function clearStatusAnimation(): void {
    if (statusAnimationTimer !== undefined) {
      clearTimeout(statusAnimationTimer);
    }
    statusAnimationTimer = undefined;
    statusAnimationShownAt = undefined;
  }

  function syncStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) {
      statusShimmer.stop();
      return;
    }

    if (!isCodexSelected) {
      statusShimmer.stop();
      clearStatusAnimation();
      lastStatusSegments = undefined;
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }

    if (usageRuntime.refreshing) {
      if (lastShimmerGeneration !== usageRuntime.refreshGeneration) {
        statusShimmer.reset();
        lastShimmerGeneration = usageRuntime.refreshGeneration;
        clearStatusAnimation();
        statusAnimationShownAt = performance.now();
      }
      if (lastStatusSegments === undefined) {
        if (usageRuntime.currentUsage || usageRuntime.error) {
          lastStatusSegments = buildUsageStatusSegments();
        } else {
          lastStatusSegments = buildInitialSkeletonSegments();
        }
      }
      statusShimmer.start(() => syncStatus(ctx));
      ctx.ui.setStatus(
        STATUS_KEY,
        statusShimmer.render(ctx.ui.theme, lastStatusSegments)
      );
      return;
    }

    if (statusAnimationShownAt !== undefined) {
      const remaining =
        MINIMUM_STATUS_ANIMATION_DURATION_MS -
        (performance.now() - statusAnimationShownAt);
      if (remaining > 0) {
        lastStatusSegments ??=
          usageRuntime.currentUsage || usageRuntime.error
            ? buildUsageStatusSegments()
            : buildInitialSkeletonSegments();
        statusShimmer.start(() => syncStatus(ctx));
        if (statusAnimationTimer === undefined) {
          const animationGeneration = usageRuntime.refreshGeneration;
          statusAnimationTimer = setTimeout(() => {
            statusAnimationTimer = undefined;
            if (
              usageRuntime.refreshing ||
              !usageRuntime.isCurrentRefresh(animationGeneration)
            ) {
              return;
            }
            statusAnimationShownAt = undefined;
            lastStatusSegments = undefined;
            if (currentCtx) syncStatus(currentCtx);
          }, remaining);
        }
        ctx.ui.setStatus(
          STATUS_KEY,
          statusShimmer.render(ctx.ui.theme, lastStatusSegments)
        );
        return;
      }
      clearStatusAnimation();
      lastStatusSegments = undefined;
    }

    statusShimmer.stop();
    lastStatusSegments = buildUsageStatusSegments();
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
    clearStatusAnimation();
    usageRuntime.shutdown();
    statusShimmer.stop();
    lastStatusSegments = undefined;
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
