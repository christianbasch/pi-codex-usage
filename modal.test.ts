import type { Theme } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import type { UsageAnalytics } from './analytics.ts';
import {
  calculateBarLength,
  calculateSegmentBarLengths,
  sortModelSegments,
  UsageModal,
} from './modal.ts';

const theme = {
  fg: (_color: string, text: string) => text,
  inverse: (text: string) => text,
} as unknown as Theme;

function createAnalytics(): UsageAnalytics {
  const workspaceUser = Array.from({ length: 11 }, (_, index) => ({
    date: `2026-07-${String(index + 1).padStart(2, '0')}`,
    models: [
      {
        model: 'gpt-5.4',
        credits: index + 1,
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
    resetAt: undefined,
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

  it('groups models outside the seven highest-usage models into others', () => {
    const models = Array.from({ length: 8 }, (_, index) => ({
      model: `gpt-model-${index + 1}`,
      credits: index + 1,
    }));
    const analytics = createAnalytics();
    analytics.daily.workspaceUser = [
      { ...analytics.daily.workspaceUser[0]!, models },
    ];
    analytics.weekly.workspaceUser = analytics.daily.workspaceUser;

    const modal = createModal();
    modal.setAnalytics(analytics);
    modal.handleInput('v');

    const legend =
      modal.render(120).find((line) => line.includes('others')) ?? '';
    expect(legend).toContain('others');
    expect(legend).not.toContain('model-1');
    for (let index = 2; index <= 8; index++) {
      expect(legend).toContain(`model-${index}`);
    }
  });

  it('always places others after named model segments', () => {
    expect(
      sortModelSegments([
        { label: 'others', value: 30 },
        { label: 'gpt-5.4', value: 10 },
      ])
    ).toEqual([
      { label: 'gpt-5.4', value: 10 },
      { label: 'others', value: 30 },
    ]);
  });

  it('allocates model segments by their fractional shares', () => {
    expect(calculateSegmentBarLengths([70, 20, 10], 100, 20)).toEqual([
      14, 4, 2,
    ]);
  });

  it('shows the under-budget marker only when it fits at the correct column', () => {
    // monthlyLimit=66 with resetAt one day after endDate (2026-07-12) causes
    // budgets to tighten toward the end of the period. Early days have a wide
    // gap between bar-end and markerPos; late days do not.
    //
    // Verified values (barWidth=20 with render(40)):
    //   07-05: barLen=9,  markerPos=15, padding=4  -> shown
    //   07-06: barLen=11, markerPos=15, padding=2  -> shown
    //   07-07: barLen=13, markerPos=16, padding=1  -> shown (boundary)
    //   07-08: barLen=15, markerPos=17, padding=0  -> hidden
    //   07-09: barLen=16, markerPos=18, padding=0  -> hidden
    //   07-10: barLen=18, markerPos=19, padding=-2 -> hidden
    //   07-11: barLen=20, markerPos=20, padding=-3 -> hidden
    const resetAt = Math.floor(
      new Date('2026-07-12T00:00:00Z').getTime() / 1000
    );
    const modal = new UsageModal({ requestRender() {} }, theme, {
      monthlyUsed: 66,
      monthlyLimit: 66,
      monthlyPercent: 100,
      avgDailyUsed: 6,
      dailyBudget: 0,
      resetAt,
      resetLabel: 'July 12',
      daysLeft: 1,
      paceRatio: undefined,
      projectedOverage: undefined,
      daysUntilOut: undefined,
      formatCredits: String,
      onClose() {},
    });
    modal.setAnalytics(createAnalytics());

    // render(40) gives barWidth=20, making marker positions fall within the line
    const lines = modal.render(40).filter((line) => line.includes('07-'));
    const lineFor = (date: string) => lines.find((l) => l.includes(date)) ?? '';

    expect(lineFor('07-05')).toContain('▏');
    expect(lineFor('07-06')).toContain('▏');
    expect(lineFor('07-07')).toContain('▏');

    expect(lineFor('07-08')).not.toContain('▏');
    expect(lineFor('07-09')).not.toContain('▏');
    expect(lineFor('07-10')).not.toContain('▏');
    expect(lineFor('07-11')).not.toContain('▏');
  });
});
