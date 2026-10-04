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

    it('defaults to pace when no display mode is supplied', () => {
      vi.useFakeTimers({ now: new Date('2026-07-16T12:00:00Z') });
      try {
        const monthlyUsage = usage({
          used: 4400,
          resetAt: Date.parse('2026-08-01T00:00:00Z') / 1000,
          resetAfterSeconds: 15.5 * 24 * 60 * 60,
        });
        expect(buildStatusSegments(runtime(monthlyUsage), calendar)[1]).toEqual(
          {
            text: ' 1.10×',
            color: 'error',
          }
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it.each([
      ['pace', ' 1.10×', 'error'],
      ['pp', ' +5.0 pp', 'warning'],
      ['credits', ' Δ+400 cr', 'warning'],
    ] as const)('shows the selected %s mode', (mode, text, color) => {
      vi.useFakeTimers({ now: new Date('2026-07-16T12:00:00Z') });
      try {
        const monthlyUsage = usage({
          used: 4400,
          usedPercent: 55,
          resetAt: Date.parse('2026-08-01T00:00:00Z') / 1000,
          resetAfterSeconds: 15.5 * 24 * 60 * 60,
        });
        expect(
          buildStatusSegments(runtime(monthlyUsage), calendar, 42, mode)
        ).toEqual([
          { text: '55%/8k', color: 'muted' },
          { text, color },
          { text: ' [cal]', color: 'dim', shimmer: false },
          { text: ' ~42 cr', color: 'dim', shimmer: false },
        ]);
      } finally {
        vi.useRealTimers();
      }
    });

    it.each([3, 15, 27])(
      'uses the same deviation color in pp and credits after %i days',
      (elapsedDays) => {
        const now = new Date(Date.UTC(2026, 5, 1 + elapsedDays));
        const resetAt = Date.parse('2026-07-01T00:00:00Z') / 1000;
        vi.useFakeTimers({ now });
        try {
          for (const [deviation, color] of [
            [-5.04, 'success'],
            [-4.94, 'success'],
            [0, 'success'],
            [0.01, 'success'],
            [0.06, 'warning'],
            [5.04, 'warning'],
            [5.06, 'error'],
          ] as const) {
            const monthlyUsage = usage({
              limit: 1000,
              used: 1000 * (elapsedDays / 30 + deviation / 100),
              resetAt,
              resetAfterSeconds: (resetAt * 1000 - now.getTime()) / 1000,
            });
            for (const mode of ['pp', 'credits'] as const) {
              expect(
                buildStatusSegments(
                  runtime(monthlyUsage),
                  calendar,
                  undefined,
                  mode
                )[1]?.color
              ).toBe(color);
            }
          }
        } finally {
          vi.useRealTimers();
        }
      }
    );

    it.each([3, 15, 27])(
      'uses static pace colors after %i days',
      (elapsedDays) => {
        const now = new Date(Date.UTC(2026, 5, 1 + elapsedDays));
        const resetAt = Date.parse('2026-07-01T00:00:00Z') / 1000;
        vi.useFakeTimers({ now });
        try {
          for (const [ratio, text, color] of [
            [0.95, ' 0.95×', 'success'],
            [1, ' 1.00×', 'success'],
            [1.004, ' 1.00×', 'success'],
            [1.006, ' 1.01×', 'warning'],
            [1.054, ' 1.05×', 'warning'],
            [1.056, ' 1.06×', 'error'],
          ] as const) {
            const monthlyUsage = usage({
              limit: 1000,
              used: ((1000 * elapsedDays) / 30) * ratio,
              resetAt,
              resetAfterSeconds: (resetAt * 1000 - now.getTime()) / 1000,
            });
            expect(
              buildStatusSegments(
                runtime(monthlyUsage),
                calendar,
                undefined,
                'pace'
              )[1]
            ).toEqual({ text, color });
          }
        } finally {
          vi.useRealTimers();
        }
      }
    );

    it.each([
      [-5.04, ' -5.0 pp', 'success'],
      [-4.94, ' -4.9 pp', 'success'],
      [-0.01, ' 0.0 pp', 'success'],
      [0.01, ' 0.0 pp', 'success'],
      [0.06, ' +0.1 pp', 'warning'],
      [5.04, ' +5.0 pp', 'warning'],
      [5.06, ' +5.1 pp', 'error'],
    ] as const)(
      'rounds %s pp consistently with its color',
      (deviation, text, color) => {
        vi.useFakeTimers({ now: new Date('2026-07-16T12:00:00Z') });
        try {
          const monthlyUsage = usage({
            used: 8000 * (0.5 + deviation / 100),
            resetAt: Date.parse('2026-08-01T00:00:00Z') / 1000,
            resetAfterSeconds: 15.5 * 24 * 60 * 60,
          });
          expect(
            buildStatusSegments(
              runtime(monthlyUsage),
              calendar,
              undefined,
              'pp'
            )[1]
          ).toEqual({ text, color });
        } finally {
          vi.useRealTimers();
        }
      }
    );

    it('omits pace at period start but displays zero deviation', () => {
      vi.useFakeTimers({ now: new Date('2026-07-01T00:00:00Z') });
      try {
        const monthlyUsage = usage({
          used: 0,
          resetAt: Date.parse('2026-08-01T00:00:00Z') / 1000,
          resetAfterSeconds: 31 * 24 * 60 * 60,
        });
        expect(
          buildStatusSegments(
            runtime(monthlyUsage),
            calendar,
            undefined,
            'pace'
          )
        ).toHaveLength(2);
        expect(
          buildStatusSegments(
            runtime(monthlyUsage),
            calendar,
            undefined,
            'pp'
          )[1]
        ).toEqual({ text: ' 0.0 pp', color: 'success' });
        expect(
          buildStatusSegments(
            runtime(monthlyUsage),
            calendar,
            undefined,
            'credits'
          )[1]
        ).toEqual({ text: ' Δ0 cr', color: 'success' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('formats signed credit deviation without changing percentage-based colors', () => {
      const now = new Date('2026-07-16T12:00:00Z');
      const periodStart = Date.parse('2026-07-01T00:00:00Z');
      const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
      const periodProgress =
        (now.getTime() - periodStart) / (resetAt * 1000 - periodStart);
      vi.useFakeTimers();
      vi.setSystemTime(now);

      try {
        for (const [deviationCredits, text, color] of [
          [-4000, ' Δ−4k cr', 'success'],
          [-403.2, ' Δ−403 cr', 'success'],
          [-395.2, ' Δ−395 cr', 'success'],
          [-0.8, ' Δ−1 cr', 'success'],
          [-0.4, ' Δ0 cr', 'success'],
          [0, ' Δ0 cr', 'success'],
          [0.4, ' Δ0 cr', 'success'],
          [0.8, ' Δ+1 cr', 'success'],
          [8, ' Δ+8 cr', 'warning'],
          [403.2, ' Δ+403 cr', 'warning'],
          [404.8, ' Δ+405 cr', 'error'],
          [1200, ' Δ+1.2k cr', 'error'],
        ] as const) {
          const limit = 8000;
          const used = limit * periodProgress + deviationCredits;
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
            buildStatusSegments(
              runtime(monthlyUsage),
              calendar,
              undefined,
              'credits'
            )[1]
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

  it('scales displayed credits with the limit while keeping the same colors', () => {
    const now = new Date('2026-07-16T12:00:00Z');
    const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;
    vi.useFakeTimers({ now });
    try {
      for (const [limit, text] of [
        [1000, ' Δ+50 cr'],
        [8000, ' Δ+400 cr'],
      ] as const) {
        const monthlyUsage = usage({
          limit,
          used: limit * 0.55,
          resetAt,
          resetAfterSeconds: (resetAt * 1000 - now.getTime()) / 1000,
          fetchedAt: now.getTime(),
        });
        expect(
          buildStatusSegments(
            runtime(monthlyUsage),
            calendar,
            undefined,
            'credits'
          )[1]
        ).toEqual({
          text,
          color: 'warning',
        });
      }
    } finally {
      vi.useRealTimers();
    }
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
    it('colors deviation green at or below 0 pp', () => {
      expect(budgetDeviationColor(0)).toBe('success');
      expect(budgetDeviationColor(-0.01)).toBe('success');
      expect(budgetDeviationColor(-20)).toBe('success');
    });

    it('colors deviation yellow above 0 pp through +5 pp', () => {
      expect(budgetDeviationColor(0.01)).toBe('warning');
      expect(budgetDeviationColor(5)).toBe('warning');
    });

    it('colors deviation red above +5 pp', () => {
      expect(budgetDeviationColor(5.01)).toBe('error');
      expect(budgetDeviationColor(20)).toBe('error');
    });
  });

  describe('paceColor', () => {
    it('colors pace green at or below 1', () => {
      expect(paceColor(1)).toBe('success');
      expect(paceColor(0.95)).toBe('success');
      expect(paceColor(0.8)).toBe('success');
    });

    it('colors pace yellow above 1 through 1.05', () => {
      expect(paceColor(1.001)).toBe('warning');
      expect(paceColor(1.05)).toBe('warning');
    });

    it('colors pace red above 1.05', () => {
      expect(paceColor(1.3)).toBe('error');
    });
  });
});
