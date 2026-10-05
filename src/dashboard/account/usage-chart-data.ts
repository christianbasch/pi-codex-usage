import type { BudgetDayPolicy } from '../../shared/day-policy.ts';
import {
  type AnalyticsResult,
  type GroupBy,
  sumModelCredits,
  type WorkspaceUserTokenUsage,
} from '../../shared/usage/analytics.ts';
import { getLastResetDate } from '../../shared/usage/period.ts';
import {
  addUtcDays,
  formatDate,
  startOfNextUtcMonth,
  startOfUtcDay,
  startOfUtcMonth,
  startOfUtcWeek,
} from '../../shared/utc-date.ts';
import {
  buildModelSegments,
  type ChartItem,
  type CreditChartRow,
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
  dayPolicy: BudgetDayPolicy;
  resetAt: number | undefined;
}

interface CumulativeValues {
  variance: number | null;
  budget: number;
  usage: number;
  limit: number;
}

const PERIOD_LENGTHS: Record<Exclude<ChartPeriod, 'current'>, number> = {
  days365: 365,
};

function formatChartDate(date: Date): string {
  return formatDate(date).slice(5);
}

function aggregateWeeklyRows(
  rows: WorkspaceUserTokenUsage[]
): CreditChartRow[] {
  const weeks = new Map<
    number,
    Map<string, CreditChartRow['models'][number]>
  >();
  for (const row of rows) {
    const week = startOfUtcWeek(row.date).getTime();
    const models = weeks.get(week) ?? new Map();
    for (const model of row.models) {
      const total = models.get(model.model);
      if (total) {
        total.credits += model.credits;
      } else {
        models.set(model.model, { model: model.model, credits: model.credits });
      }
    }
    weeks.set(week, models);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([date, models]) => ({
      date: new Date(date),
      models: [...models.values()],
    }));
}

function periodStartDate(
  analytics: AnalyticsResult,
  resetAt: number | undefined
): Date {
  if (analytics.lastResetDate !== undefined) return analytics.lastResetDate;
  if (resetAt !== undefined) return getLastResetDate(resetAt);
  return analytics.startDate;
}

