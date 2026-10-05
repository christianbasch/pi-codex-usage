import type { Theme } from '@earendil-works/pi-coding-agent';
import type { UsageDisplayMode } from '../shared/config.ts';
import type { BudgetDayPolicy } from '../shared/day-policy.ts';
import { formatCredits } from '../shared/format.ts';
import type { MonthlyUsage } from '../shared/usage/monthly-usage.ts';
import type { UsageRuntime } from '../shared/usage/usage-runtime.ts';
import {
  calculateBudgetDeviation,
  calculatePaceRatio,
} from '../shared/usage/usage-summary.ts';

export type BudgetColor = 'success' | 'warning' | 'error';
export type UsageColor = 'muted' | 'warning' | 'error';
export type StatusSegmentColor = BudgetColor | UsageColor | 'dim';

export interface StatusSegment {
  text: string;
  color: StatusSegmentColor;
  shimmer?: boolean;
}

const INITIAL_STATUS_SKELETON = '▒▒▒▒▒▒ ▒▒▒▒▒';

export function renderStatusSegments(
  theme: Theme,
  segments: StatusSegment[]
): string {
  return segments
    .map((segment) => theme.fg(segment.color, segment.text))
    .join('');
}

export function usageColor(usedPercent: number): UsageColor {
  if (usedPercent >= 90) return 'error';
  if (usedPercent >= 80) return 'warning';
  return 'muted';
}

export function budgetDeviationColor(deviation: number): BudgetColor {
  if (deviation <= 0) return 'success';
  if (deviation <= 5) return 'warning';
  return 'error';
}

export function paceColor(paceRatio: number): BudgetColor {
  if (paceRatio <= 1) return 'success';
  if (paceRatio <= 1.05) return 'warning';
  return 'error';
}

function buildBudgetSegment(
  usage: MonthlyUsage,
  policy: BudgetDayPolicy,
  mode: UsageDisplayMode
): StatusSegment | undefined {
  if (mode === 'pace') {
    const ratio = calculatePaceRatio(usage, policy);
    if (ratio === undefined) return undefined;
    const displayedRatio = ratio.toFixed(2);
    return {
      text: ` ${displayedRatio}×`,
      color: paceColor(Number(displayedRatio)),
    };
  }

  const deviation = calculateBudgetDeviation(usage, policy);
  if (deviation === undefined) return undefined;
  const roundedDeviation = Number(deviation.toFixed(1));
  const color = budgetDeviationColor(roundedDeviation);
  if (mode === 'pp') {
    const sign = roundedDeviation > 0 ? '+' : '';
    return { text: ` ${sign}${roundedDeviation.toFixed(1)} pp`, color };
  }

  const credits = Math.round((deviation / 100) * usage.limit);
  const sign = credits > 0 ? '+' : credits < 0 ? '−' : '';
  return { text: ` Δ${sign}${formatCredits(Math.abs(credits))} cr`, color };
}

export function buildStatusSegments(
  usageRuntime: Pick<UsageRuntime, 'currentUsage' | 'error'>,
  dayPolicy: BudgetDayPolicy,
  sessionCredits?: number,
  displayMode: UsageDisplayMode = 'pace'
): StatusSegment[] {
  const sessionSegments: StatusSegment[] =
    sessionCredits === undefined
      ? []
      : [
          {
            text: ` ~${formatCredits(sessionCredits)} cr`,
            color: 'dim',
            shimmer: false,
          },
        ];
  const policySegment: StatusSegment = {
    text: ` [${dayPolicy.statusAbbreviation}]`,
    color: 'dim',
    shimmer: false,
  };
  const monthlyUsage = usageRuntime.currentUsage;
  if (monthlyUsage) {
    const displayedUsedPercent = Math.round(monthlyUsage.usedPercent);
    const base = `${displayedUsedPercent}%/${formatCredits(monthlyUsage.limit)}`;
    const budgetSegment = buildBudgetSegment(
      monthlyUsage,
      dayPolicy,
      displayMode
    );
    return [
      { text: base, color: usageColor(displayedUsedPercent) },
      ...(budgetSegment === undefined ? [] : [budgetSegment]),
      policySegment,
      ...sessionSegments,
    ];
  }

  if (usageRuntime.error) {
    return [
      { text: `[Usage: ${usageRuntime.error}]`, color: 'muted' },
      ...sessionSegments,
    ];
  }

  return [
    { text: INITIAL_STATUS_SKELETON, color: 'dim' },
    policySegment,
    ...sessionSegments,
  ];
}
