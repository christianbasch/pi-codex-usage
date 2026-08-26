import { fetchMonthlyUsage, type MonthlyUsage } from './monthly-usage.ts';

export type AccessTokenProvider = () => Promise<string | undefined>;

export type FetchMonthlyUsage = (
  accessToken: string,
  signal: AbortSignal
) => Promise<MonthlyUsage | undefined>;

export interface UsageRefresh {
  generation: number;
  promise: Promise<MonthlyUsage | undefined>;
}

export interface RefreshHandlers {
  /** Extra staleness check (e.g. a modal abort signal), evaluated first. */
  isStale?(): boolean;
  /** Called when the refresh is current but resolved without usage. */
  onError?(): void;
  onUsage(usage: MonthlyUsage): void;
}

/**
 * Owns the monthly-usage refresh lifecycle: fetching, cancellation,
 * generation tracking, and the cached usage/status state. Rendering is left
 * to subscribers, which are notified whenever the refresh state changes.
 */
export class UsageRuntime {
  private monthlyUsage: MonthlyUsage | undefined;
  private statusError: string | undefined;
  private isRefreshing = false;
  private refreshAbortController: AbortController | undefined;
  private usageRefreshGeneration = 0;
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly getAccessToken: AccessTokenProvider,
    private readonly fetchUsage: FetchMonthlyUsage = fetchMonthlyUsage
  ) {}

  get currentUsage(): MonthlyUsage | undefined {
    return this.monthlyUsage;
  }

  get error(): string | undefined {
    return this.statusError;
  }

  get refreshing(): boolean {
    return this.isRefreshing;
  }

  get refreshGeneration(): number {
    return this.usageRefreshGeneration;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  startRefresh(getAccessToken?: AccessTokenProvider): UsageRefresh {
    const generation = ++this.usageRefreshGeneration;
    return {
      generation,
      promise: this.refreshUsage(getAccessToken),
    };
  }

  isCurrentRefresh(generation: number): boolean {
    return generation === this.usageRefreshGeneration;
  }

  /**
   * Consumes a refresh started via startRefresh: when the refresh is still
   * current (and not stale), either reports its error or hands the usage to
   * onUsage. Centralizes the generation/abort guard duplicated at call sites.
   */
  applyRefresh(refresh: UsageRefresh, handlers: RefreshHandlers): void {
    void refresh.promise.then((usage) => {
      if (handlers.isStale?.() || !this.isCurrentRefresh(refresh.generation)) {
        return;
      }
      if (!usage) {
        handlers.onError?.();
        return;
      }
      handlers.onUsage(usage);
    });
  }

  shutdown(): void {
    const controller = this.refreshAbortController;
    this.refreshAbortController = undefined;
    controller?.abort();
    this.usageRefreshGeneration += 1;
    this.isRefreshing = false;
  }

  private async refreshUsage(
    getAccessToken?: AccessTokenProvider
  ): Promise<MonthlyUsage | undefined> {
    this.refreshAbortController?.abort();
    const controller = new AbortController();
    this.refreshAbortController = controller;

    this.isRefreshing = true;
    this.notify();

    try {
      const accessToken = await (getAccessToken ?? this.getAccessToken)();
      if (this.refreshAbortController !== controller) return undefined;
      if (!accessToken) {
        this.statusError = 'Sign in with /login openai-codex';
        return undefined;
      }

      const usage = await this.fetchUsage(accessToken, controller.signal);
      if (this.refreshAbortController !== controller) return undefined;
      if (!usage) {
        this.statusError = 'No individual monthly credit limit';
        return undefined;
      }
      this.monthlyUsage = usage;
      this.statusError = undefined;
      return usage;
    } catch (error) {
      if (this.refreshAbortController !== controller) return undefined;
      if (error instanceof Error && error.name === 'AbortError') {
        return undefined;
      }
      this.statusError = 'Usage unavailable';
      return undefined;
    } finally {
      if (this.refreshAbortController === controller) {
        this.refreshAbortController = undefined;
        this.isRefreshing = false;
        this.notify();
      }
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
