import { describe, expect, it, vi } from 'vitest';
import { Spinner } from './spinner.ts';

describe('Spinner', () => {
  it('advances on its interval and stops cleanly', () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const spinner = new Spinner();

    try {
      expect(spinner.current).toBe('⠋');
      spinner.start(onTick);
      vi.advanceTimersByTime(80);

      expect(spinner.current).toBe('⠙');
      expect(onTick).toHaveBeenCalledTimes(1);

      spinner.stop();
      vi.advanceTimersByTime(80);
      expect(spinner.current).toBe('⠙');
      expect(onTick).toHaveBeenCalledTimes(1);
    } finally {
      spinner.stop();
      vi.useRealTimers();
    }
  });

  it('does not start multiple intervals and can reset its frame', () => {
    vi.useFakeTimers();
    const firstOnTick = vi.fn();
    const secondOnTick = vi.fn();
    const spinner = new Spinner();

    try {
      spinner.start(firstOnTick);
      spinner.start(secondOnTick);
      vi.advanceTimersByTime(80);
      expect(firstOnTick).not.toHaveBeenCalled();
      expect(secondOnTick).toHaveBeenCalledTimes(1);

      spinner.reset();
      expect(spinner.current).toBe('⠋');
    } finally {
      spinner.stop();
      vi.useRealTimers();
    }
  });
});
