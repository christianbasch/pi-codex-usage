import {
  type AnalyticsResult,
  fetchUsageAnalytics,
  type GroupBy,
  mergeAnalyticsResults,
} from './analytics.ts';

export interface AnalyticsRequest {
  resetAt: number | undefined;
  groupBy: GroupBy;
  force?: boolean;
}

export type AccessTokenProvider = () => Promise<string | undefined>;

interface InFlightRequest {
  controller: AbortController;
  promise: Promise<AnalyticsResult | undefined>;
}

function requestKey(request: AnalyticsRequest): string {
  return `${request.resetAt ?? 'none'}:${request.groupBy}`;
}

export class AnalyticsCoordinator {
  private readonly cachedAnalytics = new Map<GroupBy, AnalyticsResult>();
  private activeResetAt: number | undefined;
  private cacheGeneration = 0;
  private readonly requests = new Map<string, InFlightRequest>();

  getCached(resetAt: number | undefined): AnalyticsResult[] {
    return this.activeResetAt === resetAt
      ? [...this.cachedAnalytics.values()]
      : [];
  }

  load(
    getAccessToken: AccessTokenProvider,
    request: AnalyticsRequest
  ): Promise<AnalyticsResult | undefined> {
    const generation = this.selectReset(request.resetAt);
    const cached = this.cachedAnalytics.get(request.groupBy);
    if (!request.force && this.activeResetAt === request.resetAt && cached) {
      return Promise.resolve(cached);
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
          request.groupBy
        );
        if (controller.signal.aborted || generation !== this.cacheGeneration) {
          return undefined;
        }
        return this.cache(analytics);
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
  ): Promise<AnalyticsResult | undefined> {
    return this.load(getAccessToken, { resetAt, groupBy: 'day' });
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
    this.cachedAnalytics.clear();
    this.cacheGeneration += 1;
    return this.cacheGeneration;
  }

  private cache(analytics: AnalyticsResult): AnalyticsResult {
    const merged = mergeAnalyticsResults(
      this.cachedAnalytics.get(analytics.groupBy),
      analytics
    );
    this.cachedAnalytics.set(analytics.groupBy, merged);
    return merged;
  }
}
