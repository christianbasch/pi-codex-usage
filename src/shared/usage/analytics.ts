import { addUtcDays, formatDate, startOfUtcDay } from '../utc-date.ts';
import { getLastResetDate } from './period.ts';

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
  /** UTC calendar day, validated and normalized to midnight at the API boundary. */
  date: Date;
  models: WorkspaceUserModelUsage[];
}

interface WorkspaceUserTokenUsageResponse {
  date: unknown;
  models: WorkspaceUserModelUsage[];
}

export interface UsageBreakdown {
  workspaceUser: WorkspaceUserTokenUsage[];
}

export interface UsageAnalytics {
  startDate: Date;
  endDate: Date;
  lastResetDate?: Date;
  daily: UsageBreakdown;
  weekly: UsageBreakdown;
}

export interface AnalyticsResult {
  startDate: Date;
  endDate: Date;
  lastResetDate?: Date;
  groupBy: GroupBy;
  breakdown: UsageBreakdown;
}

interface DataResponse<T> {
  data?: T;
}

function mergeUsageBreakdown(
  existing: UsageBreakdown,
  incoming: UsageBreakdown,
  startDate: Date,
  endDate: Date
): UsageBreakdown {
  const rows = existing.workspaceUser.filter(
    (row) => row.date < startDate || row.date > endDate
  );
  rows.push(...incoming.workspaceUser);
  rows.sort((a, b) => a.date.getTime() - b.date.getTime());
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

export function getDateRange(
  now = new Date(),
  resetAt?: number
): {
  startDate: Date;
  endDate: Date;
  lastResetDate?: Date;
} {
  const endDate = startOfUtcDay(now);
  const startDate = addUtcDays(endDate, -(ANALYTICS_RANGE_DAYS - 1));
  const lastResetDate = resetAt ? getLastResetDate(resetAt) : undefined;

  return { startDate, endDate, lastResetDate };
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

function parseAnalyticsDate(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Usage analytics response included an invalid date');
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || formatDate(date) !== value) {
    throw new Error('Usage analytics response included an invalid date');
  }
  return date;
}

async function fetchUsageBreakdown(
  accessToken: string,
  groupBy: GroupBy,
  startDate: Date,
  endDate: Date,
  signal: AbortSignal
): Promise<UsageBreakdown> {
  const params = new URLSearchParams({
    start_date: formatDate(startDate),
    end_date: formatDate(endDate),
    group_by: groupBy,
  });
  const rows = await fetchBreakdown<WorkspaceUserTokenUsageResponse[]>(
    '/backend-api/wham/usage/daily-workspace-user-token-usage-breakdown',
    accessToken,
    params,
    signal
  );

  const workspaceUser = rows.map((row) => ({
    ...row,
    date: parseAnalyticsDate(row.date),
  }));
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
