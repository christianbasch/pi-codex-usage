interface CompactUnit {
  threshold: number;
  divisor: number;
  suffix: string;
}

const CREDIT_UNITS: readonly CompactUnit[] = [
  { threshold: 1_000_000, divisor: 1_000_000, suffix: 'm' },
  { threshold: 1_000, divisor: 1_000, suffix: 'k' },
];

const TOKEN_UNITS: readonly CompactUnit[] = [
  { threshold: 1_000_000, divisor: 1_000_000, suffix: 'm' },
  { threshold: 1_000, divisor: 1_000, suffix: 'k' },
];

function formatCompactNumber(
  value: number,
  units: readonly CompactUnit[]
): string {
  const unit = units.find(({ threshold }) => Math.abs(value) >= threshold);
  const divisor = unit?.divisor ?? 1;
  const suffix = unit?.suffix ?? '';
  return (
    new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    }).format(value / divisor) + suffix
  );
}

export function formatCredits(value: number): string {
  return formatCompactNumber(value, CREDIT_UNITS);
}

export function formatResetAt(resetAt: number): string {
  return new Date(resetAt * 1000).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
  });
}

export function formatTokenCount(value: number): string {
  return formatCompactNumber(value, TOKEN_UNITS);
}

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const FULL_DAYS_ONLY_THRESHOLD = 2;

export function formatRemainingTime(
  remainingMinutes: number | undefined
): string | undefined {
  if (
    remainingMinutes === undefined ||
    !Number.isFinite(remainingMinutes) ||
    remainingMinutes < 0
  ) {
    return undefined;
  }

  const minutes = Math.floor(remainingMinutes);
  const days = Math.floor(minutes / MINUTES_PER_DAY);
  const hours = Math.floor((minutes % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  const leftoverMinutes = minutes % MINUTES_PER_HOUR;

  if (days >= FULL_DAYS_ONLY_THRESHOLD) return `${days}d`;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  return `${hours}:${String(leftoverMinutes).padStart(2, '0')}`;
}

export function formatPeriodBudget(
  minutesLeft: number | undefined,
  remainingCredits: number,
  dailyBudget: number | undefined
): string {
  if (minutesLeft !== undefined && minutesLeft < MINUTES_PER_DAY) {
    return `${formatCredits(Math.max(0, remainingCredits))} remaining`;
  }
  return dailyBudget ? `${formatCredits(Math.round(dailyBudget))}/day` : '';
}
