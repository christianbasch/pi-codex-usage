import type { Theme } from '@earendil-works/pi-coding-agent';
import { visibleWidth } from '@earendil-works/pi-tui';

export function maxLength(values: readonly string[]): number {
  return Math.max(...values.map((value) => value.length));
}

export function wrapLegend(entries: string[], width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const entry of entries) {
    const candidate = current ? `${current}  ${entry}` : entry;
    if (current && visibleWidth(candidate) > width) {
      lines.push(current);
      current = entry;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

export function padLines(lines: string[], count: number): string[] {
  return [
    ...lines,
    ...Array.from({ length: Math.max(0, count - lines.length) }, () => ''),
  ];
}

export function controlLabel(
  theme: Theme,
  type: string,
  shortcut: string,
  state: string,
  stateWidth: number
): string {
  const muted = (text: string) => (text ? theme.fg('muted', text) : '');
  const shortcutIndex = type.indexOf(shortcut);
  const label =
    shortcutIndex < 0
      ? muted(type)
      : `${muted(type.slice(0, shortcutIndex))}${theme.bold(theme.fg('accent', shortcut))}${muted(type.slice(shortcutIndex + shortcut.length))}`;
  return `${label} ${state.padEnd(stateWidth)}`;
}
