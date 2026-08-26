import { describe, expect, it, vi } from 'vitest';
import { AnalyticsCoordinator } from './analytics-loader.ts';

const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;

function analyticsResponse(date = '2026-07-10'): Response {
  return new Response(JSON.stringify({ data: [{ date, models: [] }] }), {
    status: 200,
  });
}

describe('AnalyticsCoordinator', () => {
  it('shares an in-flight prefetch with the dashboard request', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(analyticsResponse());
    const getAccessToken = vi.fn().mockResolvedValue('token');
    const coordinator = new AnalyticsCoordinator();

    try {
      const prefetch = coordinator.prefetch(getAccessToken, resetAt);
      const dashboardLoad = coordinator.load(getAccessToken, {
        resetAt,
        groupBy: 'day',
        currentPeriodOnly: true,
      });

      expect(dashboardLoad).toBe(prefetch);
      await expect(dashboardLoad).resolves.toMatchObject({
        daily: { workspaceUser: [{ date: '2026-07-10' }] },
      });
      expect(getAccessToken).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(coordinator.getCached(resetAt)).toMatchObject({
        daily: { workspaceUser: [{ date: '2026-07-10' }] },
      });
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('does not let an old reset overwrite the current cache', async () => {
    let resolveOld!: (response: Response) => void;
    let resolveCurrent!: (response: Response) => void;
    const oldResponse = new Promise<Response>((resolve) => {
      resolveOld = resolve;
    });
    const currentResponse = new Promise<Response>((resolve) => {
      resolveCurrent = resolve;
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_input, init) => {
        if (init?.signal) {
          return fetchMock.mock.calls.length === 1
            ? oldResponse
            : currentResponse;
        }
        return analyticsResponse();
      });
    const getAccessToken = vi.fn().mockResolvedValue('token');
    const coordinator = new AnalyticsCoordinator();
    const currentResetAt = Date.parse('2026-09-01T00:00:00Z') / 1000;

    try {
      const oldLoad = coordinator.load(getAccessToken, {
        resetAt,
        groupBy: 'day',
        currentPeriodOnly: true,
      });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const currentLoad = coordinator.load(getAccessToken, {
        resetAt: currentResetAt,
        groupBy: 'day',
        currentPeriodOnly: true,
      });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

      resolveCurrent(analyticsResponse('2026-08-10'));
      await currentLoad;
      resolveOld(analyticsResponse('2026-07-10'));
      await oldLoad;

      expect(coordinator.getCached(currentResetAt)).toMatchObject({
        daily: { workspaceUser: [{ date: '2026-08-10' }] },
      });
      expect(coordinator.getCached(resetAt)).toBeUndefined();
    } finally {
      resolveOld(analyticsResponse());
      resolveCurrent(analyticsResponse());
      fetchMock.mockRestore();
    }
  });
});
