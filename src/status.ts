import type { DayPolicy } from './config.ts';
import { formatCredits } from './format.ts';
import type { UsageRuntime } from './usage-runtime.ts';
import { calculatePaceRatio } from './usage-summary.ts';

export type PaceColor = 'success' | 'warning' | 'error';
export type UsageColor = 'muted' | 'warning' | 'error';
export type StatusSegmentColor = PaceColor | UsageColor | 'dim';

export interface StatusSegment {
  text: string;
  color: StatusSegmentColor;
  shimmer?: boolean;
}

const INITIAL_STATUS_SKELETON = '▒▒▒▒▒▒ ▒▒▒▒▒';

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
  usageRuntime: Pick<UsageRuntime, 'currentUsage' | 'error'>,
  dayPolicy: DayPolicy
): StatusSegment[] {
  const monthlyUsage = usageRuntime.currentUsage;
  if (monthlyUsage) {
    const base = `${Math.round(monthlyUsage.usedPercent)}%/${formatCredits(
      monthlyUsage.limit
    )}`;
    const segments: StatusSegment[] = [
      { text: base, color: usageColor(monthlyUsage.usedPercent) },
    ];
    const paceRatio = calculatePaceRatio(monthlyUsage, dayPolicy);
    if (paceRatio !== undefined) {
      segments.push({
        text: ` ${paceRatio.toFixed(2)}\u00d7`,
        color: paceColor(paceRatio),
      });
    }
    segments.push({
      text: dayPolicy === 'weekdays' ? ' [wkd]' : ' [cal]',
      color: 'dim',
      shimmer: false,
    });
    return segments;
  }

  if (usageRuntime.error) {
    return [{ text: `[Usage: ${usageRuntime.error}]`, color: 'muted' }];
  }

  return [
    { text: INITIAL_STATUS_SKELETON, color: 'dim' },
    {
      text: dayPolicy === 'weekdays' ? ' [wkd]' : ' [cal]',
      color: 'dim',
      shimmer: false,
    },
  ];
}
