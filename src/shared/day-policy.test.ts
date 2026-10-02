import { describe, expect, it, vi } from 'vitest';
import { resolveDayPolicy } from './day-policy.ts';
import { MINUTES_PER_DAY } from './format.ts';
import type { MonthlyUsage } from './usage/monthly-usage.ts';

const calendar = resolveDayPolicy('calendar');
const weekdays = resolveDayPolicy('weekdays');

function createUsage(reset: string, now: Date): MonthlyUsage {
  const resetAt = Date.parse(reset) / 1000;
  return {
    limit: 8000,
    used: 4000,
    remaining: 4000,
    usedPercent: 50,
    remainingPercent: 50,
    resetAt,
    resetAfterSeconds: (resetAt * 1000 - now.getTime()) / 1000,
    fetchedAt: now.getTime(),
  };
}

const now = new Date('2026-07-17T12:00:00Z');
const usage = createUsage('2026-07-27T00:00:00Z', now);

function remainingMinutes(
  policy: typeof calendar,
  reset: string,
  clock: string
) {
  const now = new Date(clock);
  return policy.remainingMinutes(createUsage(reset, now), now);
}

describe('day policies', () => {
  it.each([
    ['calendar', 'calendar days', 'cal', 'cal'],
    ['weekdays', 'weekdays', 'wkd', 'wkdays'],
  ] as const)(
    'resolves %s with its long and short labels',
    (id, label, statusAbbreviation, dashboardLabel) => {
      expect(resolveDayPolicy(id)).toMatchObject({
        id,
        label,
        statusAbbreviation,
        dashboardLabel,
      });
    }
  );

  describe('countDays', () => {
    it('counts calendar days or weekdays in a half-open range', () => {
      const start = new Date('2026-07-13T00:00:00Z');
      const end = new Date('2026-08-01T00:00:00Z');
      expect(calendar.countDays(start, end)).toBe(19);
      expect(weekdays.countDays(start, end)).toBe(15);
      expect(calendar.countDays(start, start)).toBe(0);
      expect(weekdays.countDays(start, start)).toBe(0);
    });

    it('keeps fractional calendar days', () => {
      expect(
        calendar.countDays(
          new Date('2026-07-13T12:00:00Z'),
          new Date('2026-07-14T00:00:00Z')
        )
      ).toBe(0.5);
    });

    it('ignores sub-day jitter when counting weekdays without mutating dates', () => {
      const start = new Date('2026-09-01T00:00:00Z');
      const end = new Date('2026-10-01T00:00:01Z');
      expect(weekdays.countDays(start, end)).toBe(
        weekdays.countDays(start, new Date('2026-10-01T00:00:00Z'))
      );
      expect(start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
      expect(end.toISOString()).toBe('2026-10-01T00:00:01.000Z');
    });
  });

  describe('remainingMinutes', () => {
    const reset = '2026-08-01T00:00:00Z';

    it.each(['calendar', 'weekdays'] as const)(
      'returns undefined for an expired %s countdown',
      (id) => {
        const policy = resolveDayPolicy(id);
        expect(
          policy.remainingMinutes({ ...usage, resetAfterSeconds: 0 }, now)
        ).toBeUndefined();
        expect(
          policy.remainingMinutes(usage, new Date(usage.resetAt * 1000))
        ).toBeUndefined();
      }
    );

    it.each([
      ['calendar', 9.25],
      ['weekdays', 5.25],
    ] as const)(
      'decays cached %s time without a refetch',
      (id, remainingDays) => {
        const sixHoursLater = new Date(now.getTime() + 6 * 60 * 60 * 1000);
        expect(
          resolveDayPolicy(id).remainingMinutes(usage, sixHoursLater)
        ).toBe(remainingDays * MINUTES_PER_DAY);
      }
    );

    it('uses the current clock when none is supplied', () => {
      vi.useFakeTimers({ now, toFake: ['Date'] });
      try {
        expect(calendar.remainingMinutes(usage)).toBe(9.5 * MINUTES_PER_DAY);
        expect(weekdays.remainingMinutes(usage)).toBe(5.5 * MINUTES_PER_DAY);
      } finally {
        vi.useRealTimers();
      }
    });

    it('uses server-relative time to classify remaining weekdays', () => {
      const serverNow = new Date('2026-07-24T12:00:00Z');
      const offsetLocalNow = new Date('2026-07-25T12:00:00Z');
      const offsetUsage = {
        ...createUsage('2026-07-27T00:00:00Z', serverNow),
        fetchedAt: offsetLocalNow.getTime(),
      };
      expect(weekdays.remainingMinutes(offsetUsage, offsetLocalNow)).toBe(
        0.5 * MINUTES_PER_DAY
      );
    });

    it('preserves calendar time including weekends', () => {
      expect(remainingMinutes(calendar, reset, '2026-07-25T12:00:00Z')).toBe(
        6.5 * MINUTES_PER_DAY
      );
    });

    it('subtracts whole remaining weekends', () => {
      expect(remainingMinutes(weekdays, reset, '2026-07-13T00:00:00Z')).toBe(
        15 * MINUTES_PER_DAY
      );
    });

    it('preserves remaining time when no weekends remain', () => {
      expect(remainingMinutes(weekdays, reset, '2026-07-28T00:00:00Z')).toBe(
        4 * MINUTES_PER_DAY
      );
    });

    it('subtracts only the remaining fraction of a weekend day', () => {
      expect(remainingMinutes(weekdays, reset, '2026-07-25T12:00:00Z')).toBe(
        5 * MINUTES_PER_DAY
      );
    });

    it('returns zero when only weekend time remains', () => {
      expect(
        remainingMinutes(
          weekdays,
          '2026-07-27T00:00:00Z',
          '2026-07-25T12:00:00Z'
        )
      ).toBe(0);
    });

    it('does not lose a whole day when the reset jitters by a second', () => {
      const now = new Date('2026-09-04T12:00:00Z');
      const usage = createUsage('2026-10-01T00:00:00Z', now);
      const jittered = {
        ...usage,
        resetAt: usage.resetAt + 1,
        resetAfterSeconds: usage.resetAfterSeconds + 1,
      };
      expect(weekdays.remainingMinutes(jittered, now)).toBeCloseTo(
        weekdays.remainingMinutes(usage, now)! + 1 / 60,
        6
      );
    });
  });

  describe('periodMinutes', () => {
    it.each([
      ['calendar', '2026-08-01T00:00:00Z', 31],
      ['weekdays', '2026-08-01T00:00:00Z', 23],
      ['calendar', '2026-07-27T00:00:00Z', 56],
      ['weekdays', '2026-07-27T00:00:00Z', 40],
      ['calendar', '2024-03-01T00:00:00Z', 29],
      ['weekdays', '2024-03-01T00:00:00Z', 21],
    ] as const)('counts the full %s period ending %s', (id, reset, days) => {
      const snapshot = { ...usage, resetAt: Date.parse(reset) / 1000 };
      expect(resolveDayPolicy(id).periodMinutes(snapshot)).toBe(
        days * MINUTES_PER_DAY
      );
    });

    it('preserves fractional calendar time but ignores jitter in weekday counts', () => {
      const snapshot = {
        ...usage,
        resetAt: Date.parse('2026-10-01T00:00:00Z') / 1000,
      };
      const jittered = { ...snapshot, resetAt: snapshot.resetAt + 1 };
      expect(weekdays.periodMinutes(jittered)).toBe(
        weekdays.periodMinutes(snapshot)
      );
      expect(calendar.periodMinutes(jittered)).toBeCloseTo(
        calendar.periodMinutes(snapshot) + 1 / 60,
        6
      );
    });
  });

  describe('budgetPerDay', () => {
    it.each([
      ['calendar', 310],
      ['weekdays', 230],
    ] as const)(
      'spreads the monthly limit across %s budget days',
      (id, limit) => {
        expect(
          resolveDayPolicy(id).budgetPerDay(
            limit,
            new Date('2026-07-01'),
            new Date('2026-08-01')
          )
        ).toBe(10);
      }
    );

    it.each(['calendar', 'weekdays'] as const)(
      'returns undefined for empty or reversed %s periods',
      (id) => {
        const start = new Date('2026-07-01');
        const policy = resolveDayPolicy(id);
        expect(policy.budgetPerDay(230, start, start)).toBeUndefined();
        expect(
          policy.budgetPerDay(230, start, new Date('2026-06-01'))
        ).toBeUndefined();
      }
    );

    it('does not assign weekday budget to a weekend-only period', () => {
      const start = new Date('2026-07-25');
      const end = new Date('2026-07-27');
      expect(weekdays.budgetPerDay(200, start, end)).toBeUndefined();
      expect(calendar.budgetPerDay(200, start, end)).toBe(100);
    });

    it.each(['calendar', 'weekdays'] as const)(
      'preserves a zero limit for a valid %s period',
      (id) => {
        expect(
          resolveDayPolicy(id).budgetPerDay(
            0,
            new Date('2026-07-01'),
            new Date('2026-08-01')
          )
        ).toBe(0);
      }
    );
  });

  describe('isBudgetDay', () => {
    it.each([
      ['2026-07-24T00:00:00Z', true],
      ['2026-07-25T00:00:00Z', false],
      ['2026-07-26T00:00:00Z', false],
      ['2026-07-24T23:00:00-02:00', false],
    ] as const)('classifies %s using UTC weekdays', (input, isWeekday) => {
      const date = new Date(input);
      expect(calendar.isBudgetDay(date)).toBe(true);
      expect(weekdays.isBudgetDay(date)).toBe(isWeekday);
    });
  });
});
