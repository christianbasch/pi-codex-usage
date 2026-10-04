import { describe, expect, it, vi } from 'vitest';
import { resolveDayPolicy } from '../shared/day-policy.ts';
import type { MonthlyUsage } from '../shared/usage/monthly-usage.ts';
import type { UsageRuntime } from '../shared/usage/usage-runtime.ts';
import {
  budgetDeviationColor,
  buildStatusSegments,
  paceColor,
  usageColor,
} from './status.ts';

const calendar = resolveDayPolicy('calendar');
const weekdays = resolveDayPolicy('weekdays');

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

describe('status bar', () => {
  describe('buildStatusSegments', () => {
    it('builds a dim skeleton with the selected day mode before usage loads', () => {
      expect(buildStatusSegments(runtime(), calendar)).toEqual([
        { text: '▒▒▒▒▒▒ ▒▒▒▒▒', color: 'dim' },
        { text: ' [cal]', color: 'dim', shimmer: false },
      ]);
      expect(buildStatusSegments(runtime(), weekdays)).toEqual([
        { text: '▒▒▒▒▒▒ ▒▒▒▒▒', color: 'dim' },
        { text: ' [wkd]', color: 'dim', shimmer: false },
      ]);
    });

    it('appends a dim, non-shimmering session estimate to the status', () => {
      expect(buildStatusSegments(runtime(), calendar, 62.5).at(-1)).toEqual({
        text: ' ~62.5 cr',
        color: 'dim',
        shimmer: false,
      });
      expect(buildStatusSegments(runtime(usage()), calendar, 0).at(-1)).toEqual(
        { text: ' ~0 cr', color: 'dim', shimmer: false }
      );
      expect(
        buildStatusSegments(
          runtime(undefined, 'Usage unavailable'),
          calendar,
          1
        ).at(-1)
      ).toEqual({ text: ' ~1 cr', color: 'dim', shimmer: false });
    });

    it('builds the fallback status when usage is unavailable', () => {
      expect(
        buildStatusSegments(runtime(undefined, 'Usage unavailable'), calendar)
      ).toEqual([{ text: '[Usage: Usage unavailable]', color: 'muted' }]);
    });

    it('builds usage and the selected day mode', () => {
      const segments = buildStatusSegments(
        runtime(usage({ usedPercent: 85 })),
        weekdays
      );

      expect(segments[0]).toEqual({ text: '85%/8k', color: 'warning' });
      expect(segments.at(-1)).toEqual({
        text: ' [wkd]',
        color: 'dim',
        shimmer: false,
      });
    });

    it('omits deviation when the budget or period time is unavailable', () => {
      for (const monthlyUsage of [
        usage({ limit: 0 }),
        usage({ resetAfterSeconds: 0 }),
      ]) {
        const segments = buildStatusSegments(runtime(monthlyUsage), calendar);
        expect(segments).toHaveLength(2);
        expect(segments[1]).toEqual({
          text: ' [cal]',
          color: 'dim',
          shimmer: false,
        });
      }
    });

    it('colors usage from the percentage displayed to the user', () => {
      expect(
        buildStatusSegments(runtime(usage({ usedPercent: 79.6 })), calendar)[0]
      ).toEqual({
        text: '80%/8k',
        color: 'warning',
      });
      expect(
        buildStatusSegments(runtime(usage({ usedPercent: 89.6 })), calendar)[0]
      ).toEqual({
        text: '90%/8k',
        color: 'error',
      });
    });

    it('formats and colors deviation from the displayed percentage points', () => {
      const now = new Date('2026-07-16T12:00:00Z');
      const periodStart = Date.parse('2026-07-01T00:00:00Z');
      const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
      const periodProgress =
        (now.getTime() - periodStart) / (resetAt * 1000 - periodStart);
      vi.useFakeTimers();
      vi.setSystemTime(now);

      try {
        for (const [deviation, text, color] of [
          [-5.04, ' -5.0 pp', 'success'],
          [-4.94, ' -4.9 pp', 'warning'],
          [-0.01, ' 0.0 pp', 'warning'],
          [0, ' 0.0 pp', 'warning'],
          [0.01, ' 0.0 pp', 'warning'],
          [5.04, ' +5.0 pp', 'warning'],
          [5.06, ' +5.1 pp', 'error'],
        ] as const) {
          const limit = 8000;
          const used = limit * (periodProgress + deviation / 100);
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

          expect(
            buildStatusSegments(runtime(monthlyUsage), calendar)[1]
          ).toEqual({
            text,
            color,
          });
        }
      } finally {
        vi.useRealTimers();
      }
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

  describe('budgetDeviationColor', () => {
    it('colors deviation green at or below -5 pp', () => {
      expect(budgetDeviationColor(-5)).toBe('success');
      expect(budgetDeviationColor(-20)).toBe('success');
    });

    it('colors deviation yellow above -5 pp through +5 pp', () => {
      expect(budgetDeviationColor(-4.99)).toBe('warning');
      expect(budgetDeviationColor(0)).toBe('warning');
      expect(budgetDeviationColor(5)).toBe('warning');
    });

    it('colors deviation red above +5 pp', () => {
      expect(budgetDeviationColor(5.01)).toBe('error');
      expect(budgetDeviationColor(20)).toBe('error');
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
});
