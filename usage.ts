export interface MonthlyUsage {
  limit: number;
  used: number;
  remaining: number;
  usedPercent: number;
  resetAt: number;
}

interface UsageResponse {
  spend_control?: {
    individual_limit?: {
      limit?: string | number;
      used?: string | number;
      remaining?: string | number;
      used_percent?: number;
      reset_at?: number;
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
  if (
    limit === undefined ||
    used === undefined ||
    remaining === undefined ||
    resetAt === undefined
  ) {
    return undefined;
  }

  return {
    limit,
    used,
    remaining,
    usedPercent:
      individualLimit.used_percent ?? (limit === 0 ? 0 : (used / limit) * 100),
    resetAt,
  };
}

export function daysUntilReset(
  resetAt: number,
  now = Date.now()
): number | undefined {
  const days = (resetAt * 1000 - now) / 86_400_000;
  return days > 0 ? days : undefined;
}

export function creditsPerDayUntilReset(
  usage: MonthlyUsage,
  now = Date.now()
): number | undefined {
  const days = daysUntilReset(usage.resetAt, now);
  return days === undefined ? undefined : usage.remaining / days;
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
