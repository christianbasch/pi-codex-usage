import {
  type ExtensionContext,
  FooterComponent,
  type ReadonlyFooterDataProvider,
} from '@earendil-works/pi-coding-agent';
import {
  type Component,
  stripTerminalSequences,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  visibleWidth,
} from '@earendil-works/pi-tui';

interface StatusRange {
  start: number;
  end: number;
}

interface StatusRanges {
  status: StatusRange;
  dayPolicy: StatusRange | undefined;
}

function sanitizeStatusText(text: string): string {
  return text
    .replace(/[\r\n\t]/g, ' ')
    .replace(/ +/g, ' ')
    .trim();
}

function statusRanges(
  footerData: ReadonlyFooterDataProvider,
  statusKey: string
): StatusRanges | undefined {
  const statuses = Array.from(footerData.getExtensionStatuses().entries()).sort(
    ([a], [b]) => a.localeCompare(b)
  );
  const statusIndex = statuses.findIndex(([key]) => key === statusKey);
  if (statusIndex === -1) return undefined;

  const renderedStatuses = statuses.map(([, text]) => sanitizeStatusText(text));
  const text = renderedStatuses[statusIndex];
  if (!text) return undefined;

  const prefix = renderedStatuses.slice(0, statusIndex).join(' ');
  const start = prefix ? visibleWidth(prefix) + 1 : 0;
  const status = { start, end: start + visibleWidth(text) };
  const plainText = stripTerminalSequences(text);
  const dayPolicyMatch = /\[(?:cal|wkd)\]$/.exec(plainText);
  const dayPolicy = dayPolicyMatch
    ? {
        start: start + visibleWidth(plainText.slice(0, dayPolicyMatch.index)),
        end: start + visibleWidth(plainText),
      }
    : undefined;

  return { status, dayPolicy };
}

function createFooterSession(
  ctx: ExtensionContext
): ConstructorParameters<typeof FooterComponent>[0] {
  return {
    get state() {
      return {
        model: ctx.model,
        thinkingLevel: ctx.thinkingLevel,
      };
    },
    sessionManager: ctx.sessionManager,
    getContextUsage: () => ctx.getContextUsage(),
    modelRuntime: {
      isUsingSubscription: (provider: string) => provider === 'openai-codex',
    },
  } as unknown as ConstructorParameters<typeof FooterComponent>[0];
}

export function createClickableFooter(
  ctx: ExtensionContext,
  footerData: ReadonlyFooterDataProvider,
  statusKey: string,
  onStatusClick: () => void,
  onDayPolicyClick: () => void
): Component & {
  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined;
  dispose(): void;
} {
  const footer = new FooterComponent(createFooterSession(ctx), footerData);

  return {
    render: (width) => footer.render(width),
    handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
      if (event.type !== 'click' || event.button !== 'left') return undefined;

      const ranges = statusRanges(footerData, statusKey);
      if (ranges === undefined || event.y !== event.height - 1) {
        return undefined;
      }

      const inRange = (range: StatusRange): boolean =>
        event.x >= range.start && event.x < Math.min(range.end, event.width);
      if (!inRange(ranges.status)) return undefined;

      if (ranges.dayPolicy && inRange(ranges.dayPolicy)) {
        onDayPolicyClick();
      } else {
        onStatusClick();
      }
      return { handled: true };
    },
    invalidate: () => footer.invalidate(),
    dispose: () => footer.dispose(),
  };
}
