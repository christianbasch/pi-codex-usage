import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import { resolveDayPolicy } from '../shared/day-policy.ts';
import { UsageRuntime } from '../shared/usage/usage-runtime.ts';
import {
  registerUsageCommand,
  type UsageCommandDeps,
} from './usage-command.ts';

function register(deps: UsageCommandDeps) {
  let handler:
    | ((args: string, ctx: ExtensionContext) => Promise<void>)
    | undefined;
  const pi = {
    registerCommand(
      _name: string,
      command: {
        handler: (args: string, ctx: ExtensionContext) => Promise<void>;
      }
    ) {
      handler = command.handler;
    },
  } as unknown as ExtensionAPI;

  registerUsageCommand(pi, deps);
  return handler;
}

describe('registerUsageCommand', () => {
  it('uses the injected policy for remaining time outside the TUI', async () => {
    const notify = vi.fn();
    const ctx = {
      mode: 'rpc',
      model: { provider: 'openai-codex' },
      sessionManager: { getEntries: () => [] },
      ui: { notify },
    } as unknown as ExtensionContext;
    const usage = {
      limit: 8000,
      used: 1000,
      remaining: 7000,
      usedPercent: 12.5,
      remainingPercent: 87.5,
      resetAt: Date.now() / 1000 + 864_000,
      resetAfterSeconds: 864_000,
      fetchedAt: Date.now(),
    };
    const policy = {
      ...resolveDayPolicy('calendar'),
      remainingMinutes: vi.fn().mockReturnValue(600),
    };
    const usageRuntime = new UsageRuntime(
      () => Promise.resolve('token'),
      async () => usage
    );
    const handler = register({
      usageRuntime,
      getDayPolicy: () => policy,
      startUsageRefresh: () => usageRuntime.startRefresh(),
      openDashboard: vi.fn(),
    });

    await handler?.('', ctx);

    expect(policy.remainingMinutes).toHaveBeenCalledWith(
      usage.resetAt,
      expect.any(Number)
    );
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('10:00 left'),
      'info'
    );
  });

  it('delegates TUI commands to the dashboard opener', async () => {
    const ctx = { mode: 'tui' } as ExtensionContext;
    const openDashboard = vi.fn().mockResolvedValue(undefined);
    const deps: UsageCommandDeps = {
      usageRuntime: new UsageRuntime(() => Promise.resolve(undefined)),
      getDayPolicy: () => resolveDayPolicy('calendar'),
      startUsageRefresh: vi.fn(),
      openDashboard,
    };
    const handler = register(deps);

    await handler?.('', ctx);

    expect(openDashboard).toHaveBeenCalledWith(ctx);
    expect(deps.startUsageRefresh).not.toHaveBeenCalled();
  });
});
