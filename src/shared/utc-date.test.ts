import { describe, expect, it } from 'vitest';
import {
  addUtcDays,
  formatDate,
  startOfNextUtcMonth,
  startOfUtcDay,
  startOfUtcMonth,
  startOfUtcWeek,
} from './utc-date.ts';

describe('UTC dates', () => {
  it('normalizes to UTC midnight without mutating the input', () => {
    const date = new Date('2026-07-17T23:30:00-02:00');
    expect(startOfUtcDay(date)).toEqual(new Date('2026-07-18T00:00:00Z'));
    expect(date.toISOString()).toBe('2026-07-18T01:30:00.000Z');
    expect(formatDate(date)).toBe('2026-07-18');
  });

  it.each([
    ['2024-02-28', 1, '2024-02-29'],
    ['2024-02-29', 1, '2024-03-01'],
    ['2026-01-01', -1, '2025-12-31'],
    ['2026-03-08', 1, '2026-03-09'],
  ] as const)(
    'shifts %s by %i UTC days to %s without mutation',
    (input, days, expected) => {
      const date = new Date(input);
      expect(formatDate(addUtcDays(date, days))).toBe(expected);
      expect(formatDate(date)).toBe(input);
    }
  );

  it('returns Sunday and month boundaries at UTC midnight', () => {
    const date = new Date('2026-12-31T12:34:56Z');
    expect(startOfUtcWeek(date)).toEqual(new Date('2026-12-27T00:00:00Z'));
    expect(startOfUtcMonth(date)).toEqual(new Date('2026-12-01T00:00:00Z'));
    expect(startOfNextUtcMonth(date)).toEqual(new Date('2027-01-01T00:00:00Z'));
    expect(date.toISOString()).toBe('2026-12-31T12:34:56.000Z');
  });
});
