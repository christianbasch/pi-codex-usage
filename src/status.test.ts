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

  it('keeps usage muted below 80%', () => {
    expect(buildStatusSegments(79, 8000, undefined, fmt).baseColor).toBe(
      'muted'
    );
  });

  it('colors usage warning from 80% to below 90%', () => {
    expect(buildStatusSegments(80, 8000, undefined, fmt).baseColor).toBe(
      'warning'
    );
    expect(buildStatusSegments(89.99, 8000, undefined, fmt).baseColor).toBe(
      'warning'
    );
  });

  it('colors usage error at or above 90%', () => {
    expect(buildStatusSegments(90, 8000, undefined, fmt).baseColor).toBe(
      'error'
    );
  });

  it('colors pace green at or below 0.95', () => {
    expect(buildStatusSegments(65, 8000, 0.95, fmt).pace).toEqual({
      text: ' 0.95×',
      color: 'success',
    });
    expect(buildStatusSegments(65, 8000, 0.8, fmt).pace).toEqual({
      text: ' 0.80×',
      color: 'success',
    });
  });

  it('colors pace yellow between 0.95 and 1.05', () => {
    expect(buildStatusSegments(65, 8000, 1.0, fmt).pace).toEqual({
      text: ' 1.00×',
      color: 'warning',
    });
    expect(buildStatusSegments(65, 8000, 1.05, fmt).pace).toEqual({
      text: ' 1.05×',
      color: 'warning',
    });
  });

  it('colors pace red above 1.05', () => {
    expect(buildStatusSegments(65, 8000, 1.3, fmt).pace).toEqual({
      text: ' 1.30×',
      color: 'error',
    });
  });
});
