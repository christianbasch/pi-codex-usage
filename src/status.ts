export type PaceColor = 'success' | 'warning' | 'error';
export type UsageColor = 'muted' | 'warning' | 'error';

export function usageColor(usedPercent: number): UsageColor {
  if (usedPercent >= 90) return 'error';
  if (usedPercent >= 80) return 'warning';
  return 'muted';
}

export function paceColor(paceRatio: number): PaceColor {
  if (paceRatio <= 0.95) return 'success';
  if (paceRatio <= 1.05) return 'warning';
  return 'error';
}

export function buildStatusSegments(
  usedPercent: number,
  limit: number,
  paceRatio: number | undefined,
  formatCredits: (value: number) => string
): {
  base: string;
  baseColor: UsageColor;
  pace: { text: string; color: PaceColor } | undefined;
} {
  const base = `${Math.round(usedPercent)}%/${formatCredits(limit)}`;
  const pace =
    paceRatio !== undefined
      ? { text: ` ${paceRatio.toFixed(2)}\u00d7`, color: paceColor(paceRatio) }
      : undefined;
  return { base, baseColor: usageColor(usedPercent), pace };
}
