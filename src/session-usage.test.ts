import type { SessionEntry } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import {
  estimateSessionCredits,
  formatSessionCreditSummary,
} from './session-usage.ts';

function assistant(
  model: string,
  usage: {
    input: number;
    cacheRead: number;
    output: number;
    cacheWrite?: number;
  },
  serviceTier?: 'default' | 'priority',
  provider = 'openai-codex'
): SessionEntry {
  return {
    type: 'message' as const,
    id: model,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant' as const,
      provider,
      model,
      usage,
      ...(serviceTier
        ? {
            diagnostics: [
              {
                type: 'codex-service-tier',
                timestamp: Date.now(),
                details: { serviceTier, source: 'requested' },
              },
            ],
          }
        : {}),
    },
  } as unknown as SessionEntry;
}

describe('session credit usage', () => {
  it('converts each Codex response using uncached, cached, and output rates', () => {
    const usage = estimateSessionCredits([
      assistant('gpt-5.6-sol', {
        input: 40_000,
        cacheRead: 10_000,
        cacheWrite: 500_000,
        output: 2_000,
      }),
    ]);

    expect(usage.totalCredits).toBeCloseTo(6.625);
    expect(usage.models).toEqual([
      {
        model: 'gpt-5.6-sol',
        credits: 6.625,
        responses: 1,
        priorityResponses: 0,
      },
    ]);
  });

  it('charges a resent context to the model that generated the response', () => {
    const usage = estimateSessionCredits([
      assistant('gpt-5.6-luna', {
        input: 8_000,
        cacheRead: 0,
        output: 1_000,
      }),
      assistant('gpt-5.6-sol', {
        input: 42_000,
        cacheRead: 0,
        output: 1_000,
      }),
    ]);

    expect(usage.models.map(({ model }) => model)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-luna',
    ]);
    expect(usage.totalCredits).toBeCloseTo(6.07);
  });

  it('applies model-specific Priority multipliers', () => {
    const usage = estimateSessionCredits([
      assistant(
        'gpt-5.6-sol',
        { input: 1_000_000, cacheRead: 0, output: 0 },
        'priority'
      ),
      assistant(
        'gpt-5.4',
        { input: 1_000_000, cacheRead: 0, output: 0 },
        'priority'
      ),
      assistant(
        'gpt-5.6-luna',
        { input: 1_000_000, cacheRead: 0, output: 0 },
        'priority'
      ),
    ]);

    expect(usage.models).toEqual([
      {
        model: 'gpt-5.6-sol',
        credits: 312.5,
        responses: 1,
        priorityResponses: 1,
      },
      {
        model: 'gpt-5.4',
        credits: 125,
        responses: 1,
        priorityResponses: 1,
      },
      {
        model: 'gpt-5.6-luna',
        credits: 12.5,
        responses: 1,
        priorityResponses: 1,
      },
    ]);
  });

  it('ignores other providers and reports unsupported Codex responses', () => {
    const usage = estimateSessionCredits([
      assistant(
        'gpt-5.6-sol',
        { input: 1_000_000, cacheRead: 0, output: 0 },
        undefined,
        'anthropic'
      ),
      assistant('gpt-5.3-codex-spark', {
        input: 1_000_000,
        cacheRead: 0,
        output: 0,
      }),
    ]);

    expect(usage.totalCredits).toBe(0);
    expect(usage.responseCount).toBe(1);
    expect(usage.unsupportedResponseCount).toBe(1);
  });

  it('formats the estimate clearly', () => {
    const usage = estimateSessionCredits([
      assistant('gpt-5.6-sol', {
        input: 1_000_000,
        cacheRead: 0,
        output: 0,
      }),
    ]);

    expect(formatSessionCreditSummary(usage, (value) => value.toFixed(2))).toBe(
      'Session: 125.00 credits est. · 5.6-sol 125.00'
    );
  });
});
