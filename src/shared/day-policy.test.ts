import { describe, expect, it } from 'vitest';
import { dayPolicyLabel, resolveDayPolicy } from './day-policy.ts';
import { MINUTES_PER_DAY } from './format.ts';

const calendar = resolveDayPolicy('calendar');
const weekdays = resolveDayPolicy('weekdays');

function remainingMinutes(policy: typeof calendar, reset: string, now: string) {
  const resetAt = Date.parse(reset) / 1000;
  const calendarMinutes = (resetAt * 1000 - Date.parse(now)) / 60_000;
  return policy.remainingMinutes(resetAt, calendarMinutes);
}

describe('day policies', () => {
  it('resolves each ID to a strategy with its label', () => {
    expect(calendar.id).toBe('calendar');
    expect(calendar.label).toBe(dayPolicyLabel('calendar'));
    expect(calendar.label).toBe('calendar days');
    expect(weekdays.id).toBe('weekdays');
    expect(weekdays.label).toBe(dayPolicyLabel('weekdays'));
    expect(weekdays.label).toBe('weekdays');
  });

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
      const resetAt = Date.parse('2026-10-01T00:00:00Z') / 1000;
      const now = Date.parse('2026-09-04T12:00:00Z');
      const minutes = (resetAt * 1000 - now) / 60_000;
      expect(
        weekdays.remainingMinutes(resetAt + 1, minutes + 1 / 60)
      ).toBeCloseTo(weekdays.remainingMinutes(resetAt, minutes) + 1 / 60, 6);
    });
  });

  describe('isBudgetDay', () => {
    it('uses UTC weekdays, excluding Saturday and Sunday only for weekday mode', () => {
      for (const date of ['2026-07-24', '2026-07-25', '2026-07-26']) {
        expect(calendar.isBudgetDay(new Date(`${date}T00:00:00Z`))).toBe(true);
      }
      expect(weekdays.isBudgetDay(new Date('2026-07-24T00:00:00Z'))).toBe(true);
      expect(weekdays.isBudgetDay(new Date('2026-07-25T00:00:00Z'))).toBe(
        false
      );
      expect(weekdays.isBudgetDay(new Date('2026-07-26T00:00:00Z'))).toBe(
        false
      );
      expect(weekdays.isBudgetDay(new Date('2026-07-24T23:00:00-02:00'))).toBe(
        false
      );
    });
  });
});
