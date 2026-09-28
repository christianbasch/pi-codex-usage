import type { DayPolicy } from '../../shared/config.ts';
import {
  type AnalyticsResult,
  daysUntilResetForPolicy,
  type GroupBy,
  getLastResetDate,
  getPeriodBudgetPerDay,
  sumModelCredits,
  type WorkspaceUserModelUsage,
  type WorkspaceUserTokenUsage,
} from '../../shared/usage/analytics.ts';
import {
  buildModelSegments,
  type ChartItem,
  computeTopModels,
  MODEL_COLORS,
} from './usage-chart.ts';

export type ChartPeriod = 'current' | 'days365';
export type ChartView = 'usage' | 'models';

interface ChartDataOptions {
  analyticsByGroup: Partial<Record<GroupBy, AnalyticsResult | undefined>>;
  groupBy: GroupBy;
  period: ChartPeriod;
  view: ChartView;
  monthlyLimit: number;
  dayPolicy: DayPolicy;
  resetAt: number | undefined;
}

interface CumulativeValues {
  variance: number | null;
  budget: number;
  usage: number;
}

const PERIOD_LENGTHS: Record<Exclude<ChartPeriod, 'current'>, number> = {
  days365: 365,
};

function formatChartDate(date: string): string {
  return date.slice(5);
}

function isWeekendDate(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function daysBefore(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() - days);
  return result.toISOString().slice(0, 10);
}

function daysAfter(date: string, days: number): string {
  return daysBefore(date, -days);
}

function startOfWeek(date: string): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() - result.getUTCDay());
  return result.toISOString().slice(0, 10);
}

function aggregateWeeklyRows(
  rows: WorkspaceUserTokenUsage[]
): WorkspaceUserTokenUsage[] {
  const weeks = new Map<string, Map<string, WorkspaceUserModelUsage>>();
  for (const row of rows) {
    const week = startOfWeek(row.date);
    const models = weeks.get(week) ?? new Map();
    for (const model of row.models) {
      const total = models.get(model.model);
      if (total) {
        total.credits += model.credits;
        total.uncached_text_input_tokens += model.uncached_text_input_tokens;
        total.cached_text_input_tokens += model.cached_text_input_tokens;
        total.text_output_tokens += model.text_output_tokens;
      } else {
        models.set(model.model, { ...model });
      }
    }
    weeks.set(week, models);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, models]) => ({
      date,
      models: [...models.values()],
    }));
}

function firstDayOfMonth(date: string): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(1);
  return result.toISOString().slice(0, 10);
}

function firstDayOfNextMonth(date: string): string {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  return result.toISOString().slice(0, 10);
}

function periodStartDate(
  analytics: AnalyticsResult,
  resetAt: number | undefined
): string {
  if (analytics.lastResetDate !== undefined) return analytics.lastResetDate;
  if (resetAt !== undefined) return getLastResetDate(resetAt);
  return analytics.startDate;
}

