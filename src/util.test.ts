import { describe, expect, it } from 'vitest';
import { cycle, cycleOption } from './util.ts';

describe('cycle', () => {
  it('advances to the next option', () => {
    expect(cycle(['a', 'b', 'c'], 'a')).toBe('b');
    expect(cycle(['a', 'b', 'c'], 'b')).toBe('c');
  });

  it('wraps around to the first option', () => {
    expect(cycle(['a', 'b', 'c'], 'c')).toBe('a');
  });

  it('returns the first option for unknown values', () => {
    expect(cycle(['a', 'b'], 'zzz')).toBe('a');
  });

  it('handles single-option lists', () => {
    expect(cycle(['a'], 'a')).toBe('a');
  });
});

describe('cycleOption', () => {
  const options = [
    { id: 'newest', label: 'newest' },
    { id: 'oldest', label: 'oldest' },
    { id: 'usage', label: 'usage' },
  ] as const;

  it('advances to the next option id', () => {
    expect(cycleOption(options, 'newest')).toBe('oldest');
  });

  it('wraps around to the first option id', () => {
    expect(cycleOption(options, 'usage')).toBe('newest');
  });

  it('returns the first option id for unknown values', () => {
    expect(cycleOption(options, 'zzz' as 'newest')).toBe('newest');
  });
});
