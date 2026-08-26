import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import codexUsageExtension from './index.ts';
import { SPINNER_FRAMES } from './src/status.ts';

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  inverse: (text: string) => text,
};

type TestComponent = {
  handleInput(data: string): void;
  render(width: number): string[];
  dispose(): void;
};

function createDashboardHarness(hasUI = false) {
  let component: TestComponent | undefined;
  const statuses: Array<string | undefined> = [];
  const notifications: string[] = [];
  let usageHandler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
  let sessionStart: ((event: unknown, ctx: unknown) => void) | undefined;
  const pi = {
    registerCommand(
      _name: string,
      command: { handler: (args: string, ctx: unknown) => Promise<void> }
    ) {
      usageHandler = command.handler;
    },
    on(event: string, handler: (event: unknown, ctx: unknown) => void) {
      if (event === 'session_start') sessionStart = handler;
    },
  } as unknown as ExtensionAPI;
  const ctx = {
    hasUI,
    mode: 'tui',
    model: { provider: 'openai-codex' },
    modelRegistry: {
      getApiKeyForProvider: vi.fn().mockResolvedValue('token'),
    },
    sessionManager: {
      getEntries: () => [],
      getBranch: () => [],
    },
    ui: {
      theme,
      setStatus: (_key: string, status: string | undefined) => {
        statuses.push(status);
      },
      notify: (message: string) => {
        notifications.push(message);
      },
      custom: async (
        factory: (
          tui: unknown,
          theme: unknown,
          keybindings: unknown,
          done: () => void
        ) => unknown
      ) => {
        component = factory({ requestRender() {} }, theme, {}, () =>
          component?.dispose()
        ) as TestComponent;
      },
    },
  };
  return {
    pi,
    ctx,
    getComponent: () => component,
    getUsageHandler: () => usageHandler,
    getSessionStart: () => sessionStart,
    statuses,
    notifications,
  };
}

