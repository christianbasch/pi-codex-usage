import { describe, expect, it, vi } from 'vitest';
import type { MonthlyUsage } from './monthly-usage.ts';
import { buildStatusSegments, paceColor } from './status.ts';
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
      { text: '▒▒▒▒▒▒ ▒ ▒▒▒▒▒▒▒', color: 'dim' },
      { text: ' [cal]', color: 'dim', shimmer: false },
    ]);
    expect(buildStatusSegments(runtime(), 'weekdays')).toEqual([
      { text: '▒▒▒▒▒▒ ▒ ▒▒▒▒▒▒▒', color: 'dim' },
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

    expect(segments[0]).toEqual({ text: '85%/8k', color: 'muted' });
    expect(segments.at(-1)).toEqual({
      text: ' [wkd]',
      color: 'dim',
      shimmer: false,
    });
  });

  it('keeps usage neutral regardless of the percentage used', () => {
    expect(
      buildStatusSegments(runtime(usage({ usedPercent: 79.6 })), 'calendar')[0]
    ).toEqual({
      text: '80%/8k',
      color: 'muted',
    });
    expect(
      buildStatusSegments(runtime(usage({ usedPercent: 89.6 })), 'calendar')[0]
    ).toEqual({
      text: '90%/8k',
      color: 'muted',
    });
  });

  it('shows and colors the relationship between usage and period progress', () => {
    const now = new Date('2026-07-16T12:00:00Z');
    const periodStart = Date.parse('2026-07-01T00:00:00Z');
    const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
    const periodProgress =
      (now.getTime() - periodStart) / (resetAt * 1000 - periodStart);
    vi.useFakeTimers();
    vi.setSystemTime(now);

    try {
      for (const [ratio, operator, color] of [
        [0.9, '<', 'success'],
        [1, '≈', 'warning'],
        [1.1, '>', 'error'],
      ] as const) {
        const limit = 8000;
        const used = limit * ratio * periodProgress;
        const monthlyUsage = usage({
          limit,
          used,
          remaining: limit - used,
          usedPercent: (used / limit) * 100,
          remainingPercent: ((limit - used) / limit) * 100,
          resetAt,
          resetAfterSeconds: (resetAt * 1000 - now.getTime()) / 1000,
          fetchedAt: now.getTime(),
        });
        const segments = buildStatusSegments(runtime(monthlyUsage), 'calendar');

        expect(segments[1]).toEqual({ text: ' ', color: 'muted' });
        expect(segments[2]).toEqual({ text: operator, color, bold: true });
        expect(segments[3]).toEqual({
          text: ' 50%/31d',
          color: 'muted',
        });
      }
    } finally {
      vi.useRealTimers();
    }
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
