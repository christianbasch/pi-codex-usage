import type { AnalyticsResult, GroupBy } from './analytics.ts';
import type {
  AccessTokenProvider,
  AnalyticsRequest,
} from './analytics-coordinator.ts';

export interface DashboardAnalyticsCoordinator {
  load(
    getAccessToken: AccessTokenProvider,
    request: AnalyticsRequest
  ): Promise<AnalyticsResult | undefined>;
  cancelAll(): void;
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
