import { describe, expect, it } from 'vitest';
import {
  creditsPerDayUntilReset,
  daysUntilReset,
  parseMonthlyUsage,
} from './usage.ts';

describe('parseMonthlyUsage', () => {
  it('parses the individual monthly spend control', () => {
    expect(
      parseMonthlyUsage({
        spend_control: {
          individual_limit: {
            limit: '8000',
            used: '5194.366',
            remaining: '2805.634',
            used_percent: 65,
            reset_at: 1_785_542_400,
          },
        },
      })
    ).toEqual({
      limit: 8000,
      used: 5194.366,
      remaining: 2805.634,
      usedPercent: 65,
      resetAt: 1_785_542_400,
    });
  });

  it('returns undefined when the account has no individual limit', () => {
    expect(parseMonthlyUsage({ spend_control: {} })).toBeUndefined();
  });

  it('calculates remaining days and credits per day through reset', () => {
    const now = 1_728_000_000_000;
    const resetAt = 1_728_864_000;
    expect(daysUntilReset(resetAt, now)).toBe(10);
    expect(
      creditsPerDayUntilReset(
        {
          limit: 8000,
          used: 5200,
          remaining: 2800,
          usedPercent: 65,
          resetAt,
        },
        now
      )
    ).toBe(280);
  });
});
