import type {
  WorkspaceUserModelUsage,
  WorkspaceUserTokenUsage,
} from './analytics.ts';

export type Scale = 'linear' | 'sqrt' | 'log';

export interface ModelChartItem {
  models?: Array<{ label: string; value: number; tokenTotal?: number }>;
}

export interface ChartItem extends ModelChartItem {
  label: string;
  value: number;
  isWeekend?: boolean;
  cumulativeVariance?: number | null;
  cumulativeBudget?: number;
  cumulativeUsage?: number;
  tokenTotal?: number;
}

const OTHERS_LABEL = 'others';
const OTHERS_COLOR = [120, 120, 120] as const;

export const MODEL_COLORS = [
  [230, 159, 0],
  [86, 180, 233],
  [0, 158, 115],
  [240, 228, 66],
  [0, 114, 178],
  [213, 94, 0],
  [204, 121, 167],
] as const;

function colorToken(
  color: readonly [number, number, number],
  text: string
): string {
  return `\x1b[38;2;${color[0]};${color[1]};${color[2]}m${text}\x1b[39m`;
}

function colorBlock(
  color: readonly [number, number, number],
  length: number
): string {
  if (length === 0) return '';
  return `\x1b[48;2;${color[0]};${color[1]};${color[2]}m${' '.repeat(length)}\x1b[49m`;
}

export function renderSegmentBar(
  segments: Array<{ color: readonly [number, number, number]; value: number }>,
  barLength: number,
  scale: Scale = 'linear'
): string {
  const values = segments.map((segment) => segment.value);
  const total = values.reduce((sum, value) => sum + value, 0);
  const lengths = calculateSegmentBarLengths(values, total, barLength, scale);
  return segments.map((s, i) => colorBlock(s.color, lengths[i] ?? 0)).join('');
}

function logScaleValue(value: number): number {
  if (value <= 0) return 0;
  return value < 1 ? value : Math.log10(value) + 1;
}

export function calculateBarLength(
  value: number,
  maxValue: number,
  barWidth: number,
  scale: Scale = 'linear'
): number {
  if (scale === 'log') {
    return Math.round(
      (logScaleValue(value) / logScaleValue(maxValue)) * barWidth
    );
  }
  if (scale === 'sqrt') {
    return Math.round(Math.sqrt(value / maxValue) * barWidth);
  }
  return Math.round((value / maxValue) * barWidth);
}

function getNiceStep(maxValue: number): number {
  const roughStep = maxValue / 5;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const multiplier =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return multiplier * magnitude;
}

export function calculateXAxisTicks(maxValue: number, scale: Scale): number[] {
  const roundedMaxValue = Math.max(1, Math.round(maxValue));
  const ticks = [0];
  if (scale === 'linear') {
    let step = 10;
    let multiplier = 5;
    while (roundedMaxValue > step * 10) {
      step *= multiplier;
      multiplier = multiplier === 5 ? 2 : 5;
    }
    for (let value = step; value < roundedMaxValue; value += step) {
      ticks.push(value);
    }
  } else if (scale === 'sqrt') {
    const transformedMax = Math.sqrt(roundedMaxValue);
    const step = getNiceStep(transformedMax);
    let previousValue = 0;
    for (
      let transformedValue = step;
      transformedValue < transformedMax;
      transformedValue += step
    ) {
      const value = Math.round(transformedValue ** 2);
      if (value > previousValue && value < roundedMaxValue) {
        ticks.push(value);
        previousValue = value;
      }
    }
  } else {
    for (let value = 1; value < roundedMaxValue; value *= 10) {
      ticks.push(value);
    }
  }
  return ticks;
}

export function calculateSegmentLengths(
  values: number[],
  length: number
): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total === 0) return values.map(() => 0);

  const rawLengths = values.map((value) => (length * value) / total);
  const lengths = rawLengths.map(Math.floor);
  const remaining = length - lengths.reduce((sum, value) => sum + value, 0);
  const rankedFractions = rawLengths
    .map((rawLength, index) => ({ index, fraction: rawLength % 1 }))
    .sort((a, b) => b.fraction - a.fraction);

  for (let index = 0; index < remaining; index++) {
    const segment = rankedFractions[index];
    if (segment) lengths[segment.index] = (lengths[segment.index] ?? 0) + 1;
  }

  return lengths;
}