function computeCumulativeValues(
  accountingRows: WorkspaceUserTokenUsage[],
  chartRows: WorkspaceUserTokenUsage[],
  currentPeriodStart: string,
  rangeStart: string,
  rangeEnd: string,
  options: ChartDataOptions
): Map<string, CumulativeValues> {
  if (options.resetAt === undefined) return new Map();
  if (options.groupBy === 'week') {
    return computeWeeklyValues(
      accountingRows,
      chartRows,
      currentPeriodStart,
      rangeStart,
      rangeEnd,
      options
    );
  }

  const currentPeriodEnd = new Date(options.resetAt * 1000)
    .toISOString()
    .slice(0, 10);
  const firstPeriodStart = firstDayOfMonth(rangeStart);
  const chartPoints = chartRows.map((row) => {
    const bucketEnd = daysAfter(row.date, 1);
    return {
      row,
      end: bucketEnd < currentPeriodEnd ? bucketEnd : currentPeriodEnd,
    };
  });
  const values = new Map<string, CumulativeValues>();
  let periodStart = firstPeriodStart;

  while (periodStart < currentPeriodEnd) {
    const periodEnd =
      periodStart < currentPeriodStart
        ? firstDayOfNextMonth(periodStart)
        : currentPeriodEnd;
    const periodIsIncomplete =
      periodStart === firstPeriodStart && rangeStart > periodStart;
    const resetAt = Date.parse(`${periodEnd}T00:00:00Z`) / 1000;
    const budgetPerDay = getPeriodBudgetPerDay(
      options.monthlyLimit,
      periodStart,
      periodEnd,
      options.dayPolicy
    );

    if (budgetPerDay !== undefined) {
      const periodDays = daysUntilResetForPolicy(
        periodStart,
        resetAt,
        options.dayPolicy
      );
      const periodPoints = chartPoints
        .filter(({ end }) => end > periodStart && end <= periodEnd)
        .sort((a, b) => a.end.localeCompare(b.end));
      for (const { row, end } of periodPoints) {
        const cumulativeUsage = sumCreditsInDateRange(
          accountingRows,
          periodStart,
          end
        );
        const elapsedBudgetDays =
          periodDays - daysUntilResetForPolicy(end, resetAt, options.dayPolicy);
        const cumulativeBudget = budgetPerDay * elapsedBudgetDays;
        values.set(row.date, {
          variance: periodIsIncomplete
            ? null
            : cumulativeUsage - cumulativeBudget,
          budget: cumulativeBudget,
          usage: cumulativeUsage,
        });
      }
    }

    if (periodEnd <= periodStart) break;
    periodStart = periodEnd;
  }

  return values;
}

function computeWeeklyValues(
  accountingRows: WorkspaceUserTokenUsage[],
  chartRows: WorkspaceUserTokenUsage[],
  currentPeriodStart: string,
  rangeStart: string,
  rangeEnd: string,
  options: ChartDataOptions
): Map<string, CumulativeValues> {
  const currentPeriodEnd = new Date(options.resetAt! * 1000)
    .toISOString()
    .slice(0, 10);
  const firstPeriodStart = firstDayOfMonth(rangeStart);
  const availableEnd = daysAfter(rangeEnd, 1);
  const values = new Map<string, CumulativeValues>();

  for (const row of chartRows) {
    const start = row.date < rangeStart ? rangeStart : row.date;
    let end = daysAfter(row.date, 7);
    if (end > availableEnd) end = availableEnd;
    if (end > currentPeriodEnd) end = currentPeriodEnd;
    if (end <= start) continue;

    let segmentStart = start;
    let budget = 0;
    let usage = 0;
    let incomplete = false;
    let valid = true;
    while (segmentStart < end) {
      const periodStart = firstDayOfMonth(segmentStart);
      const periodEnd =
        periodStart < currentPeriodStart
          ? firstDayOfNextMonth(periodStart)
          : currentPeriodEnd;
      const segmentEnd = end < periodEnd ? end : periodEnd;
      if (segmentEnd <= segmentStart) {
        valid = false;
        break;
      }
      const periodValues = getPeriodCumulativeValues(
        accountingRows,
        periodStart,
        segmentEnd,
        currentPeriodStart,
        currentPeriodEnd,
        options
      );
      if (periodValues === undefined) {
        valid = false;
        break;
      }
      budget += periodValues.budget;
      usage += periodValues.usage;
      incomplete ||=
        rangeStart > firstPeriodStart && periodStart === firstPeriodStart;
      segmentStart = segmentEnd;
    }
    if (!valid) continue;

    values.set(row.date, {
      variance: incomplete ? null : usage - budget,
      budget,
      usage,
    });
  }

  return values;
}