function computeCumulativeValues(
  accountingRows: WorkspaceUserTokenUsage[],
  chartRows: CreditChartRow[],
  currentPeriodStart: Date,
  rangeStart: Date,
  rangeEnd: Date,
  options: ChartDataOptions
): Map<number, CumulativeValues> {
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

  const currentPeriodEnd = startOfUtcDay(new Date(options.resetAt * 1000));
  const firstPeriodStart = startOfUtcMonth(rangeStart);
  const chartPoints = chartRows.map((row) => {
    const bucketEnd = addUtcDays(row.date, 1);
    return {
      row,
      end: bucketEnd < currentPeriodEnd ? bucketEnd : currentPeriodEnd,
    };
  });
  const values = new Map<number, CumulativeValues>();
  let periodStart = firstPeriodStart;

  while (periodStart < currentPeriodEnd) {
    const periodEnd =
      periodStart < currentPeriodStart
        ? startOfNextUtcMonth(periodStart)
        : currentPeriodEnd;
    const periodIsIncomplete =
      periodStart.getTime() === firstPeriodStart.getTime() &&
      rangeStart > periodStart;
    const budgetPerDay = options.dayPolicy.budgetPerDay(
      options.monthlyLimit,
      periodStart,
      periodEnd
    );

    if (budgetPerDay !== undefined) {
      const periodPoints = chartPoints
        .filter(({ end }) => end > periodStart && end <= periodEnd)
        .sort((a, b) => a.end.getTime() - b.end.getTime());
      for (const { row, end } of periodPoints) {
        const cumulativeUsage = sumCreditsInDateRange(
          accountingRows,
          periodStart,
          end
        );
        const elapsedBudgetDays = options.dayPolicy.countDays(periodStart, end);
        const cumulativeBudget = budgetPerDay * elapsedBudgetDays;
        values.set(row.date.getTime(), {
          variance: periodIsIncomplete
            ? null
            : cumulativeUsage - cumulativeBudget,
          budget: cumulativeBudget,
          usage: cumulativeUsage,
          limit: options.monthlyLimit,
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
  chartRows: CreditChartRow[],
  currentPeriodStart: Date,
  rangeStart: Date,
  rangeEnd: Date,
  options: ChartDataOptions
): Map<number, CumulativeValues> {
  const currentPeriodEnd = startOfUtcDay(new Date(options.resetAt! * 1000));
  const firstPeriodStart = startOfUtcMonth(rangeStart);
  const availableEnd = addUtcDays(rangeEnd, 1);
  const values = new Map<number, CumulativeValues>();

  for (const row of chartRows) {
    const start = row.date < rangeStart ? rangeStart : row.date;
    let end = addUtcDays(row.date, 7);
    if (end > availableEnd) end = availableEnd;
    if (end > currentPeriodEnd) end = currentPeriodEnd;
    if (end <= start) continue;

    let segmentStart = start;
    let budget = 0;
    let usage = 0;
    let limit = 0;
    let incomplete = false;
    let valid = true;
    while (segmentStart < end) {
      const periodStart = startOfUtcMonth(segmentStart);
      const periodEnd =
        periodStart < currentPeriodStart
          ? startOfNextUtcMonth(periodStart)
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
      limit += options.monthlyLimit;
      incomplete ||=
        rangeStart > firstPeriodStart &&
        periodStart.getTime() === firstPeriodStart.getTime();
      segmentStart = segmentEnd;
    }
    if (!valid) continue;

    values.set(row.date.getTime(), {
      variance: incomplete ? null : usage - budget,
      budget,
      usage,
      limit,
    });
  }

  return values;
}

function getPeriodCumulativeValues(
  accountingRows: WorkspaceUserTokenUsage[],
  periodStart: Date,
  end: Date,
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  options: ChartDataOptions
): { budget: number; usage: number } | undefined {
  let budget = 0;
  for (let date = periodStart; date < end; date = addUtcDays(date, 1)) {
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
  date: Date,
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  options: ChartDataOptions
): number | undefined {
  const periodStart = startOfUtcMonth(date);
  const periodEnd =
    periodStart < currentPeriodStart
      ? startOfNextUtcMonth(periodStart)
      : currentPeriodEnd;
  if (date >= periodEnd) return undefined;
  const budgetPerDay = options.dayPolicy.budgetPerDay(
    options.monthlyLimit,
    periodStart,
    periodEnd
  );
  if (budgetPerDay === undefined) return undefined;
  const budgetDays = options.dayPolicy.isBudgetDay(date) ? 1 : 0;
  return budgetPerDay * budgetDays;
}

/**
 * Builds Account chart items for the selected period, grouping, and view.
 * Weekly rows use daily analytics when available so cumulative values can be
 * calculated from individual days; without daily data, weekly totals remain
 * visible but cumulative columns are omitted. Returns [] when no analytics
 * are available for the selected grouping or its daily fallback.
 */
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
      : addUtcDays(analytics.endDate, 1 - PERIOD_LENGTHS[options.period]);
  const cumulativeValues =
    options.groupBy === 'week' && dailyRows === undefined
      ? new Map<number, CumulativeValues>()
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
    const cumulative = cumulativeValues.get(row.date.getTime());
    return {
      label: formatChartDate(row.date),
      value: sumModelCredits(row.models),
      isWeekend:
        options.groupBy === 'day' && !options.dayPolicy.isBudgetDay(row.date),
      cumulativeVariance: cumulative?.variance,
      cumulativeBudget: cumulative?.budget,
      cumulativeUsage: cumulative?.usage,
      cumulativeLimit: cumulative?.limit,
    };
  });
  if (options.view === 'usage') return chartItems;

  const topModels = computeTopModels(visibleRows, MODEL_COLORS.length);
  return chartItems.map((item, index) => ({
    ...item,
    models: buildModelSegments(visibleRows[index]!, topModels),
  }));
}

/**
 * Sums credits across all models in rows dated within [startDate, endDate).
 * Dates are UTC-normalized; an empty range contributes zero.
 */
export function sumCreditsInDateRange(
  rows: readonly WorkspaceUserTokenUsage[],
  startDate: Date,
  endDate: Date
): number {
  return rows
    .filter((row) => row.date >= startDate && row.date < endDate)
    .reduce((total, row) => total + sumModelCredits(row.models), 0);
}
