export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export function ansi256ToRgb(index: number): RgbColor | undefined {
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

function colorDistance(a: RgbColor, b: RgbColor): number {
  const red = a.r - b.r;
  const green = a.g - b.g;
  const blue = a.b - b.b;
  return red * red * 0.299 + green * green * 0.587 + blue * blue * 0.114;
}

export function rgbTo256(color: RgbColor): number {
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
