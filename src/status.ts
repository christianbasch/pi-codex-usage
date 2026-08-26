export type PaceColor = 'success' | 'warning' | 'error';

export const SPINNER_FRAMES = [
  '⠋',
  '⠙',
  '⠹',
  '⠸',
  '⠼',
  '⠴',
  '⠦',
  '⠧',
  '⠇',
  '⠏',
];
export const SPINNER_INTERVAL_MS = 80;

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
  pace: { text: string; color: PaceColor } | undefined;
} {
  const base = `${Math.round(usedPercent)}%/${formatCredits(limit)}`;
  const pace =
    paceRatio !== undefined
      ? { text: ` ${paceRatio.toFixed(2)}\u00d7`, color: paceColor(paceRatio) }
      : undefined;
  return { base, pace };
}
