import type { Theme } from '@earendil-works/pi-coding-agent';
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

function sessionCreditSegment(credits: number): StatusSegment {
  return {
    text: ` ~${formatCredits(credits)} cr`,
    color: 'dim',
    shimmer: false,
  };
}

export function replaceSessionCreditSegment(
  segments: StatusSegment[],
  previousCredits: number | undefined,
  credits: number | undefined
): StatusSegment[] {
  const base = previousCredits === undefined ? segments : segments.slice(0, -1);
  return credits === undefined
    ? base
    : [...base, sessionCreditSegment(credits)];
}

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

export function paceColor(paceRatio: number): PaceColor {
  if (paceRatio <= 0.95) return 'success';
  if (paceRatio <= 1.05) return 'warning';
  return 'error';
}

export function buildStatusSegments(
  usageRuntime: Pick<UsageRuntime, 'currentUsage' | 'error'>,
  dayPolicy: DayPolicy,
  sessionCredits?: number
): StatusSegment[] {
  const sessionSegments =
    sessionCredits === undefined ? [] : [sessionCreditSegment(sessionCredits)];
  const monthlyUsage = usageRuntime.currentUsage;
  if (monthlyUsage) {
    const displayedUsedPercent = Math.round(monthlyUsage.usedPercent);
    const base = `${displayedUsedPercent}%/${formatCredits(monthlyUsage.limit)}`;
    const segments: StatusSegment[] = [
      { text: base, color: usageColor(displayedUsedPercent) },
    ];
    const paceRatio = calculatePaceRatio(monthlyUsage, dayPolicy);
    if (paceRatio !== undefined) {
      const displayedPace = paceRatio.toFixed(2);
      segments.push({
        text: ` ${displayedPace}\u00d7`,
        color: paceColor(Number(displayedPace)),
      });
    }
    segments.push({
      text: dayPolicy === 'weekdays' ? ' [wkd]' : ' [cal]',
      color: 'dim',
      shimmer: false,
    });
    return [...segments, ...sessionSegments];
  }

  if (usageRuntime.error) {
    return [
      { text: `[Usage: ${usageRuntime.error}]`, color: 'muted' },
      ...sessionSegments,
    ];
  }

  return [
    { text: INITIAL_STATUS_SKELETON, color: 'dim' },
    {
      text: dayPolicy === 'weekdays' ? ' [wkd]' : ' [cal]',
      color: 'dim',
      shimmer: false,
    },
    ...sessionSegments,
  ];
}
