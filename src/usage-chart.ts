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
  periodBudget?: number;
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
  barLength: number
): string {
  const lengths = calculateSegmentLengths(
    segments.map((s) => s.value),
    barLength
  );
  return segments.map((s, i) => colorBlock(s.color, lengths[i] ?? 0)).join('');
}

function logScaleValue(value: number): number {
  return value <= 0 ? 0 : Math.log10(value) + 1;
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

/**
 * Returns scale ticks below the observed maximum. The maximum is omitted
 * because it is already shown in the chart value column and can crowd the
 * preceding tick, especially on log scales.
 */
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
  barWidth: number
): number[] {
  const total = values.reduce((sum, value) => sum + value, 0);
  return calculateSegmentLengths(
    values,
    total === 0 ? 0 : calculateBarLength(total, maxValue, barWidth)
  );
}

export function sortModelSegments(
  models: NonNullable<ModelChartItem['models']>
): NonNullable<ModelChartItem['models']> {
  return [...models].sort((a, b) => {
    if (a.label === OTHERS_LABEL) return 1;
    if (b.label === OTHERS_LABEL) return -1;
    return b.value - a.value || a.label.localeCompare(b.label);
  });
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
 * by value with "others" last.
 */
export function buildModelSegments(
  row: WorkspaceUserTokenUsage,
  topModels: Set<string>
): NonNullable<ModelChartItem['models']> {
  const named: Array<{ label: string; value: number; tokenTotal: number }> = [];
  let othersTotal = 0;
  let othersTokens = 0;
  for (const model of row.models) {
    const tokenTotal = sumModelTokensForModel(model);
    if (topModels.has(model.model)) {
      named.push({
        label: model.model,
        value: model.credits,
        tokenTotal,
      });
    } else {
      othersTotal += model.credits;
      othersTokens += tokenTotal;
    }
  }
  if (othersTotal > 0)
    named.push({
      label: OTHERS_LABEL,
      value: othersTotal,
      tokenTotal: othersTokens,
    });
  return sortModelSegments(named);
}

export function sumModelTokensForModel(model: WorkspaceUserModelUsage): number {
  return (
    model.uncached_text_input_tokens +
    model.cached_text_input_tokens +
    model.text_output_tokens
  );
}

export { colorToken };
