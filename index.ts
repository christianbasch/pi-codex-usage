import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {
  countRemainingWeekendDays,
  daysElapsedInPeriod,
  type GroupBy,
} from './src/analytics.ts';
import { AnalyticsCoordinator } from './src/analytics-loader.ts';
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
  let usageRefreshGeneration = 0;
  let statusSpinnerFrame = 0;
  let statusSpinnerInterval: ReturnType<typeof setInterval> | undefined;
  let statusSpinnerContext: ExtensionContext | undefined;
  const analyticsCoordinator = new AnalyticsCoordinator();

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
  ): Promise<MonthlyUsage | undefined> {
    refreshAbortController?.abort();
    const controller = new AbortController();
    refreshAbortController = controller;

    isRefreshing = true;
    statusSpinnerFrame = 0;
    syncStatus(ctx);

    try {
      const accessToken = await (accessTokenPromise ??
        ctx.modelRegistry.getApiKeyForProvider(PROVIDER));
      if (refreshAbortController !== controller) return undefined;
      if (!accessToken) {
        statusError = 'Sign in with /login openai-codex';
        monthlyUsage = undefined;
        return undefined;
      }

      const usage = await fetchMonthlyUsage(accessToken, controller.signal);
      if (refreshAbortController !== controller) return undefined;
      if (!usage) {
        statusError = 'No individual monthly credit limit';
        return undefined;
      }
      monthlyUsage = usage;
      statusError = undefined;
      return usage;
    } catch (error) {
      if (refreshAbortController !== controller) return undefined;
      if (error instanceof Error && error.name === 'AbortError') {
        return undefined;
      }
      statusError = 'Usage unavailable';
      monthlyUsage = undefined;
      return undefined;
    } finally {
      if (refreshAbortController === controller) {
        refreshAbortController = undefined;
        isRefreshing = false;
        syncStatus(ctx);
      }
    }
  }

  interface UsageRefresh {
    generation: number;
    promise: Promise<MonthlyUsage | undefined>;
  }

  function startUsageRefresh(
    ctx: ExtensionContext,
    accessTokenPromise?: Promise<string | undefined>
  ): UsageRefresh {
    const generation = ++usageRefreshGeneration;
    return {
      generation,
      promise: refreshUsage(ctx, accessTokenPromise),
    };
  }

  function isCurrentUsageRefresh(generation: number): boolean {
    return generation === usageRefreshGeneration;
  }

  function refreshUsageAndPrefetch(ctx: ExtensionContext): void {
    const accessTokenPromise = ctx.modelRegistry.getApiKeyForProvider(PROVIDER);
    const cachedResetAt = monthlyUsage?.resetAt;
    if (cachedResetAt !== undefined) {
      void analyticsCoordinator.prefetch(
        () => accessTokenPromise,
        cachedResetAt
      );
    }

    const refresh = startUsageRefresh(ctx, accessTokenPromise);
    void refresh.promise.then((usage) => {
      if (
        !isCurrentUsageRefresh(refresh.generation) ||
        !usage ||
        cachedResetAt === usage.resetAt
      ) {
        return;
      }
      void analyticsCoordinator.prefetch(
        () => accessTokenPromise,
        usage.resetAt
      );
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
      const initialAnalyticsPromise = accessTokenPromise
        ? analyticsCoordinator.load(() => accessTokenPromise, {
            resetAt: initialResetAt,
            groupBy: 'day',
            currentPeriodOnly: true,
          })
        : undefined;

      const previousUsage = monthlyUsage;
      const monthlyRefresh = startUsageRefresh(ctx, accessTokenPromise);
      let usage: MonthlyUsage;
      if (ctx.mode !== 'tui' || !previousUsage) {
        const refreshed = await monthlyRefresh.promise;
        if (!isCurrentUsageRefresh(monthlyRefresh.generation)) {
          return;
        }
        if (!refreshed) {
          analyticsCoordinator.cancelAll();
          ctx.ui.notify(
            statusError ?? 'No individual monthly credit limit',
            'warning'
          );
          return;
        }
        usage = refreshed;
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
            resetAt: number | undefined,
            currentPeriodOnly: boolean,
            showLoading: boolean
          ): Promise<boolean> => {
            if (showLoading) modal.setAnalyticsLoading(groupBy);
            const generation = analyticsGeneration;
            return analyticsCoordinator
              .load(() => ctx.modelRegistry.getApiKeyForProvider(PROVIDER), {
                resetAt,
                groupBy,
                currentPeriodOnly,
              })
              .then((analytics) => {
                if (
                  generation !== analyticsGeneration ||
                  modal.signal.aborted
                ) {
                  return false;
                }
                if (!analytics) {
                  modal.setAnalyticsError(groupBy);
                  return false;
                }
                modal.setAnalytics(analytics);
                if (!currentPeriodOnly) fullAnalyticsLoaded.add(groupBy);
                return true;
              });
          };

          const preloadAnalytics = (resetAt: number): void => {
            void loadAnalytics('day', resetAt, false, false);
            void loadAnalytics('week', resetAt, false, false);
          };

          const reloadAnalytics = (
            resetAt: number | undefined,
            priorityGroup: GroupBy
          ): void => {
            analyticsCoordinator.cancelAll();
            analyticsGeneration += 1;
            fullAnalyticsLoaded.clear();
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
              const resetAt = dashboardUsage.resetAt;
              reloadAnalytics(resetAt, groupBy);
              const monthlyRefresh = startUsageRefresh(ctx);
              void monthlyRefresh.promise.then((nextUsage) => {
                if (
                  modal.signal.aborted ||
                  !isCurrentUsageRefresh(monthlyRefresh.generation)
                ) {
                  return;
                }
                if (!nextUsage) {
                  ctx.ui.notify(statusError ?? 'Usage unavailable', 'warning');
                  return;
                }
                refreshModalUsage(nextUsage);
                if (nextUsage.resetAt !== resetAt) {
                  reloadAnalytics(nextUsage.resetAt, groupBy);
                }
              });
            },
            onClose: () => {
              analyticsCoordinator.cancelAll();
              analyticsGeneration += 1;
              done();
            },
          });

          const cached = analyticsCoordinator.getCached(usage.resetAt);
          if (cached) modal.setAnalytics(cached);
          modal.setAnalyticsLoading('day');

          if (previousUsage) {
            void monthlyRefresh.promise.then((nextUsage) => {
              if (
                modal.signal.aborted ||
                !isCurrentUsageRefresh(monthlyRefresh.generation)
              ) {
                return;
              }
              if (!nextUsage) {
                ctx.ui.notify(statusError ?? 'Usage unavailable', 'warning');
                return;
              }
              const resetChanged = dashboardUsage.resetAt !== nextUsage.resetAt;
              refreshModalUsage(nextUsage);
              if (resetChanged) {
                reloadAnalytics(nextUsage.resetAt, modal.selectedGroup);
              }
            });
          }

          const initialGeneration = analyticsGeneration;
          const initialDailyLoad = initialAnalyticsPromise
            ? initialAnalyticsPromise.then((analytics) => {
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
                modal.setAnalytics(analytics);
                return true;
              })
            : loadAnalytics('day', usage.resetAt, true, true);
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
