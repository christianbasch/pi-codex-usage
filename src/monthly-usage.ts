import { MINUTES_PER_DAY } from './format.ts';

export interface MonthlyUsage {
  limit: number;
  used: number;
  remaining: number;
  usedPercent: number;
  remainingPercent: number;
  resetAt: number;
  resetAfterSeconds: number;
  /**
   * Local clock reading when `resetAfterSeconds` was received. The server
   * value is a snapshot, so remaining time must be reduced by the time
   * elapsed since the fetch.
   */
  fetchedAt: number;
}

interface UsageResponse {
  spend_control?: {
    individual_limit?: {
      limit?: string | number;
      used?: string | number;
      remaining?: string | number;
      used_percent?: number;
      remaining_percent?: number;
      reset_at?: number;
      reset_after_seconds?: number;
    };
  };
}

function toFiniteNumber(
  value: string | number | undefined
): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number)
    ? number
    : undefined;
}

export function parseMonthlyUsage(
  payload: unknown,
  fetchedAt: number = Date.now()
): MonthlyUsage | undefined {
  if (!payload || typeof payload !== 'object') return undefined;

  const individualLimit = (payload as UsageResponse).spend_control
    ?.individual_limit;
  if (!individualLimit) return undefined;

  const limit = toFiniteNumber(individualLimit.limit);
  const used = toFiniteNumber(individualLimit.used);
  const remaining = toFiniteNumber(individualLimit.remaining);
  const resetAt = toFiniteNumber(individualLimit.reset_at);
  const resetAfterSeconds = toFiniteNumber(individualLimit.reset_after_seconds);
  if (
    limit === undefined ||
    used === undefined ||
    remaining === undefined ||
    resetAt === undefined ||
    resetAfterSeconds === undefined
  ) {
    return undefined;
  }

  return {
    limit,
    used,
    remaining,
    usedPercent:
      individualLimit.used_percent ?? (limit === 0 ? 0 : (used / limit) * 100),
    remainingPercent:
      individualLimit.remaining_percent ??
      (limit === 0 ? 100 : (remaining / limit) * 100),
    resetAt,
    resetAfterSeconds,
    fetchedAt,
  };
}

/**
 * Remaining minutes until reset, anchored to the server-provided
 * `resetAfterSeconds` and reduced by the time elapsed locally since that value
 * was fetched. Using elapsed time rather than the absolute clock keeps this
 * correct even when the local clock is offset from the server's.
 */
export function minutesUntilReset(
  usage: MonthlyUsage,
  now: Date = new Date()
): number | undefined {
  const elapsedSeconds = Math.max(0, (now.getTime() - usage.fetchedAt) / 1000);
  const minutes = (usage.resetAfterSeconds - elapsedSeconds) / 60;
  return minutes > 0 ? minutes : undefined;
}

/**
 * A cached usage snapshot describes the period that was current when it was
 * fetched. Once that reset has passed the snapshot belongs to the previous
 * period and must not be used to render the current one.
 */
export function isCurrentPeriod(
  usage: MonthlyUsage | undefined,
  now: Date = new Date()
): usage is MonthlyUsage {
  return usage !== undefined && usage.resetAt * 1000 > now.getTime();
}

export function creditsPerDayUntilReset(
  usage: MonthlyUsage,
  now: Date = new Date()
): number | undefined {
  const minutes = minutesUntilReset(usage, now);
  return minutes === undefined
    ? undefined
    : (usage.remaining * MINUTES_PER_DAY) / minutes;
}

export async function fetchMonthlyUsage(
  accessToken: string,
  signal?: AbortSignal
): Promise<MonthlyUsage | undefined> {
  const response = await fetch('https://chatgpt.com/backend-api/wham/usage', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Codex usage request failed (${response.status})`);
  }

  return parseMonthlyUsage(await response.json());
}
