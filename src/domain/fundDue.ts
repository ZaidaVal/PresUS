import { isBudgetedOperatingFund } from './segments';
import type { Fund, FundDueAnchor } from './types';

export const FUND_DUE_WINDOW_DAYS = 3;

const ANCHORS = new Set<FundDueAnchor>(['MONTH_START', 'MONTH_MID', 'MONTH_END']);

export function normalizeFundDueAnchor(value: unknown): FundDueAnchor | null {
  if (value === 'MONTH_START' || value === 'MONTH_MID' || value === 'MONTH_END') return value;
  if (typeof value === 'string' && ANCHORS.has(value as FundDueAnchor)) return value as FundDueAnchor;
  return null;
}

export function fundDueAnchorLabel(anchor: FundDueAnchor | null | undefined): string {
  if (anchor === 'MONTH_START') return 'Inicio de mes (1)';
  if (anchor === 'MONTH_MID') return 'Mediados (14)';
  if (anchor === 'MONTH_END') return 'Fin de mes (28–31)';
  return 'Sin fecha';
}

function utcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Último día calendario UTC del mes (28, 29, 30 o 31). */
export function lastUtcDayOfMonth(year: number, month0: number): number {
  return new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
}

export function dueDateInUtcMonth(anchor: FundDueAnchor, year: number, month0: number): Date {
  if (anchor === 'MONTH_START') return new Date(Date.UTC(year, month0, 1));
  if (anchor === 'MONTH_MID') return new Date(Date.UTC(year, month0, 14));
  return new Date(Date.UTC(year, month0, lastUtcDayOfMonth(year, month0)));
}

/** Próxima fecha de pago: este mes si no pasó; si no, el inmediato. */
export function nextFundDueDate(anchor: FundDueAnchor | null | undefined, now: Date): Date | null {
  const dueAnchor = normalizeFundDueAnchor(anchor);
  if (!dueAnchor) return null;
  const today = utcDateOnly(now);
  const year = today.getUTCFullYear();
  const month = today.getUTCMonth();
  const thisMonth = dueDateInUtcMonth(dueAnchor, year, month);
  if (thisMonth.getTime() >= today.getTime()) return thisMonth;
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;
  return dueDateInUtcMonth(dueAnchor, nextYear, nextMonth);
}

export function daysUntilFundDue(anchor: FundDueAnchor | null | undefined, now: Date): number | null {
  const due = nextFundDueDate(anchor, now);
  if (!due) return null;
  const today = utcDateOnly(now);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
}

/** Prioridad en Inicio: vence hoy o en ≤ 3 días. Sin fecha = no. */
export function isFundDuePriority(
  anchor: FundDueAnchor | null | undefined,
  now: Date,
  windowDays = FUND_DUE_WINDOW_DAYS,
): boolean {
  const days = daysUntilFundDue(anchor, now);
  return days != null && days >= 0 && days <= windowDays;
}

export type PriorityFundRow = {
  fund: Fund;
  reservedCents: number;
  dueAt: Date;
  daysUntil: number;
};

export function priorityFundsDueSoon(
  funds: Array<{ fund: Fund; reservedCents?: number }>,
  now: Date,
  windowDays = FUND_DUE_WINDOW_DAYS,
): PriorityFundRow[] {
  const rows: PriorityFundRow[] = [];
  for (const item of funds) {
    if (isBudgetedOperatingFund(item.fund)) continue;
    const dueAt = nextFundDueDate(item.fund.dueAnchor, now);
    const daysUntil = daysUntilFundDue(item.fund.dueAnchor, now);
    if (!dueAt || daysUntil == null || !isFundDuePriority(item.fund.dueAnchor, now, windowDays)) continue;
    rows.push({
      fund: item.fund,
      reservedCents: item.reservedCents ?? 0,
      dueAt,
      daysUntil,
    });
  }
  return rows.sort((left, right) => {
    const byDays = left.daysUntil - right.daysUntil;
    if (byDays !== 0) return byDays;
    return left.fund.name.localeCompare(right.fund.name, 'es');
  });
}

export function formatFundDueDate(date: Date): string {
  return date.toLocaleDateString('es', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
