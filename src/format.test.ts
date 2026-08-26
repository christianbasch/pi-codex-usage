import { describe, expect, it } from 'vitest';
import { formatCredits, formatTokenCount } from './format.ts';

describe('formatCredits', () => {
  it('formats small values without a suffix', () => {
    expect(formatCredits(950)).toBe('950');
    expect(formatCredits(86.021505)).toBe('86.02');
  });

  it('formats large values in thousands', () => {
    expect(formatCredits(1234)).toBe('1.23k');
    expect(formatCredits(8000)).toBe('8k');
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