function getPeriodCumulativeValues(
  accountingRows: WorkspaceUserTokenUsage[],
  periodStart: string,
  end: string,
  currentPeriodStart: string,
  currentPeriodEnd: string,
  options: ChartDataOptions
): { budget: number; usage: number } | undefined {
  let budget = 0;
  for (let date = periodStart; date < end; date = daysAfter(date, 1)) {
    const dailyBudget = getDailyBudgetForDate(
      date,
      currentPeriodStart,
      currentPeriodEnd,
      options
    );
    if (dailyBudget === undefined) return undefined;
    budget += dailyBudget;
  }
  const usage = sumCreditsInDateRange(accountingRows, periodStart, end);
  return { budget, usage };
}

function getDailyBudgetForDate(
  date: string,
  currentPeriodStart: string,
  currentPeriodEnd: string,
  options: ChartDataOptions
): number | undefined {
  const periodStart = firstDayOfMonth(date);
  const periodEnd =
    periodStart < currentPeriodStart
      ? firstDayOfNextMonth(periodStart)
      : currentPeriodEnd;
  if (date >= periodEnd) return undefined;
  const resetAt = Date.parse(`${periodEnd}T00:00:00Z`) / 1000;
  const budgetPerDay = getPeriodBudgetPerDay(
    options.monthlyLimit,
    periodStart,
    periodEnd,
    options.dayPolicy
  );
  if (budgetPerDay === undefined) return undefined;
  const budgetDays =
    daysUntilResetForPolicy(date, resetAt, options.dayPolicy) -
    daysUntilResetForPolicy(daysAfter(date, 1), resetAt, options.dayPolicy);
  return budgetPerDay * budgetDays;
}

export function buildChartData(options: ChartDataOptions): ChartItem[] {
  const analytics =
    options.analyticsByGroup[options.groupBy] ??
    (options.groupBy === 'week' ? options.analyticsByGroup.day : undefined);
  if (!analytics) return [];

  const dailyAnalytics = options.analyticsByGroup.day;
  const dailyRows =
    options.groupBy === 'week' &&
    dailyAnalytics !== undefined &&
    dailyAnalytics.startDate <= analytics.startDate &&
    dailyAnalytics.endDate >= analytics.endDate
      ? dailyAnalytics.breakdown.workspaceUser.filter(
          (row) =>
            row.date >= analytics.startDate && row.date <= analytics.endDate
        )
      : undefined;
  const accountingRows = dailyRows ?? analytics.breakdown.workspaceUser;
  const rows = dailyRows
    ? aggregateWeeklyRows(dailyRows)
    : analytics.breakdown.workspaceUser;
  const currentPeriodStart = periodStartDate(analytics, options.resetAt);
  const periodStart =
    options.period === 'current'
      ? currentPeriodStart
      : daysBefore(analytics.endDate, PERIOD_LENGTHS[options.period] - 1);
  const cumulativeValues =
    options.groupBy === 'week' && dailyRows === undefined
      ? new Map<string, CumulativeValues>()
      : computeCumulativeValues(
          accountingRows,
          rows,
          currentPeriodStart,
          analytics.startDate,
          analytics.endDate,
          options
        );

  const visibleRows = rows.filter((row) => row.date >= periodStart);
  const chartItems = visibleRows.map((row) => {
    const cumulative = cumulativeValues.get(row.date);
    return {
      label: formatChartDate(row.date),
      value: sumModelCredits(row.models),
      isWeekend:
        options.dayPolicy === 'weekdays' &&
        options.groupBy === 'day' &&
        isWeekendDate(row.date),
      cumulativeVariance: cumulative?.variance,
      cumulativeBudget: cumulative?.budget,
      cumulativeUsage: cumulative?.usage,
    };
  });
  if (options.view === 'usage') return chartItems;

  const topModels = computeTopModels(visibleRows, MODEL_COLORS.length);
  return chartItems.map((item, index) => ({
    ...item,
    models: buildModelSegments(visibleRows[index]!, topModels),
  }));
}

export function sumCreditsInDateRange(
  rows: readonly WorkspaceUserTokenUsage[],
  startDate: string,
  endDate: string
): number {
  return rows
    .filter((row) => row.date >= startDate && row.date < endDate)
    .reduce((total, row) => total + sumModelCredits(row.models), 0);
}
