import type { DayPolicy } from './config.ts';

export type GroupBy = 'day' | 'week';

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

export type UsageAnalyticsPatch = Omit<UsageAnalytics, 'daily' | 'weekly'> & {
  daily?: UsageBreakdown;
  weekly?: UsageBreakdown;
};

interface DataResponse<T> {
  data?: T;
}

function mergeUsageBreakdown(
  existing: UsageBreakdown | undefined,
  incoming: UsageBreakdown | undefined,
  startDate: string,
  endDate: string
): UsageBreakdown | undefined {
  if (!existing) return incoming;
  if (!incoming) return existing;

  const rows = existing.workspaceUser.filter(
    (row) => row.date < startDate || row.date > endDate
  );
  rows.push(...incoming.workspaceUser);
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { workspaceUser: rows };
}

export function mergeUsageAnalytics(
  existing: UsageAnalyticsPatch | undefined,
  incoming: UsageAnalyticsPatch
): UsageAnalyticsPatch {
  if (!existing) return incoming;

  const startDate =
    existing.startDate < incoming.startDate
      ? existing.startDate
      : incoming.startDate;
  const endDate =
    existing.endDate > incoming.endDate ? existing.endDate : incoming.endDate;
  return {
    startDate,
    endDate,
    lastResetDate: incoming.lastResetDate ?? existing.lastResetDate,
    daily: mergeUsageBreakdown(
      existing.daily,
      incoming.daily,
      incoming.startDate,
      incoming.endDate
    ),
    weekly: mergeUsageBreakdown(
      existing.weekly,
      incoming.weekly,
      incoming.startDate,
      incoming.endDate
    ),
  };
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

function countWeekdays(start: Date, end: Date): number {
  let days = 0;
  for (
    const date = new Date(start);
    date < end;
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    if (isWeekday(date)) days += 1;
  }
  return days;
}

export function countRemainingWeekendDays(
  resetAt: number,
  now = new Date()
): number {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const resetDate = new Date(resetAt * 1000);
  resetDate.setUTCHours(0, 0, 0, 0);
  let days = 0;
  if (!isWeekday(today)) {
    days += 1 - (now.getTime() - today.getTime()) / 86_400_000;
  }
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  for (
    const d = new Date(tomorrow);
    d < resetDate;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    if (!isWeekday(d)) days += 1;
  }
  return days;
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

export function periodLengthDays(resetAt: number, policy: DayPolicy): number {
  const periodStart = new Date(`${getLastResetDate(resetAt)}T00:00:00Z`);
  if (policy === 'calendar') {
    return (resetAt * 1000 - periodStart.getTime()) / 86_400_000;
  }
  return countWeekdays(periodStart, new Date(resetAt * 1000));
}

export function getDateRange(
  now = new Date(),
  resetAt?: number,
  currentPeriodOnly = false
): {
  startDate: string;
  endDate: string;
  lastResetDate?: string;
} {
  const end = new Date(now);
  const trailingMonthStart = new Date(now);
  trailingMonthStart.setUTCDate(trailingMonthStart.getUTCDate() - 29);
  const lastResetDate = resetAt ? getLastResetDate(resetAt) : undefined;
  const lastReset = lastResetDate
    ? new Date(`${lastResetDate}T00:00:00Z`)
    : undefined;
  const currentPeriodStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const start = currentPeriodOnly
    ? (lastReset ?? currentPeriodStart)
    : lastReset && lastReset < trailingMonthStart
      ? lastReset
      : trailingMonthStart;

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

export function fetchUsageAnalytics(
  accessToken: string,
  signal: AbortSignal,
  resetAt: number | undefined,
  now: Date,
  groupBy: GroupBy,
  currentPeriodOnly?: boolean
): Promise<UsageAnalyticsPatch>;
export async function fetchUsageAnalytics(
  accessToken: string,
  signal: AbortSignal,
  resetAt: number | undefined,
  now: Date,
  groupBy: GroupBy,
  currentPeriodOnly = false
): Promise<UsageAnalyticsPatch> {
  const { startDate, endDate, lastResetDate } = getDateRange(
    now,
    resetAt,
    currentPeriodOnly
  );
  const breakdown = await fetchUsageBreakdown(
    accessToken,
    groupBy,
    startDate,
    endDate,
    signal
  );
  return {
    startDate,
    endDate,
    lastResetDate,
    ...(groupBy === 'day' ? { daily: breakdown } : { weekly: breakdown }),
  };
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
