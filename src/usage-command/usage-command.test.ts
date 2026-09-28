import type {
  ExtensionAPI,
  ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
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
  it('delegates TUI commands to the dashboard opener', async () => {
    const ctx = { mode: 'tui' } as ExtensionContext;
    const openDashboard = vi.fn().mockResolvedValue(undefined);
    const deps: UsageCommandDeps = {
      usageRuntime: new UsageRuntime(() => Promise.resolve(undefined)),
      getDayPolicy: () => 'calendar',
      startUsageRefresh: vi.fn(),
      openDashboard,
    };
    const handler = register(deps);

    await handler?.('', ctx);

    expect(openDashboard).toHaveBeenCalledWith(ctx);
    expect(deps.startUsageRefresh).not.toHaveBeenCalled();
  });
});
