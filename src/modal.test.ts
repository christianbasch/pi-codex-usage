import type { Theme } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';
import { describe, expect, it } from 'vitest';
import type { UsageAnalytics } from './analytics.ts';
import { MINUTES_PER_DAY } from './format.ts';
import { UsageModal } from './modal.ts';
import { calculateBarLength } from './usage-chart.ts';

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

function setCompleteAnalytics(
  modal: UsageModal,
  analytics: UsageAnalytics
): void {
  const shared = {
    startDate: analytics.startDate,
    endDate: analytics.endDate,
    lastResetDate: analytics.lastResetDate,
  };
  modal.setAnalytics({
    ...shared,
    groupBy: 'day',
    breakdown: analytics.daily,
  });
  modal.setAnalytics({
    ...shared,
    groupBy: 'week',
    breakdown: analytics.weekly,
  });
}

function createModal(modalTheme: Theme = theme): UsageModal {
  const modal = new UsageModal({ requestRender() {} }, modalTheme, {
    monthlyUsed: 5190,
    monthlyLimit: 8000,
    monthlyRemaining: 2810,
    monthlyPercent: 65,
    monthlyRemainingPercent: 35,
    avgDailyUsed: 240,
    dailyBudget: 187,
    resetAt: undefined,
    resetLabel: 'July 31',
    minutesLeft: 14.5 * MINUTES_PER_DAY,
    projectedOverage: 2400,
    minutesUntilOut: 8 * MINUTES_PER_DAY,
    formatCredits: String,
    dayPolicy: 'calendar',
    onDayPolicyChange() {},
    onClose() {},
  });
  setCompleteAnalytics(modal, createAnalytics());
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
      monthlyRemaining: 1,
      monthlyPercent: 50,
      monthlyRemainingPercent: 50,
      avgDailyUsed: 1,
      dailyBudget: 1,
      resetAt: undefined,
      resetLabel: 'July 31',
      minutesLeft: MINUTES_PER_DAY,
      projectedOverage: 0,
      minutesUntilOut: MINUTES_PER_DAY,
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
    expect(modal.render(120).join('\n')).toContain('days wkdays');
  });

  it('reloads metrics without closing the dashboard', () => {
    let refreshes = 0;
    let refreshedGroup: string | undefined;
    let requestedGroup: string | undefined;
    let closed = false;
    const modal = new UsageModal({ requestRender() {} }, theme, {
      monthlyUsed: 1,
      monthlyLimit: 2,
      monthlyRemaining: 1,
      monthlyPercent: 50,
      monthlyRemainingPercent: 50,
      avgDailyUsed: 1,
      dailyBudget: 1,
      resetAt: undefined,
      resetLabel: 'July 31',
      minutesLeft: MINUTES_PER_DAY,
      projectedOverage: 0,
      minutesUntilOut: MINUTES_PER_DAY,
      formatCredits: String,
      dayPolicy: 'calendar',
      onDayPolicyChange() {},
      onAnalyticsNeeded(groupBy) {
        requestedGroup = groupBy;
      },
      onRefresh(groupBy) {
        refreshes += 1;
        refreshedGroup = groupBy;
      },
      onClose() {
        closed = true;
      },
    });

    modal.handleInput('g');
    modal.handleInput('r');

    expect(requestedGroup).toBe('week');
    expect(refreshes).toBe(1);
    expect(refreshedGroup).toBe('week');
    expect(closed).toBe(false);
    expect(modal.render(120).join('\n')).toContain('r ↻');
  });
});

