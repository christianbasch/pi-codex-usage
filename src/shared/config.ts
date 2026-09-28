import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '@earendil-works/pi-coding-agent';

export type DayPolicy = 'calendar' | 'weekdays';

export interface CodexUsageConfig {
  dayPolicy: DayPolicy;
}

const DEFAULT_CONFIG: CodexUsageConfig = { dayPolicy: 'calendar' };

function configFilePath(): string {
  return join(getAgentDir(), 'codex-usage.json');
}

export function loadConfig(): CodexUsageConfig {
  try {
    if (!existsSync(configFilePath())) return { ...DEFAULT_CONFIG };
    const raw = JSON.parse(readFileSync(configFilePath(), 'utf8')) as {
      dayPolicy?: unknown;
    };
    return {
      dayPolicy: raw.dayPolicy === 'weekdays' ? 'weekdays' : 'calendar',
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

export function dayPolicyLabel(policy: DayPolicy): string {
  return policy === 'weekdays' ? 'weekdays' : 'calendar days';
}
