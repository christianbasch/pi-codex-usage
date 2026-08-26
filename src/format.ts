interface CompactUnit {
  threshold: number;
  divisor: number;
  suffix: string;
}

const CREDIT_UNITS: readonly CompactUnit[] = [
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

export function formatTokenCount(value: number): string {
  return formatCompactNumber(value, TOKEN_UNITS);
}
