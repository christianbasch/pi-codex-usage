import { describe, expect, it } from 'vitest';
import { buildStatusSegments } from './status.ts';

const fmt = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 2)}k` : String(v);

describe('buildStatusSegments', () => {
  it('formats base as pct/limit', () => {
    expect(buildStatusSegments(65, 8000, undefined, fmt).base).toBe('65%/8k');
  });

  it('omits paceOver when ratio is undefined', () => {
    expect(
      buildStatusSegments(65, 8000, undefined, fmt).paceOver
    ).toBeUndefined();
  });

  it('omits paceOver when ratio is at or below 1', () => {
    expect(buildStatusSegments(65, 8000, 1.0, fmt).paceOver).toBeUndefined();
    expect(buildStatusSegments(65, 8000, 0.8, fmt).paceOver).toBeUndefined();
  });

  it('returns paceOver with formatted ratio when overusing', () => {
    expect(buildStatusSegments(65, 8000, 1.3, fmt).paceOver).toBe(' 1.3×');
  });
});
