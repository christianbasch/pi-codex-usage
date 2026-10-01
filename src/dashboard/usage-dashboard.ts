import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import type { BudgetDayPolicy, DayPolicy } from '../shared/day-policy.ts';
import { formatCredits, formatResetAt } from '../shared/format.ts';
import type { AnalyticsResult, GroupBy } from '../shared/usage/analytics.ts';
import type {
  AccessTokenProvider,
  AnalyticsRequest,
} from '../shared/usage/analytics-coordinator.ts';
import {
  isCurrentPeriod,
  type MonthlyUsage,
} from '../shared/usage/monthly-usage.ts';
import {
  estimateSessionCredits,
  type SessionCreditUsage,
} from '../shared/usage/session-usage.ts';
import type {
  UsageRefresh,
  UsageRuntime,
} from '../shared/usage/usage-runtime.ts';
import { calculateSummary } from '../shared/usage/usage-summary.ts';
import type { AccountTabMonthlyUsage } from './account/account-tab.ts';
import { UsageModal } from './modal.ts';

export function toAccountTabMonthlyUsage(
  usage: MonthlyUsage
): AccountTabMonthlyUsage {
  return {
    monthlyUsed: usage.used,
    monthlyLimit: usage.limit,
    monthlyRemaining: usage.remaining,
    monthlyPercent: usage.usedPercent,
    monthlyRemainingPercent: usage.remainingPercent,
    resetAt: usage.resetAt,
    resetLabel: formatResetAt(usage.resetAt),
  };
}

export interface DashboardAnalyticsCoordinator {
  load(
    getAccessToken: AccessTokenProvider,
    request: AnalyticsRequest
  ): Promise<AnalyticsResult | undefined>;
  cancelAll(): void;
}

export interface UsageDashboardCoordinator
  extends DashboardAnalyticsCoordinator {
  getCached(resetAt: number | undefined): AnalyticsResult[];
}

export interface DashboardAnalyticsView {
  readonly signal: AbortSignal;
  setAnalyticsLoading(groupBy: GroupBy): void;
  setAnalytics(analytics: AnalyticsResult): void;
  setAnalyticsError(groupBy: GroupBy): void;
}

/**
 * Coordinates dashboard analytics requests independently from modal
 * rendering. Each reload advances a generation so late results cannot
 * overwrite the current dashboard.
 */
export class DashboardAnalytics {
  private generation = 0;
  private readonly fullAnalyticsLoaded = new Set<GroupBy>();

  constructor(
    private readonly coordinator: DashboardAnalyticsCoordinator,
    private readonly getAccessToken: AccessTokenProvider,
    private readonly view: DashboardAnalyticsView
  ) {}

  get currentGeneration(): number {
    return this.generation;
  }

  hasLoaded(groupBy: GroupBy): boolean {
    return this.fullAnalyticsLoaded.has(groupBy);
  }

  load(
    groupBy: GroupBy,
    resetAt: number | undefined,
    showLoading: boolean,
    force = false
  ): Promise<boolean> {
    if (showLoading) this.view.setAnalyticsLoading(groupBy);
    const generation = this.generation;
    const request: AnalyticsRequest = force
      ? { resetAt, groupBy, force: true }
      : { resetAt, groupBy };
    return this.coordinator
      .load(this.getAccessToken, request)
      .then((analytics) => {
        if (generation !== this.generation || this.view.signal.aborted) {
          return false;
        }
        if (!analytics) {
          this.view.setAnalyticsError(groupBy);
          return false;
        }
        this.view.setAnalytics(analytics);
        this.fullAnalyticsLoaded.add(groupBy);
        return true;
      });
  }

  applyInitial(
    initialAnalyticsPromise: Promise<AnalyticsResult | undefined>
  ): Promise<boolean> {
    const generation = this.generation;
    return initialAnalyticsPromise.then((analytics) => {
      if (generation !== this.generation || this.view.signal.aborted) {
        return false;
      }
      if (!analytics) {
        this.view.setAnalyticsError('day');
        return false;
      }
      this.view.setAnalytics(analytics);
      return true;
    });
  }

  preload(resetAt: number): void {
    void this.load('day', resetAt, false);
    void this.load('week', resetAt, false);
  }

