import { describe, expect, it, vi } from 'vitest';
import type { MonthlyUsage } from './monthly-usage.ts';
import { UsageRuntime } from './usage-runtime.ts';

function usage(overrides: Partial<MonthlyUsage> = {}): MonthlyUsage {
  return {
    limit: 8000,
    used: 4000,
    remaining: 4000,
    usedPercent: 50,
    remainingPercent: 50,
    resetAt: 1_785_542_400,
    resetAfterSeconds: 864_000,
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createRuntime(fetchUsage = vi.fn()) {
  const getAccessToken = vi.fn().mockResolvedValue('token');
  return {
    getAccessToken,
    fetchUsage,
    runtime: new UsageRuntime(getAccessToken, fetchUsage),
  };
}

describe('UsageRuntime', () => {
  it('refreshes usage and updates state', async () => {
    const expected = usage();
    const { runtime } = createRuntime(vi.fn().mockResolvedValue(expected));

    const refresh = runtime.startRefresh();
    expect(runtime.refreshing).toBe(true);
    await expect(refresh.promise).resolves.toBe(expected);
    expect(runtime.currentUsage).toBe(expected);
    expect(runtime.error).toBeUndefined();
    expect(runtime.refreshing).toBe(false);
  });

  it('notifies subscribers when a refresh starts and settles', async () => {
    const deferredUsage = deferred<MonthlyUsage | undefined>();
    const { runtime } = createRuntime(
      vi.fn().mockReturnValue(deferredUsage.promise)
    );
    const listener = vi.fn();
    runtime.subscribe(listener);

    const refresh = runtime.startRefresh();
    expect(listener).toHaveBeenCalledTimes(1);

    deferredUsage.resolve(usage());
    await refresh.promise;
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('does not notify subscribers when a superseded refresh settles', async () => {
    const deferredUsage = deferred<MonthlyUsage | undefined>();
    const { runtime } = createRuntime(
      vi.fn().mockReturnValue(deferredUsage.promise)
    );
    const listener = vi.fn();
    runtime.subscribe(listener);

    const first = runtime.startRefresh();
    runtime.startRefresh();
    deferredUsage.resolve(usage());
    await first.promise;
    expect(listener).toHaveBeenCalledTimes(2); // first start + second start only
  });

  it('reports sign-in hint when no access token is available', async () => {
    const { runtime, fetchUsage } = createRuntime();
    runtime.startRefresh(vi.fn().mockResolvedValue(undefined));

    await vi.waitFor(() => expect(runtime.refreshing).toBe(false));
    expect(runtime.error).toBe('Sign in with /login openai-codex');
    expect(runtime.currentUsage).toBeUndefined();
    expect(fetchUsage).not.toHaveBeenCalled();
  });

  it('reports no-limit error when fetch returns undefined', async () => {
    const { runtime } = createRuntime(vi.fn().mockResolvedValue(undefined));

    const refresh = runtime.startRefresh();
    await expect(refresh.promise).resolves.toBeUndefined();
    expect(runtime.error).toBe('No individual monthly credit limit');
    expect(runtime.refreshing).toBe(false);
  });

  it('reports unavailable on fetch errors', async () => {
    const { runtime } = createRuntime(
      vi.fn().mockRejectedValue(new Error('boom'))
    );

    const refresh = runtime.startRefresh();
    await expect(refresh.promise).resolves.toBeUndefined();
    expect(runtime.error).toBe('Usage unavailable');
  });

  it('swallows abort errors without setting an error', async () => {
    const { runtime } = createRuntime(
      vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'))
    );

    const refresh = runtime.startRefresh();
    await expect(refresh.promise).resolves.toBeUndefined();
    expect(runtime.error).toBeUndefined();
  });

  it('supersedes an in-flight refresh and keeps newer state', async () => {
    const firstToken = deferred<string | undefined>();
    const firstUsage = deferred<MonthlyUsage | undefined>();
    const secondUsage = deferred<MonthlyUsage | undefined>();
    const fetchUsage = vi.fn().mockImplementation(() =>
      // Calls arrive in order: first fetch is pending, second is controllable.
      fetchUsage.mock.calls.length === 1
        ? firstUsage.promise
        : secondUsage.promise
    );
    const { runtime, getAccessToken } = createRuntime(fetchUsage);

    const first = runtime.startRefresh(() => firstToken.promise);
    firstToken.resolve('token');
    await vi.waitFor(() => expect(fetchUsage).toHaveBeenCalledTimes(1));

    const second = runtime.startRefresh();
    expect(runtime.isCurrentRefresh(first.generation)).toBe(false);
    expect(runtime.isCurrentRefresh(second.generation)).toBe(true);

    secondUsage.resolve(usage({ used: 100 }));
    await second.promise;
    expect(runtime.currentUsage?.used).toBe(100);

    // A late response from the superseded refresh must not clobber state.
    firstUsage.resolve(usage({ used: 9999 }));
    await expect(first.promise).resolves.toBeUndefined();
    expect(runtime.currentUsage?.used).toBe(100);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
  });

  it('shutdown aborts in-flight refreshes and invalidates generations', async () => {
    const deferredUsage = deferred<MonthlyUsage | undefined>();
    const fetchUsage = vi
      .fn()
      .mockImplementation((_token: string, signal: AbortSignal) => {
        signal.addEventListener('abort', () =>
          deferredUsage.reject(new DOMException('aborted', 'AbortError'))
        );
        return deferredUsage.promise;
      });
    const { runtime } = createRuntime(fetchUsage);

    const refresh = runtime.startRefresh();
    runtime.shutdown();

    expect(runtime.refreshing).toBe(false);
    expect(runtime.isCurrentRefresh(refresh.generation)).toBe(false);
    await expect(refresh.promise).resolves.toBeUndefined();

    // The runtime remains usable after shutdown.
    const next = runtime.startRefresh(vi.fn().mockResolvedValue('token'));
    fetchUsage.mockResolvedValueOnce(usage({ used: 7 }));
    await expect(next.promise).resolves.toMatchObject({ used: 7 });
  });

  it('starts the next refresh only after the previous settles', async () => {
    const deferredUsage = deferred<MonthlyUsage | undefined>();
    const { runtime } = createRuntime(
      vi.fn().mockReturnValueOnce(deferredUsage.promise)
    );

    const first = runtime.startRefresh();
    deferredUsage.resolve(usage());
    await first.promise;

    const refresh = runtime.startRefresh();
    expect(runtime.refreshing).toBe(true);
    expect(runtime.refreshGeneration).toBe(refresh.generation);
  });
});
