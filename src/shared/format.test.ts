import { describe, expect, it } from 'vitest';
import {
  formatCredits,
  formatPeriodBudget,
  formatRemainingTime,
  formatTokenCount,
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
} from './format.ts';

describe('formatRemainingTime', () => {
  it('shows only full days when at least two days remain', () => {
    expect(formatRemainingTime(3 * MINUTES_PER_DAY + 30)).toBe('3d');
  });

  it('shows full days and hours when one to two days remain', () => {
    expect(
      formatRemainingTime(1 * MINUTES_PER_DAY + 5 * MINUTES_PER_HOUR + 30)
    ).toBe('1d 5h');
  });

  it('shows hours and minutes when less than one day remains', () => {
    expect(formatRemainingTime(11 * MINUTES_PER_HOUR + 26)).toBe('11:26');
  });

  it('shows zero time and omits an unavailable value', () => {
    expect(formatRemainingTime(0)).toBe('0:00');
    expect(formatRemainingTime(undefined)).toBeUndefined();
  });
});

describe('formatPeriodBudget', () => {
  it('shows absolute credits when less than a day remains', () => {
    expect(formatPeriodBudget(720, 100, 200)).toBe('100 remaining');
  });

  it('shows the daily budget when at least a day remains', () => {
    expect(formatPeriodBudget(MINUTES_PER_DAY, 100, 200)).toBe('200/day');
  });

  it('omits the budget when no daily budget is available', () => {
    expect(formatPeriodBudget(undefined, 100, undefined)).toBe('');
  });
});

describe('formatCredits', () => {
  it('formats small values without a suffix', () => {
    expect(formatCredits(950)).toBe('950');
    expect(formatCredits(86.021505)).toBe('86.02');
  });

  it('formats large values compactly', () => {
    expect(formatCredits(1234)).toBe('1.23k');
    expect(formatCredits(8000)).toBe('8k');
    expect(formatCredits(999_990)).toBe('999.99k');
    expect(formatCredits(1_000_000)).toBe('1m');
  });

  it('keeps the sign of negative values', () => {
    expect(formatCredits(-2000)).toBe('-2k');
  });
});

describe('formatTokenCount', () => {
  it('formats small values without a suffix', () => {
    expect(formatTokenCount(950)).toBe('950');
  });

  it('uses thousands and millions suffixes', () => {
    expect(formatTokenCount(1234)).toBe('1.23k');
    expect(formatTokenCount(1_234_567)).toBe('1.23m');
  });

  it('keeps the sign of negative values', () => {
    expect(formatTokenCount(-2000)).toBe('-2k');
  });
});