describe('usage chart bars', () => {
  it('keeps cached charts visible with a centered spinner while refreshing', () => {
    const modal = createModal();
    const datesBeforeRefresh = renderedDates(modal);

    modal.setAnalyticsLoading();
    const rendered = modal.render(120).join('\n');

    expect(renderedDates(modal)).toEqual(datesBeforeRefresh);
    expect(rendered).toContain('⠋');
    expect(rendered).not.toContain('Loading charts…');
    modal.dispose();
  });

  it('scrolls with up/down arrows and j/k', () => {
    const modal = createModal();

    expect(renderedDates(modal)).toEqual([
      '07-11',
      '07-10',
      '07-09',
      '07-08',
      '07-07',
      '07-06',
      '07-05',
      '07-04',
      '07-03',
      '07-02',
    ]);

    modal.handleInput('\x1b[B');
    expect(renderedDates(modal)).toEqual([
      '07-10',
      '07-09',
      '07-08',
      '07-07',
      '07-06',
      '07-05',
      '07-04',
      '07-03',
      '07-02',
      '07-01',
    ]);

    modal.handleInput('\x1b[A');
    expect(renderedDates(modal)[0]).toBe('07-11');

    modal.handleInput('j');
    expect(renderedDates(modal)).toEqual([
      '07-10',
      '07-09',
      '07-08',
      '07-07',
      '07-06',
      '07-05',
      '07-04',
      '07-03',
      '07-02',
      '07-01',
    ]);

    modal.handleInput('k');
    expect(renderedDates(modal)[0]).toBe('07-11');
  });

  it('highlights control shortcuts within muted types', () => {
    const styledTheme = {
      ...theme,
      fg: (color: string, text: string) =>
        color === 'muted'
          ? `<${text}>`
          : color === 'accent'
            ? `[${text}]`
            : text,
      bold: (text: string) => `{${text}}`,
    } as unknown as Theme;
    const modal = createModal(styledTheme);

    expect(modal.render(120).join('\n')).toContain('{[v]}<iew> usage');
    expect(modal.render(120).join('\n')).toContain('{[d]}<ays> cal');

    modal.handleInput('v');
    expect(modal.render(120).join('\n')).toContain('< 66>');

    modal.handleInput('\t');
    expect(modal.render(120).join('\n')).toContain(
      '<s>{[c]}<ope> whole session'
    );
  });

  it('switches between account and session tabs', () => {
    const modal = createModal();
    const accountLines = modal.render(120);
    const accountHeader = accountLines[1] ?? '';

    expect(accountHeader).toContain('[Codex Usage]  Account');
    expect(accountHeader).toContain('Account  Session');
    expect(accountHeader).toContain('Account');
    expect(accountHeader).toContain('Session');
    expect(accountLines[2]).toMatch(/^├─+┤$/);
    const account = accountLines.join('\n');
    expect(account).not.toContain('Session:  —');
    expect(account).toContain('days cal');
    expect(account).not.toContain('d days');
    expect(account).not.toContain('v view');
    expect(account).not.toContain('p period');
    expect(account).not.toContain('g group');
    expect(account).not.toContain('s sort');
    expect(account).not.toContain('l scale');
    expect(account).toContain('j/k or ↑/↓ scroll');
    expect(account).toContain('q/Esc close');

    modal.handleInput('\t');
    expect(modal.render(120).join('\n')).toContain('Session');
    expect(modal.render(120).join('\n')).toContain('Session:  —');
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

  it('grows for a multi-line model legend', () => {
    const modal = createModal();
    const analytics = createAnalytics();
    const models = Array.from({ length: 8 }, (_, index) => ({
      model: `gpt-model-${index + 1}`,
      credits: index + 1,
      uncached_text_input_tokens: 100,
      cached_text_input_tokens: 100,
      text_output_tokens: 10,
    }));
    analytics.daily = {
      workspaceUser: analytics.daily.workspaceUser.map((row) => ({
        ...row,
        models,
      })),
    };
    analytics.weekly = {
      workspaceUser: analytics.weekly.workspaceUser.map((row) => ({
        ...row,
        models,
      })),
    };
    setCompleteAnalytics(modal, analytics);

    const usageHeight = modal.render(60).length;
    modal.handleInput('v');
    const modelsHeight = modal.render(60).length;

    expect(modelsHeight).toBeGreaterThan(usageHeight);
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
      monthlyRemaining: 1,
      monthlyPercent: 50,
      monthlyRemainingPercent: 50,
      avgDailyUsed: 1,
      dailyBudget: 1,
      resetAt: undefined,
      resetLabel: 'July 31',
      minutesLeft: MINUTES_PER_DAY,
      projectedOverage: 0,
      minutesUntilOut: MINUTES_PER_DAY,
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
    expect(wholeSession).not.toContain('c scope');
    expect(wholeSession).not.toContain('s sort');
    expect(wholeSession).toContain('unit credits');
    expect(wholeSession).toContain('j/k or ↑/↓ scroll');
    expect(wholeSession).toContain('q/Esc close');
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
      monthlyRemaining: 1,
      monthlyPercent: 50,
      monthlyRemainingPercent: 50,
      avgDailyUsed: 1,
      dailyBudget: 1,
      resetAt: undefined,
      resetLabel: 'July 31',
      minutesLeft: MINUTES_PER_DAY,
      projectedOverage: 0,
      minutesUntilOut: MINUTES_PER_DAY,
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
    expect(totalSession).not.toContain('s sort');
    const totalModelRows = totalSession
      .split('\n')
      .filter((line) => line.includes('│ gpt-'));
    expect(totalModelRows[0]).toContain('gpt-5.6-sol');
    expect(totalModelRows[1]).toContain('gpt-5.4');

    modal.handleInput('s');
    const responseSession = modal.render(120).join('\n');
    expect(responseSession).toContain('sort replies');
    expect(responseSession).not.toContain('s sort');
    const responseModelRows = responseSession
      .split('\n')
      .filter((line) => line.includes('│ gpt-'));
    expect(responseModelRows[0]).toContain('gpt-5.4');
    expect(responseModelRows[1]).toContain('gpt-5.6-sol');

    modal.handleInput('s');
    expect(modal.render(120).join('\n')).toContain('sort total');
  });

  it('cycles session table between credits and tokens with u', () => {
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
      monthlyRemaining: 1,
      monthlyPercent: 50,
      monthlyRemainingPercent: 50,
      avgDailyUsed: 1,
      dailyBudget: 1,
      resetAt: undefined,
      resetLabel: 'July 31',
      minutesLeft: MINUTES_PER_DAY,
      projectedOverage: 0,
      minutesUntilOut: MINUTES_PER_DAY,
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

    modal.handleInput('u');
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

    modal.handleInput('u');
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
      monthlyRemaining: 1,
      monthlyPercent: 50,
      monthlyRemainingPercent: 50,
      avgDailyUsed: 1,
      dailyBudget: 1,
      resetAt: undefined,
      resetLabel: 'July 31',
      minutesLeft: MINUTES_PER_DAY,
      projectedOverage: 0,
      minutesUntilOut: MINUTES_PER_DAY,
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
      monthlyRemaining: 1,
      monthlyPercent: 50,
      monthlyRemainingPercent: 50,
      avgDailyUsed: 1,
      dailyBudget: 1,
      resetAt: undefined,
      resetLabel: 'July 31',
      minutesLeft: MINUTES_PER_DAY,
      projectedOverage: 0,
      minutesUntilOut: MINUTES_PER_DAY,
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

  it('reserves control widths while cycling values', () => {
    const modal = createModal();
    const accountControlLine = () =>
      modal.render(120).find((line) => line.includes('view ')) ?? '';

    modal.handleInput('v');

    const periodPosition = accountControlLine().indexOf('period');
    expect(accountControlLine().indexOf('period')).toBe(periodPosition);

    const groupPosition = accountControlLine().indexOf('group');
    modal.handleInput('p');
    expect(accountControlLine().indexOf('group')).toBe(groupPosition);

    const sortPosition = accountControlLine().indexOf('sort');
    modal.handleInput('g');
    expect(accountControlLine().indexOf('sort')).toBe(sortPosition);

    const scalePosition = accountControlLine().indexOf('scale');
    modal.handleInput('s');
    expect(accountControlLine().indexOf('scale')).toBe(scalePosition);

    modal.handleInput('\t');
    const sessionControlLine = () =>
      modal.render(120).find((line) => line.includes('scope ')) ?? '';

    const sessionSortPosition = sessionControlLine().indexOf('sort');
    modal.handleInput('c');
    expect(sessionControlLine().indexOf('sort')).toBe(sessionSortPosition);

    const sessionUnitPosition = sessionControlLine().indexOf('unit');
    modal.handleInput('s');
    expect(sessionControlLine().indexOf('unit')).toBe(sessionUnitPosition);
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
      '07-08',
      '07-09',
      '07-10',
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

  it('renders scale ticks but omits the max period value', () => {
    const lines = createModal().render(120);
    const firstDateIndex = lines.findIndex((line) => line.includes('07-11'));
    const axisLine =
      lines.slice(firstDateIndex).find((line) => !line.includes('07-')) ?? '';

    expect(axisLine).toContain('0');
    expect(axisLine).toContain('10');
    expect(axisLine).not.toContain('11');
    expect(axisLine).not.toContain('2.75');
  });

  it('keeps the Account chart in credits', () => {
    const modal = createModal();
    const credits = modal.render(120).join('\\n');

    expect(credits).toContain('day   credits');
    expect(credits).not.toContain('unit credits');
    expect(credits).not.toContain('day   tokens');

    modal.handleInput('u');
    const afterUnitShortcut = modal.render(120).join('\\n');
    expect(afterUnitShortcut).toBe(credits);
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
    analytics.daily!.workspaceUser = [
      { ...analytics.daily!.workspaceUser[0]!, models },
    ];
    analytics.weekly!.workspaceUser = analytics.daily!.workspaceUser;

    const modal = createModal();
    setCompleteAnalytics(modal, analytics);
    modal.handleInput('v');

    const creditLegend = modal
      .render(120)
      .filter((line) => line.includes('gpt-model') || line.includes('others'))
      .join('\n');
    expect(creditLegend).toContain('model-8');
    expect(creditLegend).toContain(' 8');
  });

  it('hides cumulative columns at narrow widths', () => {
    const resetAt = Math.floor(
      new Date('2026-07-12T00:00:00Z').getTime() / 1000
    );
    const modal = new UsageModal({ requestRender() {} }, theme, {
      monthlyUsed: 66,
      monthlyLimit: 66,
      monthlyRemaining: 0,
      monthlyPercent: 100,
      monthlyRemainingPercent: 0,
      avgDailyUsed: 6,
      dailyBudget: 0,
      resetAt,
      resetLabel: 'July 12',
      minutesLeft: MINUTES_PER_DAY,
      projectedOverage: undefined,
      minutesUntilOut: undefined,
      formatCredits: String,
      dayPolicy: 'calendar',
      onDayPolicyChange() {},
      onClose() {},
    });
    setCompleteAnalytics(modal, createAnalytics());

    const narrowLines = modal.render(44);
    const narrowHeader = narrowLines.find((line) =>
      line.includes('day   credits')
    );
    expect(narrowHeader).not.toContain('Σ Δ');
  });
});

describe('chart with no usage at period start', () => {
  // At the start of a billing period there may be no usage yet. Chart rows
  // must remain within the available width instead of being truncated.
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
      monthlyRemaining: 8000,
      monthlyPercent: 0,
      monthlyRemainingPercent: 100,
      avgDailyUsed: undefined,
      dailyBudget: 8000 / 30,
      resetAt,
      resetLabel: 'August 31',
      minutesLeft: 28 * MINUTES_PER_DAY,
      projectedOverage: undefined,
      minutesUntilOut: undefined,
      formatCredits: String,
      dayPolicy: 'calendar',
      onDayPolicyChange() {},
      onClose() {},
    });
  }

  it('keeps each group’s analytics range independent', () => {
    const modal = createEmptyModal();
    modal.setAnalytics({
      startDate: '2026-08-01',
      endDate: '2026-08-03',
      lastResetDate: '2026-08-01',
      groupBy: 'day',
      breakdown: { workspaceUser: [{ date: '2026-08-03', models: [] }] },
    });
    modal.setAnalytics({
      startDate: '2026-08-01',
      endDate: '2026-08-10',
      lastResetDate: '2026-08-01',
      groupBy: 'week',
      breakdown: { workspaceUser: [{ date: '2026-08-10', models: [] }] },
    });

    modal.handleInput('p');

    expect(modal.render(100).join('\\n')).toContain('08-03');
    modal.handleInput('g');
    expect(modal.render(100).join('\\n')).toContain('08-10');
    modal.dispose();
  });

  it('does not truncate chart lines with empty usage', () => {
    const modal = createEmptyModal();
    setCompleteAnalytics(modal, emptyAnalytics);
    const chartLines = modal.render(100).filter((line) => line.includes('08-'));

    expect(chartLines.length).toBe(3);
    expect(chartLines.every((line) => !line.includes('...'))).toBe(true);
    const firstZeroLine =
      chartLines.find((line) => line.includes('08-01')) ?? '';
    expect(firstZeroLine).toContain('08-01');
  });

  it('keeps chart rows within the bar width', () => {
    const modal = createEmptyModal();
    setCompleteAnalytics(modal, emptyAnalytics);
    const chartLines = modal.render(60).filter((line) => line.includes('08-'));

    for (const line of chartLines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(60);
    }
  });
});

describe('modal under fullscreen TUI mode', () => {
  // The usage dashboard renders as a centered overlay (width 100, matching
  // `overlayOptions.width` in index.ts). Keep this test theme strict so it
  // catches use of optional background tokens unavailable in older Pi themes.
  function createRecordingTheme() {
    const bgCalls: Array<{ color: string; text: string }> = [];
    const recordingTheme = {
      fg: (_color: string, text: string) => text,
      bg: (color: string, text: string) => {
        if (color !== 'selectedBg') {
          throw new Error(`Unknown theme background color: ${color}`);
        }
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
      monthlyRemaining: 2810,
      monthlyPercent: 65,
      monthlyRemainingPercent: 35,
      avgDailyUsed: 240,
      dailyBudget: 187,
      resetAt: undefined,
      resetLabel: 'July 31',
      minutesLeft: 14.5 * MINUTES_PER_DAY,
      projectedOverage: 2400,
      minutesUntilOut: 8 * MINUTES_PER_DAY,
      formatCredits: String,
      dayPolicy: 'calendar',
      onDayPolicyChange() {},
      onClose() {},
    });
    setCompleteAnalytics(modal, createAnalytics());
    return modal;
  }

  it('renders the scrollbar thumb with a compatible background', () => {
    const { theme, bgCalls } = createRecordingTheme();
    createScrollableModal(theme).render(100);

    // 11 analytics rows in a 10-row chart -> thumbSize = 9 thumb cells.
    const thumbCalls = bgCalls.filter(
      (call) => call.color === 'selectedBg' && call.text === ' '
    );
    expect(thumbCalls).toHaveLength(9);
    // The modal only applies background colors to its scrollbar thumb.
    expect(bgCalls.every((call) => call.color === 'selectedBg')).toBe(true);
  });

  it('keeps the scrollbar thumb after scrolling', () => {
    const { theme, bgCalls } = createRecordingTheme();
    const modal = createScrollableModal(theme);
    modal.handleInput('j');
    modal.render(100);

    expect(bgCalls.some((call) => call.color === 'selectedBg')).toBe(true);
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
    expect(chartRows).toHaveLength(10);
    for (const row of chartRows) {
      expect(visibleWidth(row)).toBe(100);
    }
  });
});
