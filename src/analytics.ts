import type { DayPolicy } from './config.ts';

export type GroupBy = 'day' | 'week';

const ANALYTICS_RANGE_DAYS = 365;

export interface WorkspaceUserModelUsage {
  model: string;
  credits: number;
  uncached_text_input_tokens: number;
  cached_text_input_tokens: number;
  text_output_tokens: number;
}

export interface WorkspaceUserTokenUsage {
  date: string;
  models: WorkspaceUserModelUsage[];
}

export interface UsageBreakdown {
  workspaceUser: WorkspaceUserTokenUsage[];
}

export interface UsageAnalytics {
  startDate: string;
  endDate: string;
  lastResetDate?: string;
  daily: UsageBreakdown;
  weekly: UsageBreakdown;
}

export interface AnalyticsResult {
  startDate: string;
  endDate: string;
  lastResetDate?: string;
  groupBy: GroupBy;
  breakdown: UsageBreakdown;
}

interface DataResponse<T> {
  data?: T;
}

function mergeUsageBreakdown(
  existing: UsageBreakdown,
  incoming: UsageBreakdown,
  startDate: string,
  endDate: string
): UsageBreakdown {
  const rows = existing.workspaceUser.filter(
    (row) => row.date < startDate || row.date > endDate
  );
  rows.push(...incoming.workspaceUser);
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { workspaceUser: rows };
}

export function mergeAnalyticsResults(
  existing: AnalyticsResult | undefined,
  incoming: AnalyticsResult
): AnalyticsResult {
  if (!existing || existing.groupBy !== incoming.groupBy) return incoming;

  const startDate =
    existing.startDate < incoming.startDate
      ? existing.startDate
      : incoming.startDate;
  const endDate =
    existing.endDate > incoming.endDate ? existing.endDate : incoming.endDate;
  const breakdown = mergeUsageBreakdown(
    existing.breakdown,
    incoming.breakdown,
    incoming.startDate,
    incoming.endDate
  );
  return {
    startDate,
    endDate,
    lastResetDate: incoming.lastResetDate ?? existing.lastResetDate,
    groupBy: incoming.groupBy,
    breakdown,
  };
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Returns the first day of the calendar month before `periodStart`. */
export function getPreviousPeriodStart(periodStart: string): string {
  const previous = new Date(`${periodStart}T00:00:00Z`);
  previous.setUTCDate(1);
  previous.setUTCMonth(previous.getUTCMonth() - 1);
  return formatDate(previous);
}

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

function isWeekend(date: Date): boolean {
  return !isWeekday(date);
}

/**
 * Counts whole days in `[start, end)` that satisfy `predicate`, iterating on
 * UTC day boundaries. Both bounds are normalized to the start of their day so
 * sub-day noise cannot add or drop a day — the API rounds `reset_at`
 * inconsistently (observed alternating by one second between fetches), which
 * would otherwise shift a weekday count and visibly move the daily budget.
 */
function countDaysMatching(
  start: Date,
  end: Date,
  predicate: (date: Date) => boolean
): number {
  const cursor = new Date(start);
  cursor.setUTCHours(0, 0, 0, 0);
  const last = new Date(end);
  last.setUTCHours(0, 0, 0, 0);
  let days = 0;
  for (; cursor < last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (predicate(cursor)) days += 1;
  }
  return days;
}

export function countRemainingWeekendDays(
  resetAt: number,
  now = new Date()
): number {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  // The remaining fraction of today counts only when today is a weekend day;
  // whole days from tomorrow onward are counted on day boundaries.
  const partialToday = isWeekday(today)
    ? 0
    : 1 - (now.getTime() - today.getTime()) / 86_400_000;
  return (
    partialToday +
    countDaysMatching(tomorrow, new Date(resetAt * 1000), isWeekend)
  );
}

export function getLastResetDate(resetAt: number): string {
  const lastReset = new Date(resetAt * 1000);
  lastReset.setUTCDate(1);
  lastReset.setUTCMonth(lastReset.getUTCMonth() - 1);
  return formatDate(lastReset);
}

export function daysElapsedInPeriod(resetAt: number, now = new Date()): number {
  const periodStart = new Date(`${getLastResetDate(resetAt)}T00:00:00Z`);
  return Math.max(0, (now.getTime() - periodStart.getTime()) / 86_400_000);
}

export function daysUntilResetForPolicy(
  date: string,
  resetAt: number,
  policy: DayPolicy
): number {
  const start = new Date(`${date}T00:00:00Z`);
  const reset = new Date(resetAt * 1000);
  if (policy === 'calendar') {
    return (reset.getTime() - start.getTime()) / 86_400_000;
  }
  return countDaysMatching(start, reset, isWeekday);
}

export function getPeriodBudgetPerDay(
  monthlyLimit: number,
  periodStart: string,
  periodEnd: string,
  policy: DayPolicy
): number | undefined {
  const resetAt = Date.parse(`${periodEnd}T00:00:00Z`) / 1000;
  const periodDays = daysUntilResetForPolicy(periodStart, resetAt, policy);
  return periodDays > 0 ? monthlyLimit / periodDays : undefined;
}

export function getDateRange(
  now = new Date(),
  resetAt?: number
): {
  startDate: string;
  endDate: string;
  lastResetDate?: string;
} {
  const end = new Date(now);
  const trailingYearStart = new Date(now);
  trailingYearStart.setUTCDate(
    trailingYearStart.getUTCDate() - (ANALYTICS_RANGE_DAYS - 1)
  );
  const lastResetDate = resetAt ? getLastResetDate(resetAt) : undefined;
  const start = trailingYearStart;

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
    lastResetDate,
  };
}

async function fetchBreakdown<T>(
  path: string,
  accessToken: string,
  params: URLSearchParams,
  signal: AbortSignal
): Promise<T> {
  const response = await fetch(`https://chatgpt.com${path}?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Usage analytics request failed (${response.status})`);
  }

  const payload = (await response.json()) as DataResponse<T>;
  if (payload.data === undefined) {
    throw new Error('Usage analytics response did not include data');
  }
  return payload.data;
}

async function fetchUsageBreakdown(
  accessToken: string,
  groupBy: GroupBy,
  startDate: string,
  endDate: string,
  signal: AbortSignal
): Promise<UsageBreakdown> {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    group_by: groupBy,
  });
  const workspaceUser = await fetchBreakdown<WorkspaceUserTokenUsage[]>(
    '/backend-api/wham/usage/daily-workspace-user-token-usage-breakdown',
    accessToken,
    params,
    signal
  );

  return { workspaceUser };
}

export async function fetchUsageAnalytics(
  accessToken: string,
  signal: AbortSignal,
  resetAt: number | undefined,
  now: Date,
  groupBy: GroupBy
): Promise<AnalyticsResult> {
  const { startDate, endDate, lastResetDate } = getDateRange(now, resetAt);
  const breakdown = await fetchUsageBreakdown(
    accessToken,
    groupBy,
    startDate,
    endDate,
    signal
  );
  return { startDate, endDate, lastResetDate, groupBy, breakdown };
}

export function sumModelCredits(models: WorkspaceUserModelUsage[]): number {
  return models.reduce((total, model) => total + model.credits, 0);
}

export function sumModelTokens(
  models: WorkspaceUserModelUsage[],
  tokenType:
    | 'uncached_text_input_tokens'
    | 'cached_text_input_tokens'
    | 'text_output_tokens'
): number {
  return models.reduce((total, model) => total + model[tokenType], 0);
}
