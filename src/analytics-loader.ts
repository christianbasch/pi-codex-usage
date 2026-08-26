import {
  fetchUsageAnalytics,
  type GroupBy,
  mergeUsageAnalytics,
  type UsageAnalyticsPatch,
} from './analytics.ts';

export interface AnalyticsRequest {
  resetAt: number | undefined;
  groupBy: GroupBy;
  currentPeriodOnly: boolean;
}

export type AccessTokenProvider = () => Promise<string | undefined>;

interface InFlightRequest {
  controller: AbortController;
  promise: Promise<UsageAnalyticsPatch | undefined>;
}

function requestKey(request: AnalyticsRequest): string {
  return `${request.resetAt ?? 'none'}:${request.groupBy}:${request.currentPeriodOnly ? 'current' : 'full'}`;
}

export class AnalyticsCoordinator {
  private cachedAnalytics: UsageAnalyticsPatch | undefined;
  private cachedResetAt: number | undefined;
  private activeResetAt: number | undefined;
  private cacheGeneration = 0;
  private readonly requests = new Map<string, InFlightRequest>();

  getCached(resetAt: number | undefined): UsageAnalyticsPatch | undefined {
    return this.cachedResetAt === resetAt ? this.cachedAnalytics : undefined;
  }

  load(
    getAccessToken: AccessTokenProvider,
    request: AnalyticsRequest
  ): Promise<UsageAnalyticsPatch | undefined> {
    const generation = this.selectReset(request.resetAt);
    if (
      request.currentPeriodOnly &&
      this.hasCachedGroup(request.resetAt, request.groupBy)
    ) {
      return Promise.resolve(this.cachedAnalytics);
    }

    const key = requestKey(request);
    const existing = this.requests.get(key);
    if (existing) return existing.promise;

    const controller = new AbortController();
    const promise = (async () => {
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) return undefined;
        const analytics = await fetchUsageAnalytics(
          accessToken,
          controller.signal,
          request.resetAt,
          new Date(),
          request.groupBy,
          request.currentPeriodOnly
        );
        if (controller.signal.aborted || generation !== this.cacheGeneration) {
          return undefined;
        }
        this.cache(request.resetAt, analytics);
        return analytics;
      } catch {
        return undefined;
      }
    })();
    this.requests.set(key, { controller, promise });
    void promise.then(() => {
      if (this.requests.get(key)?.promise === promise) {
        this.requests.delete(key);
      }
    });
    return promise;
  }

  prefetch(
    getAccessToken: AccessTokenProvider,
    resetAt: number
  ): Promise<UsageAnalyticsPatch | undefined> {
    return this.load(getAccessToken, {
      resetAt,
      groupBy: 'day',
      currentPeriodOnly: true,
    });
  }

  cancelAll(): void {
    for (const { controller } of this.requests.values()) {
      controller.abort();
    }
    this.requests.clear();
  }

  private selectReset(resetAt: number | undefined): number {
    if (this.activeResetAt === resetAt) return this.cacheGeneration;
    this.cancelAll();
    this.activeResetAt = resetAt;
    this.cachedAnalytics = undefined;
    this.cachedResetAt = resetAt;
    this.cacheGeneration += 1;
    return this.cacheGeneration;
  }

  private hasCachedGroup(
    resetAt: number | undefined,
    groupBy: GroupBy
  ): boolean {
    const cached = this.getCached(resetAt);
    return groupBy === 'day'
      ? cached?.daily !== undefined
      : cached?.weekly !== undefined;
  }

  private cache(
    resetAt: number | undefined,
    analytics: UsageAnalyticsPatch
  ): void {
    if (this.cachedResetAt !== resetAt) {
      this.cachedAnalytics = undefined;
      this.cachedResetAt = resetAt;
    }
    this.cachedAnalytics = mergeUsageAnalytics(this.cachedAnalytics, analytics);
  }
}