  reload(resetAt: number | undefined, priorityGroup: GroupBy): void {
    this.coordinator.cancelAll();
    this.generation += 1;
    this.fullAnalyticsLoaded.clear();
    const otherGroup: GroupBy = priorityGroup === 'day' ? 'week' : 'day';
    this.view.setAnalyticsLoading(priorityGroup);
    this.view.setAnalyticsLoading(otherGroup);
    void this.load(priorityGroup, resetAt, false, true);
    void this.load(otherGroup, resetAt, false, true);
  }

  close(): void {
    this.coordinator.cancelAll();
    this.generation += 1;
    this.fullAnalyticsLoaded.clear();
  }
}

export interface UsageDashboardDeps {
  usageRuntime: UsageRuntime;
  analyticsCoordinator: UsageDashboardCoordinator;
  getDayPolicy(): BudgetDayPolicy;
  setDayPolicy(policy: DayPolicy, ctx: ExtensionContext): void;
  getAccessToken(ctx: ExtensionContext): Promise<string | undefined>;
  registerSessionUpdate(
    handler: (ctx: ExtensionContext, usage: SessionCreditUsage) => void
  ): () => void;
  startUsageRefresh(
    ctx: ExtensionContext,
    accessTokenPromise?: Promise<string | undefined>
  ): UsageRefresh;
}

interface UsageDashboardSessionOptions {
  usage: MonthlyUsage;
  previousUsage: MonthlyUsage | undefined;
  initialAnalyticsPromise: Promise<AnalyticsResult | undefined> | undefined;
  monthlyRefresh: UsageRefresh;
  dayPolicy: BudgetDayPolicy;
}

/** Owns one TUI dashboard's modal and background refresh lifecycle. */
export class UsageDashboardSession {
  private dashboardUsage: MonthlyUsage;

  constructor(
    private readonly ctx: ExtensionContext,
    private readonly deps: UsageDashboardDeps,
    private readonly options: UsageDashboardSessionOptions
  ) {
    this.dashboardUsage = options.usage;
  }

