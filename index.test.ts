import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import codexUsageExtension from './index.ts';

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  inverse: (text: string) => text,
};

describe('usage dashboard loading', () => {
  it('starts current-period daily analytics before the monthly request', async () => {
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
      await usageHandler?.('', ctx);
      await vi.waitFor(() => expect(requests.length).toBeGreaterThanOrEqual(4));

      expect(requests[0]).toContain('group_by=day');
      expect(requests[1]).toBe('https://chatgpt.com/backend-api/wham/usage');
    } finally {
      component?.handleInput('q');
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
});
