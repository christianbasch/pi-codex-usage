export function formatCredits(value: number): string {
  const displayValue = Math.abs(value) >= 1000 ? value / 1000 : value;
  const suffix = Math.abs(value) >= 1000 ? 'k' : '';
  return (
    new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    }).format(displayValue) + suffix
  );
}

export function formatTokenCount(value: number): string {
  const absolute = Math.abs(value);
  const divisor =
    absolute >= 1_000_000 ? 1_000_000 : absolute >= 1_000 ? 1_000 : 1;
  const suffix = divisor === 1_000_000 ? 'm' : divisor === 1_000 ? 'k' : '';
  return (
    new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    }).format(value / divisor) + suffix
  );
}
