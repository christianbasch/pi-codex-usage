import type { Theme } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
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
  bg: (_color: string, text: string) => text,
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
    monthlyRemainingPercent: 35,
    avgDailyUsed: 240,
    dailyBudget: 187,
    resetAt: undefined,
    resetLabel: 'July 31',
    daysLeft: 14.5,
    projectedOverage: 2400,
    daysUntilOut: 8,
    formatCredits: String,
    dayPolicy: 'calendar',
    onDayPolicyChange() {},
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

describe('usage mode control', () => {
  it('changes mode without closing the modal', () => {
    let selectedPolicy = 'calendar';
    let closed = false;
    const modal = new UsageModal({ requestRender() {} }, theme, {
      monthlyUsed: 1,
      monthlyLimit: 2,
      monthlyPercent: 50,
      monthlyRemainingPercent: 50,
      avgDailyUsed: 1,
      dailyBudget: 1,
      resetAt: undefined,
      resetLabel: 'July 31',
      daysLeft: 1,
      projectedOverage: 0,
      daysUntilOut: 1,
      formatCredits: String,
      dayPolicy: 'calendar',
      onDayPolicyChange(policy) {
        selectedPolicy = policy;
      },
      onClose() {
        closed = true;
      },
    });

    modal.handleInput('d');

    expect(selectedPolicy).toBe('weekdays');
    expect(closed).toBe(false);
    expect(modal.render(120).join('\n')).toContain('d days (wd)');
  });
});

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

  it('preserves scroll position when cycling views with v', () => {
    const modal = createModal();

    renderedDates(modal);
    modal.handleInput('j');
    modal.handleInput('v');
    modal.handleInput('v');

    expect(renderedDates(modal)[0]).toBe('07-10');
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
      monthlyRemainingPercent: 0,
      avgDailyUsed: 6,
      dailyBudget: 0,
      resetAt,
      resetLabel: 'July 12',
      daysLeft: 1,
      projectedOverage: undefined,
      daysUntilOut: undefined,
      formatCredits: String,
      dayPolicy: 'calendar',
      onDayPolicyChange() {},
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

describe('chart with no usage at period start', () => {
  // At the start of a billing period there may be no usage yet. The daily
  // budget marker must still render within the bar instead of being scaled
  // against a fallback max of 1 (which pushed it thousands of columns out
  // and truncated every chart line with "...").
  const resetAt = Math.floor(new Date('2026-08-31T00:00:00Z').getTime() / 1000);
  const emptyAnalytics: UsageAnalytics = {
    startDate: '2026-08-01',
    endDate: '2026-08-03',
    lastResetDate: '2026-08-01',
    daily: {
      workspaceUser: [
        { date: '2026-08-01', models: [] },
        { date: '2026-08-02', models: [] },
        { date: '2026-08-03', models: [] },
      ],
    },
    weekly: { workspaceUser: [] },
  };

  function createEmptyModal(): UsageModal {
    return new UsageModal({ requestRender() {} }, theme, {
      monthlyUsed: 0,
      monthlyLimit: 8000,
      monthlyPercent: 0,
      monthlyRemainingPercent: 100,
      avgDailyUsed: undefined,
      dailyBudget: 8000 / 30,
      resetAt,
      resetLabel: 'August 31',
      daysLeft: 28,
      projectedOverage: undefined,
      daysUntilOut: undefined,
      formatCredits: String,
      dayPolicy: 'calendar',
      onDayPolicyChange() {},
      onClose() {},
    });
  }

  it('does not truncate chart lines and shows the daily budget marker', () => {
    const modal = createEmptyModal();
    modal.setAnalytics(emptyAnalytics);
    const chartLines = modal.render(100).filter((line) => line.includes('08-'));

    expect(chartLines.length).toBe(3);
    expect(chartLines.every((line) => !line.includes('...'))).toBe(true);
    expect(chartLines.every((line) => line.includes('▏'))).toBe(true);
  });

  it('keeps the budget marker within the bar width', () => {
    const modal = createEmptyModal();
    modal.setAnalytics(emptyAnalytics);
    const chartLines = modal.render(60).filter((line) => line.includes('08-'));

    for (const line of chartLines) {
      const inner = line.slice(1, -1);
      const markerIndex = inner.indexOf('▏');
      expect(markerIndex).toBeGreaterThan(0);
      expect(markerIndex).toBeLessThan(inner.length);
    }
  });
});

describe('modal under fullscreen TUI mode', () => {
  // The usage dashboard renders as a centered overlay (width 100, matching
  // `overlayOptions.width` in index.ts). In pi 0.84 fullscreen TUI mode the
  // transcript gains its own scrollbar using the `scrollbarThumb` theme color;
  // the modal's scrollbar thumb should use the same color so both scrollbars
  // stay visually consistent.
  function createRecordingTheme() {
    const bgCalls: Array<{ color: string; text: string }> = [];
    const recordingTheme = {
      fg: (_color: string, text: string) => text,
      bg: (color: string, text: string) => {
        bgCalls.push({ color, text });
        return text;
      },
      inverse: (text: string) => text,
    } as unknown as Theme;
    return { theme: recordingTheme, bgCalls };
  }

  function createScrollableModal(theme: Theme): UsageModal {
    const modal = new UsageModal({ requestRender() {} }, theme, {
      monthlyUsed: 5190,
      monthlyLimit: 8000,
      monthlyPercent: 65,
      monthlyRemainingPercent: 35,
      avgDailyUsed: 240,
      dailyBudget: 187,
      resetAt: undefined,
      resetLabel: 'July 31',
      daysLeft: 14.5,
      projectedOverage: 2400,
      daysUntilOut: 8,
      formatCredits: String,
      dayPolicy: 'calendar',
      onDayPolicyChange() {},
      onClose() {},
    });
    modal.setAnalytics(createAnalytics());
    return modal;
  }

  it('renders the scrollbar thumb with the scrollbarThumb background', () => {
    const { theme, bgCalls } = createRecordingTheme();
    createScrollableModal(theme).render(100);

    // 11 analytics rows in a 7-row chart -> thumbSize = 4 thumb cells.
    const thumbCalls = bgCalls.filter(
      (call) => call.color === 'scrollbarThumb' && call.text === ' '
    );
    expect(thumbCalls).toHaveLength(4);
    // The modal only applies background colors to its scrollbar thumb.
    expect(bgCalls.every((call) => call.color === 'scrollbarThumb')).toBe(true);
  });

  it('keeps the scrollbarThumb thumb after scrolling', () => {
    const { theme, bgCalls } = createRecordingTheme();
    const modal = createScrollableModal(theme);
    modal.handleInput('j');
    modal.render(100);

    expect(bgCalls.some((call) => call.color === 'scrollbarThumb')).toBe(true);
  });

  it('does not overflow the fullscreen overlay width', () => {
    const { theme } = createRecordingTheme();
    const lines = createScrollableModal(theme).render(100);

    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(100);
    }
    // Chart rows fill the width exactly so the scrollbar column stays aligned
    // against the sticky fullscreen footer/transcript edge.
    const chartRows = lines.filter((line) => line.includes('07-'));
    expect(chartRows).toHaveLength(7);
    for (const row of chartRows) {
      expect(visibleWidth(row)).toBe(100);
    }
  });
});
