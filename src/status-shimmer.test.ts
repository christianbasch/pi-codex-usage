import type { Theme, ThemeColor } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatusShimmer } from './status-shimmer.ts';

const colors: Record<string, string> = {
  error: '\x1b[38;2;255;0;0m',
  warning: '\x1b[38;2;255;255;0m',
};

function createTheme(): Theme {
  return {
    fg: (color: ThemeColor, text: string) =>
      `${colors[color] ?? ''}${text}\x1b[39m`,
    getFgAnsi: (color: ThemeColor) => colors[color] ?? '\x1b[39m',
    getColorMode: () => 'truecolor',
    bold: (text: string) => `<bold>${text}</bold>`,
  } as Theme;
}

describe('StatusShimmer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('brightens each semantic color without replacing its hue', () => {
    const shimmer = new StatusShimmer();
    shimmer.begin(
      1,
      [
        { text: 'R', color: 'error' },
        { text: 'Y', color: 'warning' },
      ],
      () => {}
    );
    const rendered = shimmer.render(createTheme());

    expect(rendered).toContain('\x1b[38;2;255;77;77mR');
    expect(rendered).toContain('\x1b[38;2;255;255;46mY');
  });

  it('leaves non-shimmer segments at their base color', () => {
    const shimmer = new StatusShimmer();
    shimmer.begin(
      1,
      [
        { text: 'R', color: 'error' },
        { text: 'D', color: 'warning', shimmer: false },
      ],
      () => {}
    );
    const rendered = shimmer.render(createTheme());

    expect(rendered).toContain('\x1b[38;2;255;77;77mR');
    expect(rendered).toContain('\x1b[38;2;255;255;0mD');
    expect(rendered).not.toContain('\x1b[38;2;255;255;46mD');
  });

  it('keeps semantic bold segments bold throughout the shimmer', () => {
    const shimmer = new StatusShimmer();
    shimmer.begin(1, [{ text: 'O', color: 'warning', bold: true }], () => {});

    expect(shimmer.render(createTheme())).toContain('<bold>');
    shimmer.clear();
  });

  it.each(['\x1b[38;5;1m', '\x1b[39m'])(
    'falls back to a bold shimmer for unsupported foreground %j',
    (foreground) => {
      const fallbackTheme = {
        fg: (_color: ThemeColor, text: string) =>
          `${foreground}${text}\x1b[39m`,
        getFgAnsi: () => foreground,
        getColorMode: () => '256color',
        bold: (text: string) => `<bold>${text}</bold>`,
      } as unknown as Theme;

      const shimmer = new StatusShimmer();
      shimmer.begin(1, [{ text: 'R', color: 'error' }], () => {});

      expect(shimmer.render(fallbackTheme)).toContain(
        `<bold>${foreground}R\x1b[39m</bold>`
      );
    }
  );

  it('uses a visible palette step in 256-color terminals', () => {
    const theme256 = {
      fg: (_color: ThemeColor, text: string) => `\x1b[38;5;196m${text}\x1b[39m`,
      getFgAnsi: () => '\x1b[38;5;196m',
      getColorMode: () => '256color',
      bold: (text: string) => `<bold>${text}</bold>`,
    } as unknown as Theme;

    const shimmer = new StatusShimmer();
    shimmer.begin(1, [{ text: 'R', color: 'error' }], () => {});

    expect(shimmer.render(theme256)).toContain('\x1b[38;5;203mR');
  });

  it('moves the highlight and reverses at the status edges', () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const shimmer = new StatusShimmer();
    const segments = [{ text: 'abc', color: 'error' as const }];

    expect(shimmer.roundTripDuration(segments)).toBe(400);
    expect(shimmer.roundTripDuration([{ text: 'abcd', color: 'error' }])).toBe(
      600
    );
    expect(
      shimmer.roundTripDuration([
        ...segments,
        { text: 'day mode', color: 'warning', shimmer: false },
      ])
    ).toBe(400);
    shimmer.begin(1, segments, onTick);

    vi.advanceTimersByTime(100);
    expect(shimmer.render(createTheme())).toContain('\x1b[38;2;255;77;77mb');

    vi.advanceTimersByTime(100);
    expect(shimmer.render(createTheme())).toContain('\x1b[38;2;255;77;77mc');

    vi.advanceTimersByTime(100);
    expect(shimmer.render(createTheme())).toContain('\x1b[38;2;255;77;77mb');
    expect(onTick).toHaveBeenCalledTimes(3);

    shimmer.clear();
  });

  it('keeps the shimmer running until its full round trip completes', () => {
    vi.useFakeTimers();
    const onComplete = vi.fn();
    const shimmer = new StatusShimmer();
    const segments = [{ text: 'abc', color: 'error' as const }];

    shimmer.begin(1, segments, () => {});
    expect(shimmer.finish(onComplete)).toBe(true);
    vi.advanceTimersByTime(399);
    expect(onComplete).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(shimmer.segments).toBeUndefined();
  });

  it('does not start multiple animation intervals', () => {
    vi.useFakeTimers();
    const firstOnTick = vi.fn();
    const secondOnTick = vi.fn();
    const shimmer = new StatusShimmer();

    shimmer.begin(1, [{ text: 'a', color: 'error' }], firstOnTick);
    shimmer.begin(1, [{ text: 'a', color: 'error' }], secondOnTick);
    vi.advanceTimersByTime(100);

    expect(firstOnTick).toHaveBeenCalledTimes(1);
    expect(secondOnTick).not.toHaveBeenCalled();
    shimmer.clear();
  });
});
