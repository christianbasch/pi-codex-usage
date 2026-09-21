import type { DayPolicy } from './config.ts';
import { formatCredits } from './format.ts';
import type { UsageRuntime } from './usage-runtime.ts';
import {
  calculatePaceRatio,
  calculatePeriodProgress,
} from './usage-summary.ts';

export type PaceColor = 'success' | 'warning' | 'error';
export type StatusSegmentColor = PaceColor | 'muted' | 'dim';

export interface StatusSegment {
  text: string;
  color: StatusSegmentColor;
  shimmer?: boolean;
  bold?: boolean;
}

const INITIAL_STATUS_SKELETON = '▒▒▒▒▒▒ ▒ ▒▒▒▒▒▒▒';

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
    const displayedUsedPercent = Math.round(monthlyUsage.usedPercent);
    const base = `${displayedUsedPercent}%/${formatCredits(monthlyUsage.limit)}`;
    const segments: StatusSegment[] = [{ text: base, color: 'muted' }];
    const now = new Date();
    const progress = calculatePeriodProgress(monthlyUsage, dayPolicy, now);
    const paceRatio = calculatePaceRatio(monthlyUsage, dayPolicy, now);
    if (progress && paceRatio !== undefined) {
      const color = paceColor(paceRatio);
      const operator =
        color === 'success' ? '<' : color === 'warning' ? '≈' : '>';
      segments.push(
        { text: ' ', color: 'muted' },
        { text: operator, color, bold: true },
        {
          text: ` ${Math.round(progress.elapsedPercent)}%/${Math.round(progress.periodDays)}d`,
          color: 'muted',
        }
      );
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
