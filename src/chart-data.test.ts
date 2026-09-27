import { describe, expect, it } from 'vitest';
import { sumCreditsInDateRange } from './chart-data.ts';
import type { WorkspaceUserTokenUsage } from './analytics.ts';

function row(date: string, credits: number[]): WorkspaceUserTokenUsage {
  return {
    date,
    models: credits.map((value, index) => ({
      model: `model-${index}`,
      credits: value,
      uncached_text_input_tokens: 0,
      cached_text_input_tokens: 0,
      text_output_tokens: 0,
    })),
  };
}

describe('sumCreditsInDateRange', () => {
  it('sums rows in a half-open date range', () => {
    expect(
      sumCreditsInDateRange(
        [row('2026-09-01', [2, 3]), row('2026-09-02', [4]), row('2026-09-03', [8])],
        '2026-09-01',
        '2026-09-03'
      )
    ).toBe(9);
  });
});
