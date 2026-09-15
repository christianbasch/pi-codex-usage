import { describe, expect, it } from 'vitest';
import type { MonthlyUsage } from './monthly-usage.ts';
import { buildStatusSegments, paceColor, usageColor } from './status.ts';
import type { UsageRuntime } from './usage-runtime.ts';

function usage(overrides: Partial<MonthlyUsage> = {}): MonthlyUsage {
  return {
    limit: 8000,
    used: 4000,
    remaining: 4000,
    usedPercent: 50,
    remainingPercent: 50,
    resetAt: Date.now() / 1000 + 10 * 24 * 60 * 60,
    resetAfterSeconds: 10 * 24 * 60 * 60,
    fetchedAt: Date.now(),
    ...overrides,
  };
}

function runtime(
  currentUsage: MonthlyUsage | undefined = undefined,
  error: string | undefined = undefined
): Pick<UsageRuntime, 'currentUsage' | 'error'> {
  return { currentUsage, error };
}

describe('buildStatusSegments', () => {
  it('builds a dim skeleton with the selected day mode before usage loads', () => {
    expect(buildStatusSegments(runtime(), 'calendar')).toEqual([
      { text: '▒▒▒▒▒▒ ▒▒▒▒▒', color: 'dim' },
      { text: ' [cal]', color: 'dim', shimmer: false },
    ]);
    expect(buildStatusSegments(runtime(), 'weekdays')).toEqual([
      { text: '▒▒▒▒▒▒ ▒▒▒▒▒', color: 'dim' },
      { text: ' [wkd]', color: 'dim', shimmer: false },
    ]);
  });

  it('builds the fallback status when usage is unavailable', () => {
    expect(
      buildStatusSegments(runtime(undefined, 'Usage unavailable'), 'calendar')
    ).toEqual([{ text: '[Usage: Usage unavailable]', color: 'muted' }]);
  });

  it('builds usage and the selected day mode', () => {
    const segments = buildStatusSegments(
      runtime(usage({ usedPercent: 85 })),
      'weekdays'
    );

    expect(segments[0]).toEqual({ text: '85%/8k', color: 'warning' });
    expect(segments.at(-1)).toEqual({
      text: ' [wkd]',
      color: 'dim',
      shimmer: false,
    });
  });
});

describe('usageColor', () => {
  it('keeps usage muted below 80%', () => {
    expect(usageColor(79)).toBe('muted');
  });

  it('colors usage warning from 80% to below 90%', () => {
    expect(usageColor(80)).toBe('warning');
    expect(usageColor(89.99)).toBe('warning');
  });

  it('colors usage error at or above 90%', () => {
    expect(usageColor(90)).toBe('error');
  });
});

describe('paceColor', () => {
  it('colors pace green at or below 0.95', () => {
    expect(paceColor(0.95)).toBe('success');
    expect(paceColor(0.8)).toBe('success');
  });

  it('colors pace yellow between 0.95 and 1.05', () => {
    expect(paceColor(1)).toBe('warning');
    expect(paceColor(1.05)).toBe('warning');
  });

  it('colors pace red above 1.05', () => {
    expect(paceColor(1.3)).toBe('error');
  });
});