  open(): Promise<void> {
    const {
      usage,
      previousUsage,
      initialAnalyticsPromise,
      monthlyRefresh,
      dayPolicy,
    } = this.options;
    const summary = calculateSummary(usage, dayPolicy);
    const {
      minutes,
      avgDailyUsed,
      dailyBudget,
      projectedOverage,
      minutesUntilOut,
    } = summary;
    const sessionEntries = this.ctx.sessionManager.getEntries();
    const sessionBranch = this.ctx.sessionManager.getBranch();
    const sessionCreditUsage = estimateSessionCredits(sessionBranch);
    const wholeSessionCreditUsage = estimateSessionCredits(sessionEntries);

    return this.ctx.ui.custom<void>(
      (tui, theme, _keybindings, done) => {
        let modal: UsageModal;
        const analytics = new DashboardAnalytics(
          this.deps.analyticsCoordinator,
          () => this.deps.getAccessToken(this.ctx),
          {
            get signal() {
              return modal.signal;
            },
            setAnalyticsLoading: (groupBy) =>
              modal.setAnalyticsLoading(groupBy),
            setAnalytics: (result) => modal.setAnalytics(result),
            setAnalyticsError: (groupBy) => modal.setAnalyticsError(groupBy),
          }
        );
        const refreshModalUsage = (nextUsage: MonthlyUsage): void => {
          this.dashboardUsage = nextUsage;
          modal.refreshUsage(
            toAccountTabMonthlyUsage(nextUsage),
            calculateSummary(nextUsage, this.deps.getDayPolicy())
          );
        };
        const refreshModalSession = (
          updateCtx: ExtensionContext,
          wholeSessionUsage: SessionCreditUsage
        ): void => {
          if (updateCtx.sessionManager !== this.ctx.sessionManager) return;
          modal.refreshSession(
            estimateSessionCredits(updateCtx.sessionManager.getBranch()),
            wholeSessionUsage
          );
        };
        let unregisterSessionUpdate: (() => void) | undefined;

        modal = new UsageModal(tui, theme, {
          ...toAccountTabMonthlyUsage(usage),
          avgDailyUsed,
          dailyBudget,
          minutesLeft: minutes,
          projectedOverage,
          minutesUntilOut,
          formatCredits,
          sessionCreditUsage,
          wholeSessionCreditUsage,
          dayPolicy,
          onDayPolicyChange: (policy) => {
            this.deps.setDayPolicy(policy, this.ctx);
            const nextPolicy = this.deps.getDayPolicy();
            modal.refreshSummary(
              calculateSummary(this.dashboardUsage, nextPolicy)
            );
            return nextPolicy;
          },
          onAnalyticsNeeded: (groupBy) => {
            if (!analytics.hasLoaded(groupBy)) {
              void analytics.load(groupBy, this.dashboardUsage.resetAt, true);
            }
          },
          onRefresh: (groupBy) => {
            const resetAt = this.dashboardUsage.resetAt;
            analytics.reload(resetAt, groupBy);
            const refresh = this.deps.startUsageRefresh(this.ctx);
            this.deps.usageRuntime.applyRefresh(refresh, {
              isStale: () => modal.signal.aborted,
              onError: () => {
                this.ctx.ui.notify(
                  this.deps.usageRuntime.error ?? 'Usage unavailable',
                  'warning'
                );
              },
              onUsage: (nextUsage) => {
                refreshModalUsage(nextUsage);
                if (nextUsage.resetAt !== resetAt) {
                  analytics.reload(nextUsage.resetAt, groupBy);
                }
              },
            });
          },
          onClose: () => {
            unregisterSessionUpdate?.();
            unregisterSessionUpdate = undefined;
            analytics.close();
            done();
          },
        });
        unregisterSessionUpdate =
          this.deps.registerSessionUpdate(refreshModalSession);
        for (const cached of this.deps.analyticsCoordinator.getCached(
          usage.resetAt
        )) {
          modal.setAnalytics(cached);
        }
        modal.setAnalyticsLoading('day');

        if (previousUsage) {
          this.deps.usageRuntime.applyRefresh(monthlyRefresh, {
            isStale: () => modal.signal.aborted,
            onError: () => {
              this.ctx.ui.notify(
                this.deps.usageRuntime.error ?? 'Usage unavailable',
                'warning'
              );
            },
            onUsage: (nextUsage) => {
              const resetChanged =
                this.dashboardUsage.resetAt !== nextUsage.resetAt;
              refreshModalUsage(nextUsage);
              if (resetChanged) {
                analytics.reload(nextUsage.resetAt, modal.selectedGroup);
              }
            },
          });
        }

        const initialGeneration = analytics.currentGeneration;
        const initialDailyLoad = initialAnalyticsPromise
          ? analytics.applyInitial(initialAnalyticsPromise)
          : analytics.load('day', usage.resetAt, true);
        void initialDailyLoad.then(() => {
          if (initialGeneration === analytics.currentGeneration) {
            analytics.preload(this.dashboardUsage.resetAt);
          }
        });

        return modal;
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: 'center',
          width: 100,
          maxHeight: 26,
          margin: 1,
        },
      }
    );
  }
}

export async function openUsageDashboard(
  ctx: ExtensionContext,
  deps: UsageDashboardDeps
): Promise<void> {
  const dayPolicy = deps.getDayPolicy();
  const accessTokenPromise = deps.getAccessToken(ctx);
  // A cached snapshot whose reset has passed describes the previous period, so
  // it must not seed the summary or the chart's period start. Falling back to
  // undefined keeps the analytics request in parallel with the monthly refresh
  // while leaving lastResetDate unset until the fresh reset is known.
  const previousUsage = isCurrentPeriod(deps.usageRuntime.currentUsage)
    ? deps.usageRuntime.currentUsage
    : undefined;
  const initialAnalyticsPromise = deps.analyticsCoordinator.load(
    () => accessTokenPromise,
    {
      resetAt: previousUsage?.resetAt,
      groupBy: 'day',
    }
  );

  const monthlyRefresh = deps.startUsageRefresh(ctx, accessTokenPromise);
  let usage: MonthlyUsage;
  if (!previousUsage) {
    const refreshed = await monthlyRefresh.promise;
    if (!deps.usageRuntime.isCurrentRefresh(monthlyRefresh.generation)) {
      return;
    }
    if (!refreshed) {
      deps.analyticsCoordinator.cancelAll();
      ctx.ui.notify(
        deps.usageRuntime.error ?? 'No individual monthly credit limit',
        'warning'
      );
      return;
    }
    usage = refreshed;
  } else {
    usage = previousUsage;
  }

  await new UsageDashboardSession(ctx, deps, {
    usage,
    previousUsage,
    initialAnalyticsPromise,
    monthlyRefresh,
    dayPolicy,
  }).open();
}
