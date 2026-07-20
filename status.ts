export function buildStatusSegments(
  usedPercent: number,
  limit: number,
  paceRatio: number | undefined,
  formatCredits: (value: number) => string
): { base: string; paceOver: string | undefined } {
  const base = `${Math.round(usedPercent)}%/${formatCredits(limit)}`;
  const paceOver =
    paceRatio !== undefined && paceRatio > 1
      ? ` ${paceRatio.toFixed(1)}\u00d7`
      : undefined;
  return { base, paceOver };
}
