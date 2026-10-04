import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { DayPolicy } from './day-policy.ts';

export type UsageDisplayMode = 'pace' | 'pp' | 'credits';

export interface CodexUsageConfig {
  dayPolicy: DayPolicy;
  displayMode: UsageDisplayMode;
}

const DEFAULT_CONFIG: CodexUsageConfig = {
  dayPolicy: 'calendar',
  displayMode: 'credits',
};

function configFilePath(): string {
  return join(getAgentDir(), 'codex-usage.json');
}

export function loadConfig(): CodexUsageConfig {
  try {
    if (!existsSync(configFilePath())) return { ...DEFAULT_CONFIG };
    const raw = JSON.parse(readFileSync(configFilePath(), 'utf8')) as {
      dayPolicy?: unknown;
      displayMode?: unknown;
    };
    return {
      dayPolicy: raw.dayPolicy === 'weekdays' ? 'weekdays' : 'calendar',
      displayMode:
        raw.displayMode === 'pace' || raw.displayMode === 'pp'
          ? raw.displayMode
          : 'credits',
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: CodexUsageConfig): void {
  try {
    writeFileSync(configFilePath(), JSON.stringify(config, null, 2), 'utf8');
  } catch {
    // Keep the in-memory setting when persistence is unavailable.
  }
}