describe('usage dashboard loading', () => {
  it('starts current-period analytics and monthly usage refresh in parallel', async () => {
    const requests: string[] = [];
    let resolveMonthly!: (response: Response) => void;
    let resolveAnalytics!: (response: Response) => void;
    const pendingMonthly = new Promise<Response>((resolve) => {
      resolveMonthly = resolve;
    });
    const pendingAnalytics = new Promise<Response>((resolve) => {
      resolveAnalytics = resolve;
    });
    const monthlyResponse = new Response(
      JSON.stringify({
        spend_control: {
          individual_limit: {
            limit: 8000,
            used: 1000,
            remaining: 7000,
            reset_at: Date.parse('2026-08-01T00:00:00Z') / 1000,
            reset_after_seconds: 1_000_000,
          },
        },
      }),
      { status: 200 }
    );
    const analyticsResponse = new Response(JSON.stringify({ data: [] }), {
      status: 200,
    });
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        requests.push(url);
        if (url === 'https://chatgpt.com/backend-api/wham/usage') {
          return pendingMonthly;
        }
        return pendingAnalytics;
      });

    let component:
      | { handleInput(data: string): void; dispose(): void }
      | undefined;
    let usageHandler:
      | ((args: string, ctx: unknown) => Promise<void>)
      | undefined;
    const pi = {
      registerCommand(
        _name: string,
        command: { handler: (args: string, ctx: unknown) => Promise<void> }
      ) {
        usageHandler = command.handler;
      },
      on() {},
    } as unknown as ExtensionAPI;

    codexUsageExtension(pi);

    const ctx = {
      hasUI: false,
      mode: 'tui',
      model: { provider: 'openai-codex' },
      modelRegistry: {
        getApiKeyForProvider: vi.fn().mockResolvedValue('token'),
      },
      sessionManager: {
        getEntries: () => [],
        getBranch: () => [],
      },
      ui: {
        custom: async (
          factory: (
            tui: unknown,
            theme: unknown,
            keybindings: unknown,
            done: () => void
          ) => unknown
        ) => {
          component = factory({ requestRender() {} }, theme, {}, () =>
            component?.dispose()
          ) as { handleInput(data: string): void; dispose(): void };
        },
      },
    };

    try {
      const command = usageHandler?.('', ctx);
      await vi.waitFor(() => {
        expect(requests.some((url) => url.includes('group_by=day'))).toBe(true);
        expect(requests).toContain(
          'https://chatgpt.com/backend-api/wham/usage'
        );
      });

      resolveAnalytics(analyticsResponse);
      resolveMonthly(monthlyResponse);
      await command;
    } finally {
      component?.handleInput('q');
      resolveAnalytics(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );
      resolveMonthly(
        new Response(JSON.stringify({ spend_control: {} }), { status: 200 })
      );
      fetchMock.mockRestore();
    }
  });

  it('prefetches current-period daily analytics on session start', async () => {
    const requests: string[] = [];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        requests.push(url);
        if (url === 'https://chatgpt.com/backend-api/wham/usage') {
          return new Response(
            JSON.stringify({
              spend_control: {
                individual_limit: {
                  limit: 8000,
                  used: 1000,
                  remaining: 7000,
                  reset_at: Date.parse('2026-08-01T00:00:00Z') / 1000,
                  reset_after_seconds: 1_000_000,
                },
              },
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

    let sessionStart: ((event: unknown, ctx: unknown) => void) | undefined;
    const pi = {
      registerCommand() {},
      on(event: string, handler: (event: unknown, ctx: unknown) => void) {
        if (event === 'session_start') sessionStart = handler;
      },
    } as unknown as ExtensionAPI;

    codexUsageExtension(pi);

    const ctx = {
      hasUI: false,
      model: { provider: 'openai-codex' },
      modelRegistry: {
        getApiKeyForProvider: vi.fn().mockResolvedValue('token'),
      },
    };

    try {
      sessionStart?.({}, ctx);
      await vi.waitFor(() => expect(requests).toHaveLength(2));

      expect(requests[0]).toBe('https://chatgpt.com/backend-api/wham/usage');
      expect(requests[1]).toContain('group_by=day');
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('updates an open dashboard when its startup prefetch finishes', async () => {
    const requests: string[] = [];
    let resolveAnalytics!: (response: Response) => void;
    const pendingAnalytics = new Promise<Response>((resolve) => {
      resolveAnalytics = resolve;
    });
    let analyticsRequestCount = 0;
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        requests.push(url);
        if (url === 'https://chatgpt.com/backend-api/wham/usage') {
          return new Response(
            JSON.stringify({
              spend_control: {
                individual_limit: {
                  limit: 8000,
                  used: 1000,
                  remaining: 7000,
                  reset_at: Date.parse('2026-08-01T00:00:00Z') / 1000,
                  reset_after_seconds: 1_000_000,
                },
              },
            }),
            { status: 200 }
          );
        }
        analyticsRequestCount += 1;
        return pendingAnalytics;
      });

    let component:
      | { handleInput(data: string): void; dispose(): void }
      | undefined;
    let usageHandler:
      | ((args: string, ctx: unknown) => Promise<void>)
      | undefined;
    let sessionStart: ((event: unknown, ctx: unknown) => void) | undefined;
    const pi = {
      registerCommand(
        _name: string,
        command: { handler: (args: string, ctx: unknown) => Promise<void> }
      ) {
        usageHandler = command.handler;
      },
      on(event: string, handler: (event: unknown, ctx: unknown) => void) {
        if (event === 'session_start') sessionStart = handler;
      },
    } as unknown as ExtensionAPI;

    codexUsageExtension(pi);

    const ctx = {
      hasUI: false,
      mode: 'tui',
      model: { provider: 'openai-codex' },
      modelRegistry: {
        getApiKeyForProvider: vi.fn().mockResolvedValue('token'),
      },
      sessionManager: {
        getEntries: () => [],
        getBranch: () => [],
      },
      ui: {
        custom: async (
          factory: (
            tui: unknown,
            theme: unknown,
            keybindings: unknown,
            done: () => void
          ) => unknown
        ) => {
          component = factory({ requestRender() {} }, theme, {}, () =>
            component?.dispose()
          ) as { handleInput(data: string): void; dispose(): void };
        },
      },
    };

    try {
      sessionStart?.({}, ctx);
      await vi.waitFor(() => expect(requests).toHaveLength(2));

      await usageHandler?.('', ctx);
      expect(analyticsRequestCount).toBe(1);
      expect(component).toBeDefined();
      const render = () =>
        (
          component as unknown as {
            render(width: number): string[];
          }
        )
          .render(120)
          .join('\n');
      expect(render()).toContain('⠋');
      expect(render()).not.toContain('Loading charts…');

      resolveAnalytics(
        new Response(
          JSON.stringify({ data: [{ date: '2026-07-10', models: [] }] }),
          { status: 200 }
        )
      );
      await vi.waitFor(() => expect(render()).not.toContain('Loading charts…'));
    } finally {
      component?.handleInput('q');
      resolveAnalytics(
        new Response(
          JSON.stringify({ data: [{ date: '2026-07-10', models: [] }] }),
          { status: 200 }
        )
      );
      fetchMock.mockRestore();
    }
  });

  it('keeps the current status visible with a spinner while refreshing', async () => {
    let usageCalls = 0;
    let resolveRefresh!: (response: Response) => void;
    const pendingRefresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const monthlyResponse = () =>
      new Response(
        JSON.stringify({
          spend_control: {
            individual_limit: {
              limit: 8000,
              used: 1000,
              remaining: 7000,
              reset_at: Date.parse('2026-08-01T00:00:00Z') / 1000,
              reset_after_seconds: 1_000_000,
            },
          },
        }),
        { status: 200 }
      );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === 'https://chatgpt.com/backend-api/wham/usage') {
          usageCalls += 1;
          return usageCalls === 2 ? pendingRefresh : monthlyResponse();
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

    const harness = createDashboardHarness(true);
    codexUsageExtension(harness.pi);

    try {
      harness.getSessionStart()?.({}, harness.ctx);
      expect(harness.statuses.at(-1)).toBe('⠋');
      await vi.waitFor(() => expect(usageCalls).toBe(1));
      await vi.waitFor(() =>
        expect(harness.statuses.at(-1)).toContain('13%/8k')
      );

      harness.getSessionStart()?.({}, harness.ctx);
      expect(harness.statuses.at(-1)).toContain('⠋');
      expect(harness.statuses.at(-1)).toContain('13%/8k');

      resolveRefresh(monthlyResponse());
      await vi.waitFor(() =>
        expect(harness.statuses.at(-1)).not.toContain('⠋')
      );
    } finally {
      resolveRefresh(monthlyResponse());
      fetchMock.mockRestore();
    }
  });

  it('opens the dashboard with cached usage while refreshing monthly data', async () => {
    const requests: string[] = [];
    let usageCalls = 0;
    let resolveMonthly!: (response: Response) => void;
    const pendingMonthly = new Promise<Response>((resolve) => {
      resolveMonthly = resolve;
    });
    const monthlyResponse = () =>
      new Response(
        JSON.stringify({
          spend_control: {
            individual_limit: {
              limit: 8000,
              used: 1000,
              remaining: 7000,
              reset_at: Date.parse('2026-08-01T00:00:00Z') / 1000,
              reset_after_seconds: 1_000_000,
            },
          },
        }),
        { status: 200 }
      );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        requests.push(url);
        if (url === 'https://chatgpt.com/backend-api/wham/usage') {
          usageCalls += 1;
          return usageCalls === 1 ? monthlyResponse() : pendingMonthly;
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

    const harness = createDashboardHarness();
    codexUsageExtension(harness.pi);

    try {
      harness.getSessionStart()?.({}, harness.ctx);
      await vi.waitFor(() => expect(requests).toHaveLength(2));
      const command = harness.getUsageHandler()?.('', harness.ctx);
      await vi.waitFor(() => expect(harness.getComponent()).toBeDefined());
      await vi.waitFor(() => expect(usageCalls).toBe(2));
      expect(harness.getComponent()).toBeDefined();
      resolveMonthly(monthlyResponse());
      await command;
    } finally {
      harness.getComponent()?.handleInput('q');
      resolveMonthly(monthlyResponse());
      fetchMock.mockRestore();
    }
  });

  it('ignores a superseded dashboard refresh', async () => {
    let usageCalls = 0;
    let rejectFirstRefresh!: () => void;
    let resolveSecondRefresh!: (response: Response) => void;
    const pendingFirstRefresh = new Promise<Response>((_resolve, reject) => {
      rejectFirstRefresh = () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      };
    });
    const pendingSecondRefresh = new Promise<Response>((resolve) => {
      resolveSecondRefresh = resolve;
    });
    const monthlyResponse = (used: number) =>
      new Response(
        JSON.stringify({
          spend_control: {
            individual_limit: {
              limit: 8000,
              used,
              remaining: 8000 - used,
              reset_at: Date.parse('2026-08-01T00:00:00Z') / 1000,
              reset_after_seconds: 1_000_000,
            },
          },
        }),
        { status: 200 }
      );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === 'https://chatgpt.com/backend-api/wham/usage') {
          usageCalls += 1;
          if (usageCalls === 1) return monthlyResponse(1000);
          if (usageCalls === 2) {
            init?.signal?.addEventListener('abort', rejectFirstRefresh, {
              once: true,
            });
            return pendingFirstRefresh;
          }
          return pendingSecondRefresh;
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });
    const harness = createDashboardHarness();
    codexUsageExtension(harness.pi);

    try {
      await harness.getUsageHandler()?.('', harness.ctx);
      harness.getComponent()?.handleInput('r');
      await vi.waitFor(() => expect(usageCalls).toBe(2));
      harness.getComponent()?.handleInput('r');
      await vi.waitFor(() => expect(usageCalls).toBe(3));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(harness.notifications).toEqual([]);

      resolveSecondRefresh(monthlyResponse(2000));
      await vi.waitFor(() =>
        expect(harness.getComponent()?.render(120).join('\\n')).toContain(
          '2k / 8k'
        )
      );
    } finally {
      harness.getComponent()?.handleInput('q');
      rejectFirstRefresh();
      resolveSecondRefresh(monthlyResponse(2000));
      fetchMock.mockRestore();
    }
  });

  it('starts cached-period analytics in parallel with monthly refresh', async () => {
    const requests: string[] = [];
    let usageCalls = 0;
    let analyticsCalls = 0;
    let oldAnalyticsSignal: AbortSignal | undefined;
    let resolveMonthly!: (response: Response) => void;
    let resolveOldAnalytics!: (response: Response) => void;
    let resolveNewAnalytics!: (response: Response) => void;
    const pendingMonthly = new Promise<Response>((resolve) => {
      resolveMonthly = resolve;
    });
    const pendingOldAnalytics = new Promise<Response>((resolve) => {
      resolveOldAnalytics = resolve;
    });
    const pendingNewAnalytics = new Promise<Response>((resolve) => {
      resolveNewAnalytics = resolve;
    });
    const monthlyResponse = (resetAt: string) =>
      new Response(
        JSON.stringify({
          spend_control: {
            individual_limit: {
              limit: 8000,
              used: 1000,
              remaining: 7000,
              reset_at: Date.parse(resetAt) / 1000,
              reset_after_seconds: 1_000_000,
            },
          },
        }),
        { status: 200 }
      );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        const url = String(input);
        requests.push(url);
        if (url === 'https://chatgpt.com/backend-api/wham/usage') {
          usageCalls += 1;
          return usageCalls === 1
            ? monthlyResponse('2026-08-01T00:00:00Z')
            : pendingMonthly;
        }
        analyticsCalls += 1;
        if (analyticsCalls === 1) {
          return new Response('', { status: 500 });
        }
        if (analyticsCalls === 2) {
          oldAnalyticsSignal = init?.signal ?? undefined;
          return pendingOldAnalytics;
        }
        return pendingNewAnalytics;
      });

    const harness = createDashboardHarness();
    codexUsageExtension(harness.pi);

    try {
      harness.getSessionStart()?.({}, harness.ctx);
      await vi.waitFor(() => expect(requests).toHaveLength(2));
      await new Promise((resolve) => setTimeout(resolve, 0));

      harness.getSessionStart()?.({}, harness.ctx);
      await vi.waitFor(() => expect(requests).toHaveLength(4));
      expect(requests[2]).toContain('group_by=day');
      expect(requests[3]).toBe('https://chatgpt.com/backend-api/wham/usage');

      resolveMonthly(monthlyResponse('2026-09-01T00:00:00Z'));
      await vi.waitFor(() => expect(analyticsCalls).toBe(3));
      expect(oldAnalyticsSignal?.aborted).toBe(true);
    } finally {
      resolveMonthly(monthlyResponse('2026-09-01T00:00:00Z'));
      resolveOldAnalytics(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );
      resolveNewAnalytics(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );
      fetchMock.mockRestore();
    }
  });

  it('starts an on-demand weekly request without waiting for daily data', async () => {
    const requests: string[] = [];
    let resolveDaily!: (response: Response) => void;
    const pendingDaily = new Promise<Response>((resolve) => {
      resolveDaily = resolve;
    });
    let analyticsRequests = 0;
    const monthlyResponse = () =>
      new Response(
        JSON.stringify({
          spend_control: {
            individual_limit: {
              limit: 8000,
              used: 1000,
              remaining: 7000,
              reset_at: Date.parse('2026-08-01T00:00:00Z') / 1000,
              reset_after_seconds: 1_000_000,
            },
          },
        }),
        { status: 200 }
      );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        requests.push(url);
        if (url === 'https://chatgpt.com/backend-api/wham/usage') {
          return monthlyResponse();
        }
        analyticsRequests += 1;
        if (analyticsRequests === 1) return pendingDaily;
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

    const harness = createDashboardHarness();
    codexUsageExtension(harness.pi);

    try {
      await harness.getUsageHandler()?.('', harness.ctx);
      expect(analyticsRequests).toBe(1);
      harness.getComponent()?.handleInput('g');
      await vi.waitFor(() =>
        expect(requests.some((url) => url.includes('group_by=week'))).toBe(true)
      );
    } finally {
      harness.getComponent()?.handleInput('q');
      resolveDaily(
        new Response(
          JSON.stringify({ data: [{ date: '2026-07-10', models: [] }] }),
          { status: 200 }
        )
      );
      fetchMock.mockRestore();
    }
  });

  it('keeps the existing chart while refreshing after a period change', async () => {
    let monthlyCalls = 0;
    let analyticsCalls = 0;
    let resolveMonthly!: (response: Response) => void;
    let resolveRefresh!: (response: Response) => void;
    const pendingMonthly = new Promise<Response>((resolve) => {
      resolveMonthly = resolve;
    });
    const pendingRefresh = new Promise<Response>((resolve) => {
      resolveRefresh = resolve;
    });
    const chartResponse = (date = '2026-07-10') =>
      new Response(
        JSON.stringify({
          data: [
            {
              date,
              models: [
                {
                  model: 'gpt-5.4',
                  credits: 1,
                  uncached_text_input_tokens: 1,
                  cached_text_input_tokens: 1,
                  text_output_tokens: 1,
                },
              ],
            },
          ],
        }),
        { status: 200 }
      );
    const monthlyResponse = (resetAt: string) =>
      new Response(
        JSON.stringify({
          spend_control: {
            individual_limit: {
              limit: 8000,
              used: 1000,
              remaining: 7000,
              reset_at: Date.parse(resetAt) / 1000,
              reset_after_seconds: 1_000_000,
            },
          },
        }),
        { status: 200 }
      );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === 'https://chatgpt.com/backend-api/wham/usage') {
          return monthlyCalls++ === 0
            ? monthlyResponse('2026-08-01T00:00:00Z')
            : pendingMonthly;
        }
        analyticsCalls += 1;
        if (analyticsCalls === 4) return pendingRefresh;
        return analyticsCalls >= 5
          ? chartResponse('2026-08-10')
          : chartResponse();
      });

    const harness = createDashboardHarness();
    codexUsageExtension(harness.pi);

    try {
      await harness.getUsageHandler()?.('', harness.ctx);
      await vi.waitFor(() => expect(analyticsCalls).toBeGreaterThanOrEqual(3));
      const render = () =>
        (
          harness.getComponent() as unknown as {
            render(width: number): string[];
          }
        )
          .render(120)
          .join('\n');
      expect(render()).toContain('07-10');

      harness.getComponent()?.handleInput('r');
      await vi.waitFor(() => {
        expect(monthlyCalls).toBe(2);
        // The refresh reloads both groupings in parallel.
        expect(analyticsCalls).toBe(5);
      });
      expect(render()).toContain('07-10');
      expect(render()).toContain('⠋');

      resolveMonthly(monthlyResponse('2026-09-01T00:00:00Z'));
      // The period rollover reloads both groupings for the new period.
      await vi.waitFor(() => expect(analyticsCalls).toBeGreaterThanOrEqual(7));
      expect(render()).toContain('08-10');
    } finally {
      harness.getComponent()?.handleInput('q');
      resolveMonthly(monthlyResponse('2026-09-01T00:00:00Z'));
      resolveRefresh(chartResponse());
      fetchMock.mockRestore();
    }
  });

  it('cancels an in-flight startup prefetch when refreshing the dashboard', async () => {
    const requests: string[] = [];
    let resolveStartup!: (response: Response) => void;
    const pendingStartup = new Promise<Response>((resolve) => {
      resolveStartup = resolve;
    });
    let startupSignal: AbortSignal | undefined;
    let analyticsRequests = 0;
    const monthlyResponse = () =>
      new Response(
        JSON.stringify({
          spend_control: {
            individual_limit: {
              limit: 8000,
              used: 1000,
              remaining: 7000,
              reset_at: Date.parse('2026-08-01T00:00:00Z') / 1000,
              reset_after_seconds: 1_000_000,
            },
          },
        }),
        { status: 200 }
      );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        const url = String(input);
        requests.push(url);
        if (url === 'https://chatgpt.com/backend-api/wham/usage') {
          return monthlyResponse();
        }
        analyticsRequests += 1;
        if (analyticsRequests === 1) {
          startupSignal = init?.signal ?? undefined;
          return pendingStartup;
        }
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      });

    const harness = createDashboardHarness();
    codexUsageExtension(harness.pi);

    try {
      harness.getSessionStart()?.({}, harness.ctx);
      await vi.waitFor(() => expect(requests).toHaveLength(2));

      await harness.getUsageHandler()?.('', harness.ctx);
      harness.getComponent()?.handleInput('r');
      await vi.waitFor(() => expect(analyticsRequests).toBeGreaterThan(1));
      expect(startupSignal?.aborted).toBe(true);
    } finally {
      harness.getComponent()?.handleInput('q');
      resolveStartup(
        new Response(
          JSON.stringify({ data: [{ date: '2026-07-10', models: [] }] }),
          { status: 200 }
        )
      );
      fetchMock.mockRestore();
    }
  });

  it('shows a spinner when switching to a group with an in-flight background load', async () => {
    const requests: string[] = [];
    let resolveWeekly!: (response: Response) => void;
    const pendingWeekly = new Promise<Response>((resolve) => {
      resolveWeekly = resolve;
    });
    const monthlyResponse = () =>
      new Response(
        JSON.stringify({
          spend_control: {
            individual_limit: {
              limit: 8000,
              used: 1000,
              remaining: 7000,
              reset_at: Date.parse('2026-08-01T00:00:00Z') / 1000,
              reset_after_seconds: 1_000_000,
            },
          },
        }),
        { status: 200 }
      );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        requests.push(url);
        if (url === 'https://chatgpt.com/backend-api/wham/usage') {
          return monthlyResponse();
        }
        if (url.includes('group_by=week')) return pendingWeekly;
        return new Response(
          JSON.stringify({ data: [{ date: '2026-07-10', models: [] }] }),
          { status: 200 }
        );
      });

    const harness = createDashboardHarness();
    codexUsageExtension(harness.pi);

    try {
      await harness.getUsageHandler()?.('', harness.ctx);
      await vi.waitFor(() =>
        expect(requests.some((url) => url.includes('group_by=week'))).toBe(true)
      );

      harness.getComponent()?.handleInput('g');
      const rendered = harness.getComponent()?.render(100).join('\n') ?? '';
      expect(rendered).toContain(SPINNER_FRAMES[0]);
    } finally {
      harness.getComponent()?.handleInput('q');
      resolveWeekly(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );
      fetchMock.mockRestore();
    }
  });

  it('refreshes both groupings and keeps the spinner after switching groups', async () => {
    let dayRequests = 0;
    let weekRequests = 0;
    let resolveRefreshWeek!: (response: Response) => void;
    const pendingRefreshWeek = new Promise<Response>((resolve) => {
      resolveRefreshWeek = resolve;
    });
    const monthlyResponse = () =>
      new Response(
        JSON.stringify({
          spend_control: {
            individual_limit: {
              limit: 8000,
              used: 1000,
              remaining: 7000,
              reset_at: Date.parse('2026-08-01T00:00:00Z') / 1000,
              reset_after_seconds: 1_000_000,
            },
          },
        }),
        { status: 200 }
      );
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const url = String(input);
        if (url === 'https://chatgpt.com/backend-api/wham/usage') {
          return monthlyResponse();
        }
        if (url.includes('group_by=week')) {
          weekRequests += 1;
          if (weekRequests === 2) return pendingRefreshWeek;
        } else {
          dayRequests += 1;
        }
        return new Response(
          JSON.stringify({ data: [{ date: '2026-07-10', models: [] }] }),
          { status: 200 }
        );
      });

    const harness = createDashboardHarness();
    codexUsageExtension(harness.pi);

    try {
      await harness.getUsageHandler()?.('', harness.ctx);
      await vi.waitFor(() => {
        expect(dayRequests).toBe(2); // current-period load + background full load
        expect(weekRequests).toBe(1); // background full load
      });

      harness.getComponent()?.handleInput('r');
      await vi.waitFor(() => {
        expect(dayRequests).toBe(3); // refresh reloads daily data
        expect(weekRequests).toBe(2); // refresh reloads weekly data too
      });

      harness.getComponent()?.handleInput('g');
      const rendered = harness.getComponent()?.render(100).join('\n') ?? '';
      expect(rendered).toContain(SPINNER_FRAMES[0]);
    } finally {
      harness.getComponent()?.handleInput('q');
      resolveRefreshWeek(
        new Response(JSON.stringify({ data: [] }), { status: 200 })
      );
      fetchMock.mockRestore();
    }
  });
});
