export type GroupBy = 'day' | 'week';

export interface WorkspaceUserModelUsage {
  model: string;
  credits: number;
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

interface DataResponse<T> {
  data?: T;
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
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

export function periodLengthDays(resetAt: number): number {
  const periodStart = new Date(`${getLastResetDate(resetAt)}T00:00:00Z`);
  return (resetAt * 1000 - periodStart.getTime()) / 86_400_000;
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
  const trailingMonthStart = new Date(now);
  trailingMonthStart.setUTCDate(trailingMonthStart.getUTCDate() - 29);
  const lastResetDate = resetAt ? getLastResetDate(resetAt) : undefined;
  const lastReset = lastResetDate
    ? new Date(`${lastResetDate}T00:00:00Z`)
    : undefined;
  const start =
    lastReset && lastReset < trailingMonthStart
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

export async function fetchUsageAnalytics(
  accessToken: string,
  signal: AbortSignal,
  resetAt?: number,
  now = new Date()
): Promise<UsageAnalytics> {
  const { startDate, endDate, lastResetDate } = getDateRange(now, resetAt);
  const [daily, weekly] = await Promise.all([
    fetchUsageBreakdown(accessToken, 'day', startDate, endDate, signal),
    fetchUsageBreakdown(accessToken, 'week', startDate, endDate, signal),
  ]);

  return { startDate, endDate, lastResetDate, daily, weekly };
}

export function sumModelCredits(models: WorkspaceUserModelUsage[]): number {
  return models.reduce((total, model) => total + model.credits, 0);
}
