import { describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY } from './format.ts';
import {
  creditsPerDayUntilReset,
  isCurrentPeriod,
  type MonthlyUsage,
  minutesUntilReset,
  parseMonthlyUsage,
} from './monthly-usage.ts';

const FETCHED_AT = Date.parse('2026-07-17T12:00:00Z');

function usage(overrides: Partial<MonthlyUsage> = {}): MonthlyUsage {
  return {
    limit: 8000,
    used: 5200,
    remaining: 2800,
    usedPercent: 65,
    remainingPercent: 35,
    resetAt: 1_728_864_000,
    resetAfterSeconds: 864_000,
    fetchedAt: FETCHED_AT,
    ...overrides,
  };
}

describe('parseMonthlyUsage', () => {
  it('parses the individual monthly spend control', () => {
    expect(
      parseMonthlyUsage(
        {
          spend_control: {
            individual_limit: {
              limit: '8000',
              used: '5194.366',
              remaining: '2805.634',
              used_percent: 65,
              remaining_percent: 35,
              reset_at: 1_785_542_400,
              reset_after_seconds: 864_000,
            },
          },
        },
        FETCHED_AT
      )
    ).toEqual({
      limit: 8000,
      used: 5194.366,
      remaining: 2805.634,
      usedPercent: 65,
      remainingPercent: 35,
      resetAt: 1_785_542_400,
      resetAfterSeconds: 864_000,
      fetchedAt: FETCHED_AT,
    });
  });

  it('returns undefined when the account has no individual limit', () => {
    expect(parseMonthlyUsage({ spend_control: {} })).toBeUndefined();
  });

  it('calculates remaining minutes and credits per day through reset', () => {
    const now = new Date(FETCHED_AT);
    expect(minutesUntilReset(usage(), now)).toBe(10 * MINUTES_PER_DAY);
    expect(creditsPerDayUntilReset(usage(), now)).toBe(280);
  });

  it('reduces remaining minutes by the time elapsed since the fetch', () => {
    // The server value is a snapshot, so a day later only 9 days remain.
    const aDayLater = new Date(FETCHED_AT + MINUTES_PER_DAY * 60 * 1000);
    expect(minutesUntilReset(usage(), aDayLater)).toBe(9 * MINUTES_PER_DAY);
    expect(creditsPerDayUntilReset(usage(), aDayLater)).toBeCloseTo(
      2800 / 9,
      6
    );
  });

  it('treats a fully elapsed snapshot as having no time left', () => {
    const afterReset = new Date(FETCHED_AT + 864_000 * 1000);
    expect(minutesUntilReset(usage(), afterReset)).toBeUndefined();
    expect(creditsPerDayUntilReset(usage(), afterReset)).toBeUndefined();
  });
});

describe('isCurrentPeriod', () => {
  const resetAt = Date.parse('2026-08-01T00:00:00Z') / 1000;

  it('accepts a snapshot whose reset is still ahead', () => {
    expect(
      isCurrentPeriod(usage({ resetAt }), new Date('2026-07-31T23:59:00Z'))
    ).toBe(true);
  });

  it('rejects a snapshot whose reset has passed', () => {
    expect(
      isCurrentPeriod(usage({ resetAt }), new Date('2026-08-01T00:00:01Z'))
    ).toBe(false);
  });

  it('rejects a missing snapshot', () => {
    expect(isCurrentPeriod(undefined)).toBe(false);
  });
});
