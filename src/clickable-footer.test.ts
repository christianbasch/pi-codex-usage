import type {
  ExtensionContext,
  ReadonlyFooterDataProvider,
} from '@earendil-works/pi-coding-agent';
import type {
  TuiMouseEvent,
  TuiMouseEventResult,
} from '@earendil-works/pi-tui';
import { describe, expect, it, vi } from 'vitest';
import { createClickableFooter } from './clickable-footer.ts';

const STATUS_KEY = '00-codex-usage';

function click(x: number): TuiMouseEvent {
  return {
    type: 'click',
    button: 'left',
    x,
    y: 2,
    screenX: x,
    screenY: 2,
    width: 40,
    height: 3,
    shift: false,
    alt: false,
    ctrl: false,
  };
}

describe('clickable footer', () => {
  it('separates the day mode hit area from the rest of the status', () => {
    const status = '13%/8k [cal]';
    const statuses = new Map([[STATUS_KEY, status]]);
    const footerData = {
      getGitBranch: () => null,
      getExtensionStatuses: () => statuses,
      getAvailableProviderCount: () => 1,
      onBranchChange: () => () => {},
    } as ReadonlyFooterDataProvider;
    const ctx = {
      model: undefined,
      thinkingLevel: 'off',
      sessionManager: {},
      getContextUsage: () => undefined,
    } as unknown as ExtensionContext;
    const onStatusClick = vi.fn();
    const onDayPolicyClick = vi.fn();
    const footer = createClickableFooter(
      ctx,
      footerData,
      STATUS_KEY,
      onStatusClick,
      onDayPolicyClick
    );

    expect(footer.handleMouse(click(status.indexOf('[')))).toEqual({
      handled: true,
    } satisfies TuiMouseEventResult);
    expect(onDayPolicyClick).toHaveBeenCalledOnce();
    expect(onStatusClick).not.toHaveBeenCalled();

    expect(footer.handleMouse(click(0))).toEqual({ handled: true });
    expect(onStatusClick).toHaveBeenCalledOnce();
  });
});
