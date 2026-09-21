import type { Theme } from '@earendil-works/pi-coding-agent';
import type { StatusSegment } from './status.ts';

const INTERVAL_MS = 100;
const HIGHLIGHT_STRENGTH = [0.3, 0.18, 0.08] as const;
const RESET_FOREGROUND = '\x1b[39m';

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

function ansi256ToRgb(index: number): RgbColor | undefined {
  if (index < 16 || index > 255) return undefined;
  if (index >= 232) {
    const value = 8 + (index - 232) * 10;
    return { r: value, g: value, b: value };
  }

  const offset = index - 16;
  const values = [0, 95, 135, 175, 215, 255] as const;
  return {
    r: values[Math.floor(offset / 36)]!,
    g: values[Math.floor((offset % 36) / 6)]!,
    b: values[offset % 6]!,
  };
}

function parseForeground(ansi: string): RgbColor | undefined {
  const trueColor = ansi.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
  if (trueColor) {
    return {
      r: Number(trueColor[1]),
      g: Number(trueColor[2]),
      b: Number(trueColor[3]),
    };
  }

  const color256 = ansi.match(/\x1b\[38;5;(\d+)m/);
  return color256 ? ansi256ToRgb(Number(color256[1])) : undefined;
}

function brighten(color: RgbColor, strength: number): RgbColor {
  return {
    r: Math.round(color.r + (255 - color.r) * strength),
    g: Math.round(color.g + (255 - color.g) * strength),
    b: Math.round(color.b + (255 - color.b) * strength),
  };
}

function colorDistance(a: RgbColor, b: RgbColor): number {
  const red = a.r - b.r;
  const green = a.g - b.g;
  const blue = a.b - b.b;
  return red * red * 0.299 + green * green * 0.587 + blue * blue * 0.114;
}

function rgbTo256(color: RgbColor): number {
  let closestIndex = 16;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let index = 16; index <= 255; index += 1) {
    const candidate = ansi256ToRgb(index)!;
    const distance = colorDistance(color, candidate);
    if (distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  }
  return closestIndex;
}

function shimmerAnsi(
  theme: Theme,
  color: StatusSegment['color'],
  strength: number
): string | undefined {
  const base = parseForeground(theme.getFgAnsi(color));
  if (!base) return undefined;
  const mode = theme.getColorMode();
  const highlighted = brighten(base, strength);
  return mode === 'truecolor'
    ? `\x1b[38;2;${highlighted.r};${highlighted.g};${highlighted.b}m`
    : `\x1b[38;5;${rgbTo256(highlighted)}m`;
}

function applyBold(theme: Theme, text: string, bold = false): string {
  return bold ? theme.bold(text) : text;
}

function shimmerWidth(segments: StatusSegment[]): number {
  return Math.max(
    1,
    segments.reduce(
      (width, segment) =>
        segment.shimmer === false ? width : width + [...segment.text].length,
      0
    )
  );
}

export class StatusShimmer {
  private position = 0;
  private direction = 1;
  private contentWidth = 1;
  private refreshGeneration: number | undefined;
  private activeSegments: StatusSegment[] | undefined;
  private shownAt: number | undefined;
  private minimumDuration = 0;
  private interval: ReturnType<typeof setInterval> | undefined;
  private completionTimer: ReturnType<typeof setTimeout> | undefined;
  private onTick: (() => void) | undefined;

  get segments(): StatusSegment[] | undefined {
    return this.activeSegments;
  }

  begin(
    generation: number,
    segments: StatusSegment[],
    onTick: () => void
  ): void {
    if (this.refreshGeneration === generation) return;

    this.clear();
    this.refreshGeneration = generation;
    this.activeSegments = segments;
    this.contentWidth = shimmerWidth(segments);
    this.minimumDuration = this.roundTripDuration(segments);
    this.shownAt = performance.now();
    this.onTick = onTick;
    this.interval = setInterval(() => {
      this.advance();
      this.onTick?.();
    }, INTERVAL_MS);
  }

  roundTripDuration(segments: StatusSegment[]): number {
    return (shimmerWidth(segments) - 1) * 2 * INTERVAL_MS;
  }

  render(theme: Theme): string {
    const segments = this.activeSegments;
    if (!segments) return '';

    let characterIndex = 0;
    return segments
      .map((segment) =>
        [...segment.text]
          .map((character) => {
            if (segment.shimmer === false) {
              return applyBold(
                theme,
                theme.fg(segment.color, character),
                segment.bold
              );
            }
            const distance = Math.abs(characterIndex - this.position);
            const strength = HIGHLIGHT_STRENGTH[distance];
            characterIndex += 1;
            if (strength === undefined) {
              return applyBold(
                theme,
                theme.fg(segment.color, character),
                segment.bold
              );
            }
            const ansi = shimmerAnsi(theme, segment.color, strength);
            if (ansi) {
              return applyBold(
                theme,
                `${ansi}${character}${RESET_FOREGROUND}`,
                segment.bold
              );
            }
            const themedCharacter = theme.fg(segment.color, character);
            return distance === 0 || segment.bold
              ? theme.bold(themedCharacter)
              : themedCharacter;
          })
          .join('')
      )
      .join('');
  }

  finish(onComplete: () => void): boolean {
    if (this.shownAt === undefined) return false;

    const remaining = this.minimumDuration - (performance.now() - this.shownAt);
    if (remaining <= 0) {
      this.clear();
      return false;
    }

    if (this.completionTimer === undefined) {
      this.completionTimer = setTimeout(() => {
        this.completionTimer = undefined;
        this.clear();
        onComplete();
      }, remaining);
    }
    return true;
  }

  clear(): void {
    if (this.interval !== undefined) clearInterval(this.interval);
    if (this.completionTimer !== undefined) clearTimeout(this.completionTimer);
    this.position = 0;
    this.direction = 1;
    this.contentWidth = 1;
    this.refreshGeneration = undefined;
    this.activeSegments = undefined;
    this.shownAt = undefined;
    this.minimumDuration = 0;
    this.interval = undefined;
    this.completionTimer = undefined;
    this.onTick = undefined;
  }

  private advance(): void {
    if (this.contentWidth <= 1) return;
    const next = this.position + this.direction;
    if (next >= this.contentWidth) {
      this.direction = -1;
      this.position = this.contentWidth - 2;
    } else if (next < 0) {
      this.direction = 1;
      this.position = 1;
    } else {
      this.position = next;
    }
  }
}
