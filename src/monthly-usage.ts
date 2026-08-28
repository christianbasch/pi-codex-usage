export interface MonthlyUsage {
  limit: number;
  used: number;
  remaining: number;
  usedPercent: number;
  remainingPercent: number;
  resetAt: number;
  resetAfterSeconds: number;
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

export function parseMonthlyUsage(payload: unknown): MonthlyUsage | undefined {
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
  };
}

export function minutesUntilReset(
  resetAfterSeconds: number
): number | undefined {
  const minutes = resetAfterSeconds / 60;
  return minutes > 0 ? minutes : undefined;
}

export function creditsPerDayUntilReset(
  usage: MonthlyUsage
): number | undefined {
  const minutes = minutesUntilReset(usage.resetAfterSeconds);
  return minutes === undefined
    ? undefined
    : (usage.remaining * 1_440) / minutes;
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