export function calculateSegmentBarLengths(
  values: number[],
  maxValue: number,
  barWidth: number,
  scale: Scale = 'linear'
): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total === 0) return values.map(() => 0);

  const barLength = calculateBarLength(total, maxValue, barWidth, scale);
  let lengths: number[];
  if (scale === 'linear') {
    lengths = calculateSegmentLengths(values, barLength);
  } else {
    let cumulativeValue = 0;
    let previousBoundary = 0;
    lengths = values.map((value) => {
      cumulativeValue += value;
      const boundary = calculateBarLength(
        cumulativeValue,
        maxValue,
        barWidth,
        scale
      );
      const length = boundary - previousBoundary;
      previousBoundary = boundary;
      return length;
    });
  }

  const minimums = values.map((value) => (value > 0 ? 1 : 0));
  if (minimums.reduce<number>((sum, value) => sum + value, 0) > barLength) {
    return lengths;
  }

  const adjusted = lengths.map((length, index) =>
    Math.max(length, minimums[index] ?? 0)
  );
  let excess = adjusted.reduce((sum, length) => sum + length, 0) - barLength;
  while (excess > 0) {
    let donor = -1;
    let available = 0;
    for (let index = 0; index < adjusted.length; index++) {
      const candidate = (adjusted[index] ?? 0) - (minimums[index] ?? 0);
      if (candidate > available) {
        donor = index;
        available = candidate;
      }
    }
    if (donor < 0) break;
    const reclaimed = Math.min(excess, available);
    adjusted[donor] = (adjusted[donor] ?? 0) - reclaimed;
    excess -= reclaimed;
  }
  return adjusted;
}

export function sortModelSegments(
  models: NonNullable<ModelChartItem['models']>
): NonNullable<ModelChartItem['models']> {
  return [...models].sort(
    (a, b) => a.value - b.value || a.label.localeCompare(b.label)
  );
}

export function buildModelColorMap(
  items: ChartItem[]
): Map<string, readonly [number, number, number]> {
  const models = [
    ...new Set(items.flatMap((item) => item.models?.map((m) => m.label) ?? [])),
  ]
    .filter((m) => m !== OTHERS_LABEL)
    .sort((a, b) => a.localeCompare(b));
  // getChart keeps at most MODEL_COLORS.length named models.
  const map = new Map<string, readonly [number, number, number]>(
    models.map((model, i) => [model, MODEL_COLORS[i]!])
  );
  map.set(OTHERS_LABEL, OTHERS_COLOR);
  return map;
}

/**
 * Determines which models count as "named" segments: the
 * `topModelCount` models with the highest total credits across all rows.
 */
export function computeTopModels(
  rows: WorkspaceUserTokenUsage[],
  topModelCount: number
): Set<string> {
  const modelTotals = new Map<string, number>();
  for (const row of rows) {
    for (const model of row.models) {
      modelTotals.set(
        model.model,
        (modelTotals.get(model.model) ?? 0) + model.credits
      );
    }
  }
  return new Set(
    [...modelTotals.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, topModelCount)
      .map(([model]) => model)
  );
}

/**
 * Aggregates a single row's models into chart segments: models outside
 * `topModels` are folded into an "others" segment. Segments are sorted
 * from least to most credits.
 */
export function buildModelSegments(
  row: WorkspaceUserTokenUsage,
  topModels: Set<string>
): NonNullable<ModelChartItem['models']> {
  const named = new Map<
    string,
    { label: string; value: number; tokenTotal: number }
  >();
  let othersTotal = 0;
  let othersTokens = 0;
  for (const model of row.models) {
    const tokenTotal = sumModelTokensForModel(model);
    if (topModels.has(model.model)) {
      const existing = named.get(model.model);
      if (existing) {
        existing.value += model.credits;
        existing.tokenTotal += tokenTotal;
      } else {
        named.set(model.model, {
          label: model.model,
          value: model.credits,
          tokenTotal,
        });
      }
    } else {
      othersTotal += model.credits;
      othersTokens += tokenTotal;
    }
  }
  const segments = [...named.values()];
  if (othersTotal > 0)
    segments.push({
      label: OTHERS_LABEL,
      value: othersTotal,
      tokenTotal: othersTokens,
    });
  return sortModelSegments(segments);
}

export function sumModelTokensForModel(model: WorkspaceUserModelUsage): number {
  return (
    model.uncached_text_input_tokens +
    model.cached_text_input_tokens +
    model.text_output_tokens
  );
}

export { colorToken };
