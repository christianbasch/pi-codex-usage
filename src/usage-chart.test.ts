import { describe, expect, it } from 'vitest';
import {
  buildModelColorMap,
  buildModelSegments,
  type ChartItem,
  calculateBarLength,
  calculateSegmentBarLengths,
  calculateSegmentLengths,
  calculateXAxisTicks,
  computeTopModels,
  renderSegmentBar,
  sortModelSegments,
} from './usage-chart.ts';

describe('calculateBarLength', () => {
  it('scales linearly by default', () => {
    expect(calculateBarLength(125, 500, 20)).toBe(5);
  });

  it('supports square-root scaling', () => {
    expect(calculateBarLength(125, 500, 20, 'sqrt')).toBe(10);
  });

  it('spaces logarithmic decades evenly from zero', () => {
    expect(calculateBarLength(0, 1000, 100, 'log')).toBe(0);
    expect(calculateBarLength(1, 1000, 100, 'log')).toBe(25);
    expect(calculateBarLength(10, 1000, 100, 'log')).toBe(50);
    expect(calculateBarLength(100, 1000, 100, 'log')).toBe(75);
    expect(calculateBarLength(1000, 1000, 100, 'log')).toBe(100);
  });
});

describe('calculateXAxisTicks', () => {
  it('uses scale-appropriate ticks', () => {
    expect(calculateXAxisTicks(10.6, 'linear')).toEqual([0, 10, 11]);
    expect(calculateXAxisTicks(1000, 'linear')).toEqual([
      0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000,
    ]);
    expect(calculateXAxisTicks(1000, 'sqrt')).toEqual([0, 100, 400, 900, 1000]);
    expect(calculateXAxisTicks(1000, 'log')).toEqual([0, 1, 10, 100, 1000]);
  });
});

describe('calculateSegmentLengths', () => {
  it('distributes the remainder to the largest fractions', () => {
    expect(calculateSegmentLengths([1, 1, 1], 10)).toEqual([4, 3, 3]);
  });

  it('returns zeros when the total is zero', () => {
    expect(calculateSegmentLengths([0, 0], 10)).toEqual([0, 0]);
  });

  it('allocates model segments by their fractional shares', () => {
    expect(calculateSegmentBarLengths([70, 20, 10], 100, 20)).toEqual([
      14, 4, 2,
    ]);
  });
});

describe('sortModelSegments', () => {
  it('sorts by credits, then alphabetically', () => {
    expect(
      sortModelSegments([
        { label: 'gpt-5.4', value: 10 },
        { label: 'gpt-5.6-sol', value: 30 },
        { label: 'gpt-5.5', value: 10 },
      ])
    ).toEqual([
      { label: 'gpt-5.6-sol', value: 30 },
      { label: 'gpt-5.4', value: 10 },
      { label: 'gpt-5.5', value: 10 },
    ]);
  });

  it('always places others after named model segments', () => {
    expect(
      sortModelSegments([
        { label: 'others', value: 30 },
        { label: 'gpt-5.4', value: 10 },
      ])
    ).toEqual([
      { label: 'gpt-5.4', value: 10 },
      { label: 'others', value: 30 },
    ]);
  });
});

describe('buildModelColorMap', () => {
  it('assigns colors alphabetically and maps others to gray', () => {
    const items: ChartItem[] = [
      {
        label: '07-01',
        value: 10,
        models: [
          { label: 'gpt-5.6-sol', value: 1 },
          { label: 'gpt-5.4', value: 2 },
          { label: 'others', value: 3 },
        ],
      },
    ];
    const map = buildModelColorMap(items);
    expect(map.get('gpt-5.4')).toStrictEqual([230, 159, 0]); // MODEL_COLORS[0]
    expect(map.get('gpt-5.6-sol')).toStrictEqual([86, 180, 233]); // MODEL_COLORS[1]
    expect(map.get('others')).toStrictEqual([120, 120, 120]);
  });
});

describe('renderSegmentBar', () => {
  it('renders one colored block per segment', () => {
    const bar = renderSegmentBar(
      [
        { color: [230, 159, 0], value: 2 },
        { color: [86, 180, 233], value: 1 },
      ],
      9
    );
    expect(bar).toBe(
      '\x1b[48;2;230;159;0m' +
        ' '.repeat(6) +
        '\x1b[49m' +
        '\x1b[48;2;86;180;233m' +
        ' '.repeat(3) +
        '\x1b[49m'
    );
  });
});

describe('computeTopModels', () => {
  it('selects the top models by total credits across all rows', () => {
    const row = (model: string, credits: number) => ({
      date: '2026-07-01',
      models: [
        {
          model,
          credits,
          uncached_text_input_tokens: 0,
          cached_text_input_tokens: 0,
          text_output_tokens: 0,
        },
      ],
    });
    const rows = [row('gpt-5.4', 10), row('gpt-5.6-sol', 5), row('gpt-5.5', 1)];
    expect(computeTopModels(rows, 2)).toEqual(
      new Set(['gpt-5.4', 'gpt-5.6-sol'])
    );
  });
});

describe('buildModelSegments', () => {
  const model = (name: string, credits: number) => ({
    model: name,
    credits,
    uncached_text_input_tokens: 0,
    cached_text_input_tokens: 0,
    text_output_tokens: 0,
  });

  it('folds models outside the top set into others, per row', () => {
    const row = {
      date: '2026-07-01',
      models: [
        model('gpt-5.4', 10),
        model('gpt-5.6-sol', 5),
        model('gpt-5.5', 1),
      ],
    };
    const topModels = new Set(['gpt-5.4', 'gpt-5.6-sol']);

    expect(buildModelSegments(row, topModels)).toEqual([
      { label: 'gpt-5.4', value: 10, tokenTotal: 0 },
      { label: 'gpt-5.6-sol', value: 5, tokenTotal: 0 },
      { label: 'others', value: 1, tokenTotal: 0 },
    ]);
  });

  it('omits the others segment when all models are named', () => {
    const row = { date: '2026-07-01', models: [model('gpt-5.4', 10)] };
    expect(buildModelSegments(row, new Set(['gpt-5.4']))).toEqual([
      { label: 'gpt-5.4', value: 10, tokenTotal: 0 },
    ]);
  });
});
