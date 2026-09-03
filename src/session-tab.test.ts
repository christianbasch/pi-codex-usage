import type { Theme } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { SessionTab } from './session-tab.ts';
import type { SessionCreditUsage } from './session-usage.ts';

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  inverse: (text: string) => text,
} as unknown as Theme;

function modelUsage(model: string, credits: number, responses: number) {
  return {
    model,
    inputCredits: credits,
    cachedInputCredits: 0,
    outputCredits: 0,
    credits,
    responses,
    priorityResponses: 0,
    priced: true,
  };
}

const branchUsage: SessionCreditUsage = {
  totalCredits: 10,
  responseCount: 3,
  compactionCount: 0,
  models: [modelUsage('gpt-5.6-sol', 10, 3)],
};

const wholeSessionUsage: SessionCreditUsage = {
  totalCredits: 25,
  responseCount: 4,
  compactionCount: 0,
  models: [modelUsage('gpt-5.6-sol', 10, 3), modelUsage('gpt-5.4', 15, 1)],
};

function createTab(
  options: Partial<ConstructorParameters<typeof SessionTab>[0]> = {}
) {
  return new SessionTab({
    theme,
    formatCredits: String,
    sessionCreditUsage: branchUsage,
    wholeSessionCreditUsage: wholeSessionUsage,
    ...options,
  });
}

describe('SessionTab input', () => {
  it('cycles between whole session and active branch with c', () => {
    const tab = createTab();
    expect(tab.renderSummaryLines()[0]).toContain('~25 credits');

    tab.handleInput('c');
    expect(tab.renderSummaryLines()[0]).toContain('~10 credits');

    tab.handleInput('c');
    expect(tab.renderSummaryLines()[0]).toContain('~25 credits');
  });

  it('ignores c when no whole-session usage is available', () => {
    const tab = createTab({
      sessionCreditUsage: branchUsage,
      wholeSessionCreditUsage: undefined,
    });
    tab.handleInput('c');
    expect(tab.renderSummaryLines()[0]).toContain('~10 credits');
  });

  it('falls back to branch usage when whole session is missing', () => {
    const tab = createTab({ wholeSessionCreditUsage: undefined });
    expect(tab.renderSummaryLines()[0]).toContain('~10 credits');
  });

  it('cycles sorting between total and replies with s', () => {
    const tab = createTab();
    const totalRows = tab.renderTable(10);
    expect(totalRows[0]).toContain('gpt-5.4');

    tab.handleInput('s');
    const repliesRows = tab.renderTable(10);
    expect(repliesRows[0]).toContain('gpt-5.6-sol');
  });

  it('cycles the display unit between credits and tokens with u', () => {
    const tab = createTab();
    tab.handleInput('u');
    expect(tab.renderSummaryLines()[0]).toContain('tokens');
    expect(tab.renderTableHeader()).toContain('Input tok');
  });

  it('does not reset scroll when cycling the display unit', () => {
    const tab = createTab();
    tab.renderTable(1);
    tab.handleInput('\x1b[B');
    expect(tab.viewport.scrollOffset).toBe(1);

    tab.handleInput('u');
    expect(tab.viewport.scrollOffset).toBe(1);
  });

  it('scrolls with j/k and arrows, clamped to the table bounds', () => {
    const tab = createTab();
    tab.renderTable(2); // 2 models + total row = 3 lines in 2 rows

    tab.handleInput('j');
    expect(tab.viewport.scrollOffset).toBe(1);
    tab.handleInput('\x1b[B');
    expect(tab.viewport.scrollOffset).toBe(1); // clamped at max

    tab.handleInput('k');
    expect(tab.viewport.scrollOffset).toBe(0);
    tab.handleInput('\x1b[A');
    tab.handleInput('\x1b[A');
    expect(tab.viewport.scrollOffset).toBe(0); // clamped at 0
  });

  it('clamps a stale scroll offset when the table shrinks', () => {
    const tab = createTab();
    tab.renderTable(1);
    tab.handleInput('\x1b[B');
    tab.handleInput('\x1b[B');
    tab.handleInput('\x1b[B');
    const offset = tab.viewport.scrollOffset;
    expect(offset).toBeGreaterThan(0);

    tab.renderTable(10);
    expect(tab.viewport.maxScrollOffset).toBe(0);
    expect(tab.viewport.scrollOffset).toBe(0);
  });

  it('leaves state unchanged for unmatched keys', () => {
    const tab = createTab();
    tab.renderTable(2);
    const before = tab.renderTable(2).join('\n');
    const controlsBefore = tab.renderControlLines(100).join('\n');

    tab.handleInput('x');

    expect(tab.renderTable(2).join('\n')).toBe(before);
    expect(tab.renderControlLines(100).join('\n')).toBe(controlsBefore);
  });
});

describe('SessionTab rendering', () => {
  it('renders the model table with a bold total row', () => {
    const tab = createTab();
    const lines = tab.renderTable(10);
    expect(lines[0]).toContain('gpt-5.4');
    expect(lines[1]).toContain('gpt-5.6-sol');
    expect(lines[2]).toContain('Total');
  });

  it('pads the table to exactly the requested number of rows', () => {
    const tab = createTab();
    const lines = tab.renderTable(8);
    expect(lines).toHaveLength(8);
  });

  it('shows a placeholder when no session usage exists', () => {
    const tab = createTab({
      sessionCreditUsage: undefined,
      wholeSessionCreditUsage: undefined,
    });
    expect(tab.renderTable(3)[0]).toContain('No session estimate');
    expect(tab.renderSummaryLines()[0]).toContain('Session:  —');
  });

  it('renders scope, sort, and unit controls with current values', () => {
    const tab = createTab();
    const controls = tab.renderControlLines(120).join('\n');
    expect(controls).toContain('scope');
    expect(controls).toContain('whole session');
    expect(controls).toContain('sort');
    expect(controls).toContain('total');
    expect(controls).toContain('unit');
    expect(controls).toContain('credits');
  });

  it('includes reply and compaction counts in the summary', () => {
    const tab = createTab();
    const lines = tab.renderSummaryLines();
    expect(lines[1]).toContain('Replies:  4');
    expect(lines[0]).toContain('0 compactions');
  });
});
