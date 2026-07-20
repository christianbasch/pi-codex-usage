import type { Theme } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import type { UsageAnalytics } from './analytics.ts';
import {
  calculateBarLength,
  calculateSegmentBarLengths,
  calculateTokenBarLengths,
  sortModelSegments,
  UsageModal,
} from './modal.ts';

const theme = {
  fg: (_color: string, text: string) => text,
} as unknown as Theme;

function createAnalytics(): UsageAnalytics {
  const workspaceUser = Array.from({ length: 11 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, '0')}`,
    models: [
      {
        model: 'gpt-5.4',
        credits: index + 1,
        uncached_text_input_tokens: 100,
        cached_text_input_tokens: 100,
        text_output_tokens: 10,
      },
    ],
  }));
  return {
    startDate: '2026-07-01',
    endDate: '2026-07-11',
    lastResetDate: '2026-07-01',
    daily: { workspaceUser },
    weekly: { workspaceUser },
  };
}

function createModal(): UsageModal {
  const modal = new UsageModal({ requestRender() {} }, theme, {
    monthlyUsed: 5190,
    monthlyLimit: 8000,
    monthlyPercent: 65,
    avgDailyUsed: 240,
    dailyBudget: 187,
    resetLabel: 'July 31',
    daysLeft: 14.5,
    paceRatio: 1.3,
    projectedOverage: 2400,
    daysUntilOut: 8,
    formatCredits: String,
    onClose() {},
  });
  modal.setAnalytics(createAnalytics());
  return modal;
}

function renderedDates(modal: UsageModal): string[] {
  return modal
    .render(120)
    .filter((line) => line.startsWith('│ 07-'))
    .map((line) => line.slice(2, 7));
}

describe('usage chart bars', () => {
  it('defaults to newest-first and scrolls one period with j/k', () => {
    const modal = createModal();

    expect(renderedDates(modal)).toEqual([
      '07-11',
      '07-10',
      '07-09',
      '07-08',
      '07-07',
      '07-06',
      '07-05',
    ]);

    modal.handleInput('j');
    expect(renderedDates(modal)).toEqual([
      '07-10',
      '07-09',
      '07-08',
      '07-07',
      '07-06',
      '07-05',
      '07-04',
    ]);

    modal.handleInput('k');
    expect(renderedDates(modal)[0]).toBe('07-11');
  });

  it('cycles sort order through newest → oldest → usage with s', () => {
    const modal = createModal();

    // newest → oldest
    modal.handleInput('s');
    expect(renderedDates(modal)).toEqual([
      '07-01',
      '07-02',
      '07-03',
      '07-04',
      '07-05',
      '07-06',
      '07-07',
    ]);

    // oldest → usage (descending by credit value; analytics has credits = index+1, so highest = 07-11)
    modal.handleInput('s');
    expect(renderedDates(modal)[0]).toBe('07-11');

    // usage → newest
    modal.handleInput('s');
    expect(renderedDates(modal)[0]).toBe('07-11');
  });

  it('uses the same credit scale for usage and model bars', () => {
    const credits = 125;
    const usageBarLength = calculateBarLength(credits, 500, 20);
    const modelBarLength = calculateBarLength(credits, 500, 20);
    expect(usageBarLength).toBe(5);
    expect(modelBarLength).toBe(usageBarLength);
  });

  it('sorts each model bar by credits, then alphabetically', () => {
    expect(
      sortModelSegments([
        { label: 'gpt-5.4', value: 10 },
        { label: 'gpt-5.6-sol', value: 30 },
        { label: 'gpt-5.5', value: 10 },
      ])
    ).toEqual([
      { label: 'gpt-5.6-sol', value: 30 },
      { label: 'gpt-5.4', value: 10 },
      { label: 'gpt-5.5', value: 10 },
    ]);
  });

  it('allocates model segments by their fractional shares', () => {
    expect(calculateSegmentBarLengths([70, 20, 10], 100, 20)).toEqual([
      14, 4, 2,
    ]);
  });

  it('does not assign rounding remainder to output tokens', () => {
    expect(
      calculateTokenBarLengths(
        {
          input: 36_366_012,
          cached: 504_520_064,
          output: 2_544_998,
        },
        543_431_074,
        20
      )
    ).toEqual({ input: 1, cached: 19, output: 0 });
  });
});
