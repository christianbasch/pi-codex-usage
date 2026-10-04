import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, saveConfig } from './config.ts';

vi.mock('node:fs');
vi.mock('@earendil-works/pi-coding-agent', () => ({
  getAgentDir: () => '/tmp/pi-agent',
}));

const defaults = { dayPolicy: 'calendar', displayMode: 'pace' };

describe('usage config', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(true);
  });

  it('defaults to calendar and pace when no config exists', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(loadConfig()).toEqual(defaults);
  });

  it('preserves the day policy in an older config without a display mode', () => {
    vi.mocked(readFileSync).mockReturnValue('{"dayPolicy":"weekdays"}');
    expect(loadConfig()).toEqual({
      dayPolicy: 'weekdays',
      displayMode: 'pace',
    });
  });

  it.each(['pace', 'pp', 'credits'] as const)(
    'loads the saved %s mode',
    (displayMode) => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ dayPolicy: 'weekdays', displayMode })
      );
      expect(loadConfig()).toEqual({ dayPolicy: 'weekdays', displayMode });
    }
  );

  it.each(['invalid', 1, null])(
    'defaults an invalid mode %s without losing the day policy',
    (displayMode) => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ dayPolicy: 'weekdays', displayMode })
      );
      expect(loadConfig()).toEqual({
        dayPolicy: 'weekdays',
        displayMode: 'pace',
      });
    }
  );

  it('defaults an invalid day policy without losing the display mode', () => {
    vi.mocked(readFileSync).mockReturnValue(
      '{"dayPolicy":"invalid","displayMode":"credits"}'
    );
    expect(loadConfig()).toEqual({
      dayPolicy: 'calendar',
      displayMode: 'credits',
    });
  });

  it('defaults when the file is malformed or unreadable', () => {
    vi.mocked(readFileSync).mockReturnValue('{');
    expect(loadConfig()).toEqual(defaults);
    vi.mocked(readFileSync).mockImplementationOnce(() => {
      throw new Error('unreadable');
    });
    expect(loadConfig()).toEqual(defaults);
  });

  it('round trips both settings in codex-usage.json', () => {
    const config = { dayPolicy: 'weekdays', displayMode: 'pp' } as const;
    saveConfig(config);
    expect(writeFileSync).toHaveBeenCalledWith(
      '/tmp/pi-agent/codex-usage.json',
      JSON.stringify(config, null, 2),
      'utf8'
    );
    vi.mocked(readFileSync).mockReturnValue(
      vi.mocked(writeFileSync).mock.calls[0]![1] as string
    );
    expect(loadConfig()).toEqual(config);
  });

  it('keeps persistence failures non-fatal', () => {
    vi.mocked(writeFileSync).mockImplementationOnce(() => {
      throw new Error('read only');
    });
    expect(() =>
      saveConfig({ dayPolicy: 'calendar', displayMode: 'pace' })
    ).not.toThrow();
  });
});
