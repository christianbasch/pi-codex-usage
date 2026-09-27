import { sumModelCredits, type WorkspaceUserTokenUsage } from './analytics.ts';

export function sumCreditsInDateRange(
  rows: readonly WorkspaceUserTokenUsage[],
  startDate: string,
  endDate: string
): number {
  return rows
    .filter((row) => row.date >= startDate && row.date < endDate)
    .reduce((total, row) => total + sumModelCredits(row.models), 0);
}
