import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsResult, GroupBy } from './analytics.ts';
import {
  DashboardAnalytics,
  type DashboardAnalyticsCoordinator,
  type DashboardAnalyticsView,
} from './usage-dashboard.ts';

const resetAt = 1_785_542_400;

function analytics(groupBy: GroupBy = 'day'): AnalyticsResult {
  return {
    startDate: '2026-07-01',
    endDate: '2026-07-10',
    groupBy,
    breakdown: { workspaceUser: [] },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createView() {
  const abortController = new AbortController();
  const view: DashboardAnalyticsView = {
    signal: abortController.signal,
    setAnalyticsLoading: vi.fn(),
    setAnalytics: vi.fn(),
    setAnalyticsError: vi.fn(),
  };
  return { abortController, view };
}

function createCoordinator() {
  const coordinator: DashboardAnalyticsCoordinator = {
    load: vi.fn(),
    cancelAll: vi.fn(),
  };
  return coordinator;
}

describe('DashboardAnalytics', () => {
  it('loads analytics, updates the view, and tracks loaded groups', async () => {
    const coordinator = createCoordinator();
    const { view } = createView();
    const result = analytics();
    vi.mocked(coordinator.load).mockResolvedValue(result);
    const getAccessToken = vi.fn().mockResolvedValue('token');
    const dashboardAnalytics = new DashboardAnalytics(
      coordinator,
      getAccessToken,
      view
    );

    const loaded = dashboardAnalytics.load('day', resetAt, true);

    expect(view.setAnalyticsLoading).toHaveBeenCalledWith('day');
    await expect(loaded).resolves.toBe(true);
    expect(view.setAnalytics).toHaveBeenCalledWith(result);
    expect(dashboardAnalytics.hasLoaded('day')).toBe(true);
    const accessTokenProvider = vi.mocked(coordinator.load).mock.calls[0]?.[0];
    await expect(accessTokenProvider?.()).resolves.toBe('token');
    expect(getAccessToken).toHaveBeenCalledTimes(1);
  });

  it('preloads both groups without showing loading state', async () => {
    const coordinator = createCoordinator();
    const { view } = createView();
    vi.mocked(coordinator.load).mockImplementation(async (_token, request) =>
      analytics(request.groupBy)
    );
    const dashboardAnalytics = new DashboardAnalytics(
      coordinator,
      vi.fn().mockResolvedValue('token'),
      view
    );

    dashboardAnalytics.preload(resetAt);
    await vi.waitFor(() => expect(coordinator.load).toHaveBeenCalledTimes(2));

    expect(coordinator.load).toHaveBeenNthCalledWith(1, expect.any(Function), {
      resetAt,
      groupBy: 'day',
    });
    expect(coordinator.load).toHaveBeenNthCalledWith(2, expect.any(Function), {
      resetAt,
      groupBy: 'week',
    });
    expect(view.setAnalyticsLoading).not.toHaveBeenCalled();
    expect(dashboardAnalytics.hasLoaded('day')).toBe(true);
    expect(dashboardAnalytics.hasLoaded('week')).toBe(true);
  });

  it('invalidates stale requests when reloading both groups', async () => {
    const coordinator = createCoordinator();
    const { view } = createView();
    const stale = deferred<AnalyticsResult | undefined>();
    const currentDay = deferred<AnalyticsResult | undefined>();
    const currentWeek = deferred<AnalyticsResult | undefined>();
    vi.mocked(coordinator.load)
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(currentDay.promise)
      .mockReturnValueOnce(currentWeek.promise);
    const dashboardAnalytics = new DashboardAnalytics(
      coordinator,
      vi.fn().mockResolvedValue('token'),
      view
    );

    const staleLoad = dashboardAnalytics.load('day', resetAt, false);
    dashboardAnalytics.reload(resetAt, 'week');
    stale.resolve(analytics('day'));
    await staleLoad;

    expect(coordinator.cancelAll).toHaveBeenCalledTimes(1);
    expect(view.setAnalytics).not.toHaveBeenCalledWith(analytics('day'));
    expect(dashboardAnalytics.hasLoaded('day')).toBe(false);

    currentDay.resolve(analytics('day'));
    currentWeek.resolve(analytics('week'));
    await vi.waitFor(() => expect(view.setAnalytics).toHaveBeenCalledTimes(2));
    expect(dashboardAnalytics.hasLoaded('day')).toBe(true);
    expect(dashboardAnalytics.hasLoaded('week')).toBe(true);
  });

  it('ignores an initial result after the dashboard generation changes', async () => {
    const coordinator = createCoordinator();
    const { view } = createView();
    const initial = deferred<AnalyticsResult | undefined>();
    const reloadDay = deferred<AnalyticsResult | undefined>();
    const reloadWeek = deferred<AnalyticsResult | undefined>();
    vi.mocked(coordinator.load)
      .mockReturnValueOnce(reloadDay.promise)
      .mockReturnValueOnce(reloadWeek.promise);
    const dashboardAnalytics = new DashboardAnalytics(
      coordinator,
      vi.fn().mockResolvedValue('token'),
      view
    );

    const initialLoad = dashboardAnalytics.applyInitial(initial.promise);
    dashboardAnalytics.reload(resetAt, 'day');
    initial.resolve(analytics('day'));

    await expect(initialLoad).resolves.toBe(false);
    expect(view.setAnalytics).not.toHaveBeenCalled();
  });

  it('does not apply results after the view has been aborted', async () => {
    const coordinator = createCoordinator();
    const { abortController, view } = createView();
    const result = analytics();
    vi.mocked(coordinator.load).mockResolvedValue(result);
    const dashboardAnalytics = new DashboardAnalytics(
      coordinator,
      vi.fn().mockResolvedValue('token'),
      view
    );

    const load = dashboardAnalytics.load('day', resetAt, false);
    abortController.abort();

    await expect(load).resolves.toBe(false);
    expect(view.setAnalytics).not.toHaveBeenCalled();
  });
});
