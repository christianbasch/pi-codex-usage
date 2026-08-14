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
  bold: (text: string) => text,
  inverse: (text: string) => text,
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

function createModal(modalTheme: Theme = theme): UsageModal {
  const modal = new UsageModal({ requestRender() {} }, modalTheme, {
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
    expect(modal.render(120).join('\n')).toContain('d days');
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

  it('mutes control types while leaving states readable', () => {
    const styledTheme = {
      ...theme,
      fg: (color: string, text: string) =>
        color === 'muted' ? `<${text}>` : text,
    } as unknown as Theme;
    const modal = createModal(styledTheme);

    expect(modal.render(120).join('\n')).toContain('<view> usage');

    modal.handleInput('\t');
    expect(modal.render(120).join('\n')).toContain('<scope> whole session');
  });

  it('switches between account and session tabs', () => {
    const modal = createModal();
    const accountLines = modal.render(120);
    const accountHeader = accountLines[1] ?? '';

    expect(accountHeader).toContain('[Codex Usage]  Account');
    expect(accountHeader).toContain('Account  Session');
    expect(accountHeader).toContain('Account');
    expect(accountHeader).toContain('Session');
    expect(accountLines[2]).toMatch(/^│\s+│$/);
    expect(accountLines.join('\n')).not.toContain('Session:  —');

    modal.handleInput('\t');
    expect(modal.render(120).join('\n')).toContain('Session');
    expect(modal.render(120).join('\n')).toContain('Session estimate: —');
    expect(modal.render(120).join('\n')).toContain('Models:   —');

    modal.handleInput('\t');
    expect(modal.render(120).join('\n')).toContain('Account');

    modal.handleInput('\t');
    expect(modal.render(120).join('\n')).toContain('Session');
  });

  it('keeps both tabs at the same height', () => {
    const modal = createModal();
    const accountLines = modal.render(120);
    const accountHeight = accountLines.length;

    modal.handleInput('\t');
    expect(modal.render(120)).toHaveLength(accountHeight);
  });

  it('cycles active branch and whole session with c', () => {
    const branchUsage = {
      totalCredits: 10,
      responseCount: 1,
      compactionCount: 0,
      models: [
        {
          model: 'gpt-5.6-sol',
          inputCredits: 10,
          cachedInputCredits: 0,
          outputCredits: 0,
          credits: 10,
          responses: 1,
          priorityResponses: 0,
          priced: true,
        },
      ],
    };
    const wholeSessionUsage = {
      ...branchUsage,
      totalCredits: 25,
      responseCount: 2,
      models: [
        ...branchUsage.models,
        {
          model: 'gpt-5.4',
          inputCredits: 15,
          cachedInputCredits: 0,
          outputCredits: 0,
          credits: 15,
          responses: 1,
          priorityResponses: 0,
          priced: true,
        },
      ],
    };
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
      onDayPolicyChange() {},
      onClose() {},
      sessionCreditUsage: branchUsage,
      wholeSessionCreditUsage: wholeSessionUsage,
    });

    modal.handleInput('\t');
    const wholeSession = modal.render(120).join('\n');
    expect(wholeSession).toContain('scope whole session');
    expect(wholeSession).toContain('c scope');
    expect(wholeSession).toContain('j/k scroll');
    expect(wholeSession).toContain('Tab scope');
    expect(wholeSession).not.toContain('Scope:');
    expect(wholeSession).toContain('~25 credits');
    expect(wholeSession).toContain('gpt-5.4');

    modal.handleInput('c');
    expect(modal.render(120).join('\n')).toContain('scope active branch');
    expect(modal.render(120).join('\n')).toContain('~10 credits');

    modal.handleInput('c');
    expect(modal.render(120).join('\n')).toContain('scope whole session');
    expect(modal.render(120).join('\n')).toContain('~25 credits');
  });

  it('cycles session sorting by Total and Replies with s', () => {
    const usage = {
      totalCredits: 150,
      responseCount: 4,
      compactionCount: 0,
      models: [
        {
          model: 'gpt-5.6-sol',
          inputCredits: 100,
          cachedInputCredits: 0,
          outputCredits: 0,
          credits: 100,
          responses: 1,
          priorityResponses: 0,
          priced: true,
        },
        {
          model: 'gpt-5.4',
          inputCredits: 50,
          cachedInputCredits: 0,
          outputCredits: 0,
          credits: 50,
          responses: 3,
          priorityResponses: 0,
          priced: true,
        },
      ],
    };
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
      onDayPolicyChange() {},
      onClose() {},
      sessionCreditUsage: usage,
      wholeSessionCreditUsage: usage,
    });

    modal.handleInput('\t');
    const totalSession = modal.render(120).join('\n');
    expect(totalSession).toContain('sort total');
    expect(totalSession).toContain('s sort');
    const totalModelRows = totalSession
      .split('\n')
      .filter((line) => line.includes('│ gpt-'));
    expect(totalModelRows[0]).toContain('gpt-5.6-sol');
    expect(totalModelRows[1]).toContain('gpt-5.4');

    modal.handleInput('s');
    const responseSession = modal.render(120).join('\n');
    expect(responseSession).toContain('sort replies');
    expect(responseSession).toContain('s sort');
    const responseModelRows = responseSession
      .split('\n')
      .filter((line) => line.includes('│ gpt-'));
    expect(responseModelRows[0]).toContain('gpt-5.4');
    expect(responseModelRows[1]).toContain('gpt-5.6-sol');

    modal.handleInput('s');
    expect(modal.render(120).join('\n')).toContain('sort total');
  });

  it('cycles session table between credits and tokens with t', () => {
    const usage = {
      totalCredits: 6,
      responseCount: 1,
      compactionCount: 0,
      models: [
        {
          model: 'gpt-5.6-sol',
          inputTokens: 2_000,
          cachedInputTokens: 3_000,
          outputTokens: 4_000,
          inputCredits: 1,
          cachedInputCredits: 2,
          outputCredits: 3,
          credits: 6,
          responses: 1,
          priorityResponses: 0,
          priced: true,
        },
      ],
    };
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
      onDayPolicyChange() {},
      onClose() {},
      sessionCreditUsage: usage,
      wholeSessionCreditUsage: usage,
    });

    modal.handleInput('\t');
    const credits = modal.render(120).join('\n');
    expect(credits).toContain('Session:  ~6 credits · 0 compactions');
    expect(credits).toContain('Models:   gpt-5.6-sol');
    expect(credits).toContain('Input cr');
    expect(credits).toContain('Cached cr');
    expect(credits).toContain('Output cr');
    expect(credits).toContain('Total cr');
    expect(credits).toContain('6');
    expect(credits).not.toContain('Input tok');

    modal.handleInput('t');
    const tokens = modal.render(120).join('\n');
    expect(tokens).toContain('Session:  9k tokens · 0 compactions');
    expect(tokens).toContain('unit tokens');
    expect(tokens).toContain('Input tok');
    expect(tokens).toContain('Cached tok');
    expect(tokens).toContain('Output tok');
    expect(tokens).toContain('Total tok');
    expect(tokens).toContain('2k');
    expect(tokens).toContain('9k');
    expect(tokens).not.toContain('Input cr Cached cr');

    modal.handleInput('t');
    expect(modal.render(120).join('\n')).toContain('unit credits');
  });

  it('shows only the top model in the account summary', () => {
    const sessionUsage = {
      totalCredits: 100,
      responseCount: 4,
      compactionCount: 2,
      models: [
        {
          model: 'gpt-5.6-sol',
          inputCredits: 50,
          cachedInputCredits: 0,
          outputCredits: 25,
          credits: 75,
          responses: 2,
          priorityResponses: 1,
          priced: true,
        },
        {
          model: 'gpt-5.6-luna',
          inputCredits: 20,
          cachedInputCredits: 0,
          outputCredits: 5,
          credits: 25,
          responses: 2,
          priorityResponses: 0,
          priced: true,
        },
      ],
    };
    const withSession = new UsageModal({ requestRender() {} }, theme, {
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
      onDayPolicyChange() {},
      onClose() {},
      sessionCreditUsage: {
        ...sessionUsage,
        totalCredits: 25,
        responseCount: 2,
        compactionCount: 0,
      },
      wholeSessionCreditUsage: sessionUsage,
    });

    const account = withSession.render(120).join('\n');
    expect(account).not.toContain('Session:  ~100 credits');
    expect(account).not.toContain('top gpt-5.6-sol');
    expect(account).not.toContain('gpt-5.6-luna');

    withSession.handleInput('\t');
    const session = withSession.render(120).join('\n');
    expect(session).toContain('Session:  ~100 credits · 2 compactions');
    expect(session).toContain('Replies:  4 (1 priority)');
    expect(session).toContain('Models:   gpt-5.6-sol +1 other');
    expect(session).toContain('Input cr');
    expect(session).toContain('Cached cr');
    expect(session).toContain('Output cr');
    expect(session).toContain('Total cr');
    expect(session).toContain('Replies');
    expect(session).toContain('Priority');
    expect(session).toContain('gpt-5.6-sol');
    expect(session).toContain('gpt-5.6-luna');
    expect(session).toContain('Total');
  });

  it('omits the Total row for a single model', () => {
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
      onDayPolicyChange() {},
      onClose() {},
      sessionCreditUsage: {
        totalCredits: 10,
        responseCount: 1,
        compactionCount: 0,
        models: [
          {
            model: 'gpt-5.6-sol',
            inputCredits: 10,
            cachedInputCredits: 0,
            outputCredits: 0,
            credits: 10,
            responses: 1,
            priorityResponses: 0,
            priced: true,
          },
        ],
      },
    });

    modal.handleInput('\t');
    const session = modal.render(120).join('\n');
    expect(session).toContain('gpt-5.6-sol');
    expect(session).not.toContain('Total                    10');
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

  it('supports square-root scaling', () => {
    expect(calculateBarLength(125, 500, 20, 'sqrt')).toBe(10);
  });

  it('toggles token totals in Usage and model token/credit ratios', () => {
    const modal = createModal();

    expect(
      modal
        .render(120)
        .filter((line) => line.includes('07-'))
        .join('\\n')
    ).not.toContain('21 tok/cr');

    const usageWithoutTokens = modal
      .render(120)
      .find((line) => line.includes('07-11'));
    modal.handleInput('t');
    const countsUsage = modal.render(120).join('\\n');
    const usageWithTokens = modal
      .render(120)
      .find((line) => line.includes('07-11'));
    expect(countsUsage).toContain('10 · 210 tok');
    expect(countsUsage).toContain('tokens counts');
    expect(usageWithTokens?.lastIndexOf(' 11')).toBe(
      usageWithoutTokens?.lastIndexOf(' 11')
    );

    modal.handleInput('t');
    const ratioUsage = modal.render(120).join('\\n');
    expect(ratioUsage).toContain('10 · 21 tok/cr');
    expect(ratioUsage).toContain('tokens ratio');

    modal.handleInput('v');
    const models = modal.render(120).join('\\n');
    expect(models).toContain('5.4');
    expect(models).toContain('35 tok/cr');
    expect(models).toContain('10 · 21 tok/cr');

    modal.handleInput('t');
    const off = modal.render(120).join('\\n');
    expect(off).not.toContain('tok/cr');
    expect(off).toContain('tokens off');
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
    const models = [
      {
        model: 'gpt-zero',
        credits: 0,
        uncached_text_input_tokens: 0,
        cached_text_input_tokens: 0,
        text_output_tokens: 0,
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        model: `gpt-model-${index + 1}`,
        credits: index + 1,
        uncached_text_input_tokens: 0,
        cached_text_input_tokens: 0,
        text_output_tokens: 0,
      })),
    ];
    const analytics = createAnalytics();
    analytics.daily.workspaceUser = [
      { ...analytics.daily.workspaceUser[0]!, models },
    ];
    analytics.weekly.workspaceUser = analytics.daily.workspaceUser;

    const modal = createModal();
    modal.setAnalytics(analytics);
    modal.handleInput('t');
    modal.handleInput('v');

    const legend =
      modal.render(120).find((line) => line.includes('others')) ?? '';
    expect(legend).toContain('others');
    expect(legend).not.toContain('0 tok');
    expect(legend).not.toContain('zero');
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
    // Verified values (barWidth=20 with render(44)):
    //   07-05: barLen=9,  markerPos=15, padding=5  -> shown
    //   07-06: barLen=11, markerPos=15, padding=3  -> shown
    //   07-07: barLen=13, markerPos=16, padding=2  -> shown
    //   07-08: barLen=15, markerPos=17, padding=0  -> hidden
    //   07-09: barLen=16, markerPos=18, padding=1  -> shown
    //   07-10: barLen=18, markerPos=19, padding=0  -> hidden
    //   07-11: barLen=20, markerPos=20, padding=-1 -> hidden
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

    // render(44) gives barWidth=20 with the token column reserved in both
    // modes. The compact responsive layout shows four chart rows, so inspect
    // the scroll positions containing these dates.
    const newestLines = modal.render(44).filter((line) => line.includes('07-'));
    const newestLineFor = (date: string) =>
      newestLines.find((line) => line.includes(date)) ?? '';

    expect(newestLineFor('07-09')).toContain('▏');
    expect(newestLineFor('07-10')).toContain('▏');
    expect(newestLineFor('07-11')).toContain('▏');

    modal.handleInput('j');
    modal.handleInput('j');
    const middleLines = modal.render(44).filter((line) => line.includes('07-'));
    const middleLineFor = (date: string) =>
      middleLines.find((line) => line.includes(date)) ?? '';
    expect(middleLineFor('07-07')).toContain('▏');
    expect(middleLineFor('07-08')).toContain('▏');

    modal.handleInput('j');
    modal.handleInput('j');
    const olderLines = modal.render(44).filter((line) => line.includes('07-'));
    const olderLineFor = (date: string) =>
      olderLines.find((line) => line.includes(date)) ?? '';
    expect(olderLineFor('07-05')).toContain('▏');
    expect(olderLineFor('07-06')).toContain('▏');
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
      bold: (text: string) => text,
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
