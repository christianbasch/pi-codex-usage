import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {
  countRemainingWeekendDays,
  daysElapsedInPeriod,
  fetchUsageAnalytics,
  type GroupBy,
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
import { buildStatusSegments } from './src/status.ts';
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
      const text =
        ctx.ui.theme.fg('muted', base) +
        (pace ? ctx.ui.theme.fg(pace.color, pace.text) : '') +
        ctx.ui.theme.fg('dim', modeHint);
      ctx.ui.setStatus(STATUS_KEY, text);
      return;
    }

    const text = statusError ?? 'No individual monthly credit limit';
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg('muted', `[Usage: ${text}]`));
  }

  async function refreshUsage(
    ctx: ExtensionContext,
    accessTokenPromise?: Promise<string | undefined>
  ): Promise<boolean> {
    refreshAbortController?.abort();
    const controller = new AbortController();
    refreshAbortController = controller;

    isRefreshing = true;
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
      const initialAnalyticsController =
        ctx.mode === 'tui' ? new AbortController() : undefined;
      const initialResetAt = monthlyUsage?.resetAt;
      const initialAnalyticsPromise =
        accessTokenPromise && initialAnalyticsController
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
          : undefined;

      const refreshed = await refreshUsage(ctx, accessTokenPromise);
      if (!refreshed || !monthlyUsage) {
        initialAnalyticsController?.abort();
        ctx.ui.notify(
          statusError ?? 'No individual monthly credit limit',
          'warning'
        );
        return;
      }

      const usage = monthlyUsage;
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
            if (existingLoad) return existingLoad;

            const generation = analyticsGeneration;
            if (showLoading) modal.setAnalyticsLoading(groupBy);
            const promise = (async () => {
              if (!currentPeriodOnly) {
                const prerequisite =
                  groupBy === 'day'
                    ? analyticsLoads.get(`${groupBy}:current`)
                    : initialDailyLoad;
                if (prerequisite) await prerequisite;
                if (generation !== analyticsGeneration) return false;
              }

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
                modal.setAnalytics(analytics);
                if (!currentPeriodOnly) fullAnalyticsLoaded.add(groupBy);
                return true;
              } catch {
                if (generation === analyticsGeneration) {
                  modal.setAnalyticsError();
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
              void (async () => {
                const refreshed = await refreshUsage(ctx);
                if (!refreshed || !monthlyUsage) {
                  ctx.ui.notify(statusError ?? 'Usage unavailable', 'warning');
                  return;
                }
                refreshModalUsage(monthlyUsage);
                initialAnalyticsController?.abort();
                analyticsGeneration += 1;
                analyticsLoads.clear();
                fullAnalyticsLoaded.clear();
                initialDailyLoad = undefined;
                modal.clearAnalytics();
                const generation = analyticsGeneration;
                void loadAnalytics(
                  groupBy,
                  monthlyUsage.resetAt,
                  false,
                  true
                ).then(() => {
                  if (generation === analyticsGeneration) {
                    preloadAnalytics(monthlyUsage!.resetAt);
                  }
                });
              })();
            },
            onClose: () => {
              initialAnalyticsController?.abort();
              done();
            },
          });

          const initialGeneration = analyticsGeneration;
          if (initialAnalyticsPromise) {
            initialDailyLoad = initialAnalyticsPromise.then((analytics) => {
              if (initialGeneration !== analyticsGeneration) return false;
              if (!analytics) {
                modal.setAnalyticsError();
                return false;
              }
              modal.setAnalytics(analytics);
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
