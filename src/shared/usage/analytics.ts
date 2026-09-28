import { formatDate, getLastResetDate } from './period.ts';

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
