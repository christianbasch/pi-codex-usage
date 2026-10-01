export function startOfUtcDay(date: Date): Date {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export function addUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function startOfUtcWeek(date: Date): Date {
  const start = startOfUtcDay(date);
  return addUtcDays(start, -start.getUTCDay());
}

export function startOfUtcMonth(date: Date): Date {
  const start = startOfUtcDay(date);
  start.setUTCDate(1);
  return start;
}

export function startOfNextUtcMonth(date: Date): Date {
  const start = startOfUtcMonth(date);
  start.setUTCMonth(start.getUTCMonth() + 1);
  return start;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
