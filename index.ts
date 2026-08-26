import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {
  countRemainingWeekendDays,
  daysElapsedInPeriod,
  fetchUsageAnalytics,
  type GroupBy,
  mergeUsageAnalytics,
  type UsageAnalyticsPatch,
} from './src/analytics.ts';
import {
  type DayPolicy,
  dayPolicyLabel,
  loadConfig,
  saveConfig,
} from './src/config.ts';
import { UsageModal } from './src/modal.ts';
import {
  estimateSessionCredits,
  formatSessionCreditSummary,
} from './src/session-usage.ts';
import {
  buildStatusSegments,
  SPINNER_FRAMES,
  SPINNER_INTERVAL_MS,
} from './src/status.ts';
import {
  daysUntilReset,
  fetchMonthlyUsage,
  type MonthlyUsage,
} from './src/usage.ts';

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

function daysRemainingForPolicy(
  usage: MonthlyUsage,
  policy: DayPolicy
): number | undefined {
  const calendarDays = daysUntilReset(usage.resetAfterSeconds);
  if (policy === 'calendar' || calendarDays === undefined) return calendarDays;
  return Math.max(0, calendarDays - countRemainingWeekendDays(usage.resetAt));
}

export default function codexUsageExtension(pi: ExtensionAPI) {
  let monthlyUsage: MonthlyUsage | undefined;
  let dayPolicy: DayPolicy = loadConfig().dayPolicy;
  let statusError: string | undefined;
  let isRefreshing = false;
  let isCodexSelected = false;
  let refreshAbortController: AbortController | undefined;
  let statusSpinnerFrame = 0;
  let statusSpinnerInterval: ReturnType<typeof setInterval> | undefined;
  let statusSpinnerContext: ExtensionContext | undefined;
  let cachedAnalytics: UsageAnalyticsPatch | undefined;
  let cachedAnalyticsResetAt: number | undefined;
  let analyticsPrefetch:
    | {
        resetAt: number;
        controller: AbortController;
        promise: Promise<UsageAnalyticsPatch | undefined>;
      }
    | undefined;

  function stopStatusSpinner(): void {
    if (statusSpinnerInterval !== undefined) {
      clearInterval(statusSpinnerInterval);
      statusSpinnerInterval = undefined;
    }
    statusSpinnerContext = undefined;
  }

  function startStatusSpinner(ctx: ExtensionContext): void {
    statusSpinnerContext = ctx;
    if (statusSpinnerInterval !== undefined) return;
    statusSpinnerInterval = setInterval(() => {
      const spinnerContext = statusSpinnerContext;
      if (!isRefreshing || !isCodexSelected || !spinnerContext) {
        stopStatusSpinner();
        return;
      }
      statusSpinnerFrame = (statusSpinnerFrame + 1) % SPINNER_FRAMES.length;
      syncStatus(spinnerContext);
    }, SPINNER_INTERVAL_MS);
  }

  function renderUsageStatus(ctx: ExtensionContext): string {
    if (monthlyUsage) {
      const days = daysRemainingForPolicy(monthlyUsage, dayPolicy);
      const elapsed = daysElapsedInPeriod(monthlyUsage.resetAt);
      const avgDailyUsed = elapsed ? monthlyUsage.used / elapsed : undefined;
      const dailyBudget = days ? monthlyUsage.remaining / days : undefined;
      const paceRatio =
        avgDailyUsed && dailyBudget ? avgDailyUsed / dailyBudget : undefined;
      const { base, pace } = buildStatusSegments(
        monthlyUsage.usedPercent,
        monthlyUsage.limit,
        paceRatio,
        formatCredits
      );
      const modeHint = dayPolicy === 'weekdays' ? ' [wd]' : ' [cal]';
      return (
        ctx.ui.theme.fg('muted', base) +
        (pace ? ctx.ui.theme.fg(pace.color, pace.text) : '') +
        ctx.ui.theme.fg('dim', modeHint)
      );
    }

    const text = statusError ?? 'No individual monthly credit limit';
    return ctx.ui.theme.fg('muted', `[Usage: ${text}]`);
  }

  function syncStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) {
      stopStatusSpinner();
      return;
    }

    if (!isCodexSelected) {
      stopStatusSpinner();
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }

    if (isRefreshing) {
      startStatusSpinner(ctx);
      const spinner =
        SPINNER_FRAMES[statusSpinnerFrame] ?? SPINNER_FRAMES[0] ?? '⠋';
      const status =
        monthlyUsage || statusError ? ` ${renderUsageStatus(ctx)}` : '';
      ctx.ui.setStatus(
        STATUS_KEY,
        `${ctx.ui.theme.fg('muted', spinner)}${status}`
      );
      return;
    }

    stopStatusSpinner();
    ctx.ui.setStatus(STATUS_KEY, renderUsageStatus(ctx));
  }

  async function refreshUsage(
    ctx: ExtensionContext,
    accessTokenPromise?: Promise<string | undefined>
  ): Promise<boolean> {
    refreshAbortController?.abort();
    const controller = new AbortController();
    refreshAbortController = controller;

    isRefreshing = true;
    statusSpinnerFrame = 0;
    syncStatus(ctx);

    try {
      const accessToken = await (accessTokenPromise ??
        ctx.modelRegistry.getApiKeyForProvider(PROVIDER));
      if (!accessToken) {
        statusError = 'Sign in with /login openai-codex';
        monthlyUsage = undefined;
        return false;
      }

      monthlyUsage = await fetchMonthlyUsage(accessToken, controller.signal);
      if (!monthlyUsage) {
        statusError = 'No individual monthly credit limit';
        return false;
      }
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

  function cacheAnalytics(
    resetAt: number,
    analytics: UsageAnalyticsPatch
  ): void {
    if (cachedAnalyticsResetAt !== resetAt) cachedAnalytics = undefined;
    cachedAnalyticsResetAt = resetAt;
    cachedAnalytics = mergeUsageAnalytics(cachedAnalytics, analytics);
  }

  function getCachedAnalytics(): UsageAnalyticsPatch | undefined {
    return cachedAnalytics;
  }

  function cancelAnalyticsPrefetch(): void {
    const prefetch = analyticsPrefetch;
    analyticsPrefetch = undefined;
    prefetch?.controller.abort();
  }

  function prefetchAnalytics(
    ctx: ExtensionContext,
    resetAt: number
  ): Promise<UsageAnalyticsPatch | undefined> {
    if (cachedAnalyticsResetAt === resetAt && cachedAnalytics?.daily) {
      return Promise.resolve(cachedAnalytics);
    }
    if (analyticsPrefetch?.resetAt === resetAt) {
      return analyticsPrefetch.promise;
    }

    cancelAnalyticsPrefetch();
    const controller = new AbortController();
    const promise = (async () => {
      try {
        const accessToken =
          await ctx.modelRegistry.getApiKeyForProvider(PROVIDER);
        if (!accessToken) return undefined;
        const analytics = await fetchUsageAnalytics(
          accessToken,
          controller.signal,
          resetAt,
          new Date(),
          'day',
          true
        );
        if (!controller.signal.aborted) {
          cacheAnalytics(resetAt, analytics);
          return analytics;
        }
      } catch {
        // Boot-time prefetch is best effort; the dashboard will retry.
      }
      return undefined;
    })();
    analyticsPrefetch = { resetAt, controller, promise };
    void promise.then(() => {
      if (analyticsPrefetch?.promise === promise) analyticsPrefetch = undefined;
    });
    return promise;
  }

  function refreshUsageAndPrefetch(ctx: ExtensionContext): void {
    const cachedResetAt = monthlyUsage?.resetAt;
    if (cachedResetAt !== undefined) {
      prefetchAnalytics(ctx, cachedResetAt);
    }

    void refreshUsage(ctx).then((refreshed) => {
      if (refreshed && monthlyUsage && cachedResetAt !== monthlyUsage.resetAt) {
        prefetchAnalytics(ctx, monthlyUsage.resetAt);
      }
    });
  }

  function setDayPolicy(policy: DayPolicy, ctx: ExtensionContext): void {
    dayPolicy = policy;
    saveConfig({ dayPolicy });
    syncStatus(ctx);
    ctx.ui.notify(`Usage mode: ${dayPolicyLabel(dayPolicy)}`, 'info');
  }

  function calculateSummary(usage: MonthlyUsage, policy: DayPolicy) {
    const days = daysRemainingForPolicy(usage, policy);
    const daysElapsed = daysElapsedInPeriod(usage.resetAt);
    const dailyBudget = days ? usage.remaining / days : undefined;
    const avgDailyUsed = daysElapsed ? usage.used / daysElapsed : undefined;
    const projectedOverage =
      avgDailyUsed && days
        ? usage.used + avgDailyUsed * days - usage.limit
        : undefined;
    const daysUntilOut = avgDailyUsed
      ? usage.remaining / avgDailyUsed
      : undefined;
    return {
      days,
      daysLeft: days,
      avgDailyUsed,
      dailyBudget,
      projectedOverage,
      daysUntilOut,
    };
  }

  pi.registerCommand('usage', {
    description: 'Show the OpenAI Codex monthly usage dashboard',
    handler: async (_args, ctx) => {
      const accessTokenPromise =
        ctx.mode === 'tui'
          ? ctx.modelRegistry.getApiKeyForProvider(PROVIDER)
          : undefined;
      const initialResetAt = monthlyUsage?.resetAt;
      const pendingAnalytics =
        initialResetAt !== undefined &&
        analyticsPrefetch?.resetAt === initialResetAt
          ? analyticsPrefetch.promise
          : undefined;
      const initialAnalyticsController =
        ctx.mode === 'tui' && !pendingAnalytics
          ? new AbortController()
          : undefined;
      const initialAnalyticsPromise =
        pendingAnalytics ??
        (accessTokenPromise && initialAnalyticsController
          ? accessTokenPromise
              .then((accessToken) => {
                if (!accessToken) {
                  throw new Error('No OpenAI Codex credentials');
                }
                return fetchUsageAnalytics(
                  accessToken,
                  initialAnalyticsController.signal,
                  initialResetAt,
                  new Date(),
                  'day',
                  true
                );
              })
              .catch(() => undefined)
          : undefined);

      const previousUsage = monthlyUsage;
      const monthlyRefresh = refreshUsage(ctx, accessTokenPromise);
      let usage: MonthlyUsage;
      if (ctx.mode !== 'tui' || !previousUsage) {
        const refreshed = await monthlyRefresh;
        if (!refreshed || !monthlyUsage) {
          initialAnalyticsController?.abort();
          ctx.ui.notify(
            statusError ?? 'No individual monthly credit limit',
            'warning'
          );
          return;
        }
        usage = monthlyUsage;
      } else {
        usage = previousUsage;
      }
      const summary = calculateSummary(usage, dayPolicy);
      const {
        days,
        avgDailyUsed,
        dailyBudget,
        projectedOverage,
        daysUntilOut,
      } = summary;
      const provider = ctx.model?.provider ?? 'No model selected';
      const resetLabel = formatResetAt(usage.resetAt);
      const sessionEntries = ctx.sessionManager.getEntries();
      const sessionBranch = ctx.sessionManager.getBranch();
      const sessionCreditUsage = estimateSessionCredits(sessionBranch);
      const wholeSessionCreditUsage = estimateSessionCredits(sessionEntries);
      const sessionSummary = formatSessionCreditSummary(
        wholeSessionCreditUsage,
        formatCredits
      );

      if (ctx.mode !== 'tui') {
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
        return;
      }

      await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) => {
          let modal: UsageModal;
          let dashboardUsage = usage;
          let analyticsGeneration = 0;
          let initialDailyLoad: Promise<boolean> | undefined;
          let initialRefreshSuperseded = false;
          const analyticsLoads = new Map<string, Promise<boolean>>();
          const fullAnalyticsLoaded = new Set<GroupBy>();

          const refreshModalUsage = (nextUsage: MonthlyUsage): void => {
            dashboardUsage = nextUsage;
            modal.refreshUsage(
              {
                monthlyUsed: nextUsage.used,
                monthlyLimit: nextUsage.limit,
                monthlyPercent: nextUsage.usedPercent,
                monthlyRemainingPercent: nextUsage.remainingPercent,
                resetAt: nextUsage.resetAt,
                resetLabel: formatResetAt(nextUsage.resetAt),
              },
              calculateSummary(nextUsage, dayPolicy)
            );
          };

          const loadAnalytics = (
            groupBy: GroupBy,
            resetAt: number,
            currentPeriodOnly: boolean,
            showLoading: boolean
          ): Promise<boolean> => {
            const key = `${groupBy}:${currentPeriodOnly ? 'current' : 'full'}`;
            const existingLoad = analyticsLoads.get(key);
            if (existingLoad) {
              if (showLoading) modal.setAnalyticsLoading(groupBy);
              return existingLoad;
            }

            const generation = analyticsGeneration;
            if (showLoading) modal.setAnalyticsLoading(groupBy);
            const promise = (async () => {
              try {
                const accessToken =
                  await ctx.modelRegistry.getApiKeyForProvider(PROVIDER);
                if (!accessToken) {
                  throw new Error('No OpenAI Codex credentials');
                }
                const analytics = await fetchUsageAnalytics(
                  accessToken,
                  modal.signal,
                  resetAt,
                  new Date(),
                  groupBy,
                  currentPeriodOnly
                );
                if (generation !== analyticsGeneration) return false;
                cacheAnalytics(resetAt, analytics);
                modal.setAnalytics(analytics, groupBy);
                if (!currentPeriodOnly) fullAnalyticsLoaded.add(groupBy);
                return true;
              } catch {
                if (generation === analyticsGeneration) {
                  modal.setAnalyticsError(groupBy);
                }
                return false;
              }
            })();
            analyticsLoads.set(key, promise);
            void promise.then(() => {
              if (analyticsLoads.get(key) === promise) {
                analyticsLoads.delete(key);
              }
            });
            return promise;
          };

          const preloadAnalytics = (resetAt: number): void => {
            void loadAnalytics('day', resetAt, false, false);
            void loadAnalytics('week', resetAt, false, false);
          };

          const reloadAnalytics = (
            resetAt: number,
            priorityGroup: GroupBy
          ): void => {
            initialAnalyticsController?.abort();
            cancelAnalyticsPrefetch();
            analyticsGeneration += 1;
            analyticsLoads.clear();
            fullAnalyticsLoaded.clear();
            initialDailyLoad = undefined;
            const otherGroup: GroupBy =
              priorityGroup === 'day' ? 'week' : 'day';
            modal.setAnalyticsLoading(priorityGroup);
            modal.setAnalyticsLoading(otherGroup);
            void loadAnalytics(priorityGroup, resetAt, false, false);
            void loadAnalytics(otherGroup, resetAt, false, false);
          };

          modal = new UsageModal(tui, theme, {
            monthlyUsed: usage.used,
            monthlyLimit: usage.limit,
            monthlyPercent: usage.usedPercent,
            monthlyRemainingPercent: usage.remainingPercent,
            avgDailyUsed,
            dailyBudget,
            resetAt: usage.resetAt,
            resetLabel,
            daysLeft: days,
            projectedOverage,
            daysUntilOut,
            formatCredits,
            sessionCreditUsage,
            wholeSessionCreditUsage,
            dayPolicy,
            onDayPolicyChange: (policy) => {
              setDayPolicy(policy, ctx);
              modal.refreshSummary(calculateSummary(dashboardUsage, policy));
            },
            onAnalyticsNeeded: (groupBy) => {
              if (!fullAnalyticsLoaded.has(groupBy)) {
                void loadAnalytics(
                  groupBy,
                  dashboardUsage.resetAt,
                  false,
                  true
                );
              }
            },
            onRefresh: (groupBy) => {
              initialRefreshSuperseded = true;
              const resetAt = dashboardUsage.resetAt;
              reloadAnalytics(resetAt, groupBy);
              void (async () => {
                const refreshed = await refreshUsage(ctx);
                if (!refreshed || !monthlyUsage) {
                  ctx.ui.notify(statusError ?? 'Usage unavailable', 'warning');
                  return;
                }
                const nextUsage = monthlyUsage;
                refreshModalUsage(nextUsage);
                if (nextUsage.resetAt !== resetAt) {
                  reloadAnalytics(nextUsage.resetAt, groupBy);
                }
              })();
            },
            onClose: () => {
              initialAnalyticsController?.abort();
              analyticsGeneration += 1;
              done();
            },
          });

          const cached = getCachedAnalytics();
          if (cached) modal.setAnalytics(cached);
          modal.setAnalyticsLoading('day');

          if (previousUsage) {
            void monthlyRefresh.then((refreshed) => {
              if (modal.signal.aborted || initialRefreshSuperseded) {
                return;
              }
              if (!refreshed || !monthlyUsage) {
                ctx.ui.notify(statusError ?? 'Usage unavailable', 'warning');
                return;
              }
              const nextUsage = monthlyUsage;
              const resetChanged = dashboardUsage.resetAt !== nextUsage.resetAt;
              refreshModalUsage(nextUsage);
              if (resetChanged) {
                reloadAnalytics(nextUsage.resetAt, modal.selectedGroup);
              }
            });
          }

          const initialGeneration = analyticsGeneration;
          if (initialAnalyticsPromise) {
            initialDailyLoad = initialAnalyticsPromise.then((analytics) => {
              if (
                initialGeneration !== analyticsGeneration ||
                modal.signal.aborted
              ) {
                return false;
              }
              if (!analytics) {
                modal.setAnalyticsError('day');
                return false;
              }
              cacheAnalytics(usage.resetAt, analytics);
              modal.setAnalytics(analytics, 'day');
              return true;
            });
          } else {
            initialDailyLoad = loadAnalytics('day', usage.resetAt, true, true);
          }
          void initialDailyLoad.then(() => {
            if (initialGeneration === analyticsGeneration) {
              preloadAnalytics(dashboardUsage.resetAt);
            }
          });

          return modal;
        },
        {
          overlay: true,
          overlayOptions: {
            anchor: 'center',
            width: 100,
            maxHeight: 23,
            margin: 1,
          },
        }
      );
    },
  });

  pi.on('session_start', (_event, ctx) => {
    isCodexSelected = ctx.model?.provider === PROVIDER;

    if (isCodexSelected) {
      refreshUsageAndPrefetch(ctx);
    } else {
      syncStatus(ctx);
    }
  });

  pi.on('model_select', (event, ctx) => {
    isCodexSelected = event.model.provider === PROVIDER;
    if (isCodexSelected) {
      refreshUsageAndPrefetch(ctx);
    } else {
      syncStatus(ctx);
    }
  });
}
