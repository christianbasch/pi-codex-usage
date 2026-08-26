import { describe, expect, it, vi } from 'vitest';
import { Spinner } from './spinner.ts';

describe('Spinner', () => {
  it('advances on its interval and stops cleanly', () => {
    vi.useFakeTimers();
    const onTick = vi.fn();
    const spinner = new Spinner(onTick);

    try {
      expect(spinner.current).toBe('⠋');
      spinner.start();
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
    const onTick = vi.fn();
    const spinner = new Spinner(onTick);

    try {
      spinner.start();
      spinner.start();
      vi.advanceTimersByTime(80);
      expect(onTick).toHaveBeenCalledTimes(1);

      spinner.reset();
      expect(spinner.current).toBe('⠋');
    } finally {
      spinner.stop();
      vi.useRealTimers();
    }
  });
});
