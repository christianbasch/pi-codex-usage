import { describe, expect, it } from 'vitest';
import { MINUTES_PER_DAY } from './format.ts';
import {
  creditsPerDayUntilReset,
  minutesUntilReset,
  parseMonthlyUsage,
} from './monthly-usage.ts';

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
            remaining_percent: 35,
            reset_at: 1_785_542_400,
            reset_after_seconds: 864_000,
          },
        },
      })
    ).toEqual({
      limit: 8000,
      used: 5194.366,
      remaining: 2805.634,
      usedPercent: 65,
      remainingPercent: 35,
      resetAt: 1_785_542_400,
      resetAfterSeconds: 864_000,
    });
  });

  it('returns undefined when the account has no individual limit', () => {
    expect(parseMonthlyUsage({ spend_control: {} })).toBeUndefined();
  });

  it('calculates remaining minutes and credits per day through reset', () => {
    expect(minutesUntilReset(864_000)).toBe(10 * MINUTES_PER_DAY);
    expect(
      creditsPerDayUntilReset({
        limit: 8000,
        used: 5200,
        remaining: 2800,
        usedPercent: 65,
        remainingPercent: 35,
        resetAt: 1_728_864_000,
        resetAfterSeconds: 864_000,
      })
    ).toBe(280);
  });
});
