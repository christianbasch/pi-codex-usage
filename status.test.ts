import { describe, expect, it } from 'vitest';
import { buildStatusSegments } from './status.ts';

const fmt = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 2)}k` : String(v);

describe('buildStatusSegments', () => {
  it('formats base as pct/limit', () => {
    expect(buildStatusSegments(65, 8000, undefined, fmt).base).toBe('65%/8k');
  });

  it('omits pace when ratio is undefined', () => {
    expect(buildStatusSegments(65, 8000, undefined, fmt).pace).toBeUndefined();
  });

  it('colors pace green at or below 0.95', () => {
    expect(buildStatusSegments(65, 8000, 0.95, fmt).pace).toEqual({
      text: ' 0.9×',
      color: 'success',
    });
    expect(buildStatusSegments(65, 8000, 0.8, fmt).pace).toEqual({
      text: ' 0.8×',
      color: 'success',
    });
  });

  it('colors pace yellow between 0.95 and 1.05', () => {
    expect(buildStatusSegments(65, 8000, 1.0, fmt).pace).toEqual({
      text: ' 1.0×',
      color: 'warning',
    });
    expect(buildStatusSegments(65, 8000, 1.05, fmt).pace).toEqual({
      text: ' 1.1×',
      color: 'warning',
    });
  });

  it('colors pace red above 1.05', () => {
    expect(buildStatusSegments(65, 8000, 1.3, fmt).pace).toEqual({
      text: ' 1.3×',
      color: 'error',
    });
  });
});
