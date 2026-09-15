import type { Theme, ThemeColor } from '@earendil-works/pi-coding-agent';

const INTERVAL_MS = 100;
const HIGHLIGHT_STRENGTH = [0.3, 0.18, 0.08] as const;
const RESET_FOREGROUND = '\x1b[39m';

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface StatusShimmerSegment {
  text: string;
  color: ThemeColor;
  shimmer?: boolean;
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
  color: ThemeColor,
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

export class StatusShimmer {
  private position = 0;
  private direction = 1;
  private contentWidth = 1;
  private interval: ReturnType<typeof setInterval> | undefined;
  private onTick: (() => void) | undefined;

  reset(): void {
    this.position = 0;
    this.direction = 1;
  }

  start(onTick: () => void): void {
    this.onTick = onTick;
    if (this.interval !== undefined) return;
    this.interval = setInterval(() => {
      this.advance();
      this.onTick?.();
    }, INTERVAL_MS);
  }

  stop(): void {
    if (this.interval !== undefined) {
      clearInterval(this.interval);
      this.interval = undefined;
    }
    this.onTick = undefined;
  }

  render(theme: Theme, segments: StatusShimmerSegment[]): string {
    this.contentWidth = Math.max(
      1,
      segments.reduce(
        (width, segment) =>
          segment.shimmer === false ? width : width + [...segment.text].length,
        0
      )
    );

    let characterIndex = 0;
    return segments
      .map((segment) =>
        [...segment.text]
          .map((character) => {
            if (segment.shimmer === false) {
              return theme.fg(segment.color, character);
            }
            const distance = Math.abs(characterIndex - this.position);
            const strength = HIGHLIGHT_STRENGTH[distance];
            characterIndex += 1;
            if (strength === undefined) {
              return theme.fg(segment.color, character);
            }
            const ansi = shimmerAnsi(theme, segment.color, strength);
            return ansi
              ? `${ansi}${character}${RESET_FOREGROUND}`
              : theme.fg(segment.color, character);
          })
          .join('')
      )
      .join('');
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
