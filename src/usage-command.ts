import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import type { GroupBy } from './analytics.ts';
import type { AnalyticsCoordinator } from './analytics-coordinator.ts';
import type { DayPolicy } from './config.ts';
import { UsageModal } from './modal.ts';
import type { MonthlyUsage } from './monthly-usage.ts';
import {
  estimateSessionCredits,
  formatSessionCreditSummary,
} from './session-usage.ts';
import type { UsageRefresh, UsageRuntime } from './usage-runtime.ts';
import {
  calculateSummary,
  formatCredits,
  formatResetAt,
} from './usage-summary.ts';

export interface UsageCommandDeps {
  usageRuntime: UsageRuntime;
  analyticsCoordinator: AnalyticsCoordinator;
  getDayPolicy(): DayPolicy;
  setDayPolicy(policy: DayPolicy, ctx: ExtensionContext): void;
  getAccessToken(ctx: ExtensionContext): Promise<string | undefined>;
  startUsageRefresh(
    ctx: ExtensionContext,
    accessTokenPromise?: Promise<string | undefined>
  ): UsageRefresh;
}

export function registerUsageCommand(
  pi: ExtensionAPI,
  deps: UsageCommandDeps
): void {
  const {
    usageRuntime,
    analyticsCoordinator,
    getDayPolicy,
    setDayPolicy,
    getAccessToken,
    startUsageRefresh,
  } = deps;

  pi.registerCommand('usage', {
    description: 'Show the OpenAI Codex monthly usage dashboard',
    handler: async (_args, ctx) => {
      const dayPolicy = getDayPolicy();
      const accessTokenPromise =
        ctx.mode === 'tui' ? getAccessToken(ctx) : undefined;
      const initialResetAt = usageRuntime.currentUsage?.resetAt;
      const initialAnalyticsPromise = accessTokenPromise
        ? analyticsCoordinator.load(() => accessTokenPromise, {
            resetAt: initialResetAt,
            groupBy: 'day',
          })
        : undefined;

      const previousUsage = usageRuntime.currentUsage;
      const monthlyRefresh = startUsageRefresh(ctx, accessTokenPromise);
      let usage: MonthlyUsage;
      if (ctx.mode !== 'tui' || !previousUsage) {
        const refreshed = await monthlyRefresh.promise;
        if (!usageRuntime.isCurrentRefresh(monthlyRefresh.generation)) {
          return;
        }
        if (!refreshed) {
          analyticsCoordinator.cancelAll();
          ctx.ui.notify(
            usageRuntime.error ?? 'No individual monthly credit limit',
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
              calculateSummary(nextUsage, getDayPolicy())
            );
          };

          const loadAnalytics = (
            groupBy: GroupBy,
            resetAt: number | undefined,
            showLoading: boolean,
            force = false
          ): Promise<boolean> => {
            if (showLoading) modal.setAnalyticsLoading(groupBy);
            const generation = analyticsGeneration;
            return analyticsCoordinator
              .load(() => getAccessToken(ctx), {
                resetAt,
                groupBy,
                force,
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
                fullAnalyticsLoaded.add(groupBy);
                return true;
              });
          };

          const preloadAnalytics = (resetAt: number): void => {
            void loadAnalytics('day', resetAt, false);
            void loadAnalytics('week', resetAt, false);
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
            void loadAnalytics(priorityGroup, resetAt, false, true);
            void loadAnalytics(otherGroup, resetAt, false, true);
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
              modal.refreshSummary(
                calculateSummary(dashboardUsage, getDayPolicy())
              );
            },
            onAnalyticsNeeded: (groupBy) => {
              if (!fullAnalyticsLoaded.has(groupBy)) {
                void loadAnalytics(groupBy, dashboardUsage.resetAt, true);
              }
            },
            onRefresh: (groupBy) => {
              const resetAt = dashboardUsage.resetAt;
              reloadAnalytics(resetAt, groupBy);
              const monthlyRefresh = startUsageRefresh(ctx);
              usageRuntime.applyRefresh(monthlyRefresh, {
                isStale: () => modal.signal.aborted,
                onError(): void {
                  ctx.ui.notify(
                    usageRuntime.error ?? 'Usage unavailable',
                    'warning'
                  );
                },
                onUsage(nextUsage): void {
                  refreshModalUsage(nextUsage);
                  if (nextUsage.resetAt !== resetAt) {
                    reloadAnalytics(nextUsage.resetAt, groupBy);
                  }
                },
              });
            },
            onClose: () => {
              analyticsCoordinator.cancelAll();
              analyticsGeneration += 1;
              done();
            },
          });

          for (const cached of analyticsCoordinator.getCached(usage.resetAt)) {
            modal.setAnalytics(cached);
          }
          modal.setAnalyticsLoading('day');

          if (previousUsage) {
            usageRuntime.applyRefresh(monthlyRefresh, {
              isStale: () => modal.signal.aborted,
              onError(): void {
                ctx.ui.notify(
                  usageRuntime.error ?? 'Usage unavailable',
                  'warning'
                );
              },
              onUsage(nextUsage): void {
                const resetChanged =
                  dashboardUsage.resetAt !== nextUsage.resetAt;
                refreshModalUsage(nextUsage);
                if (resetChanged) {
                  reloadAnalytics(nextUsage.resetAt, modal.selectedGroup);
                }
              },
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
            : loadAnalytics('day', usage.resetAt, true);
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
}
