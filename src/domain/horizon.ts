import { DomainError } from './ledger';
import { isSavingsBudgetItem } from './segments';
import type { BudgetItem, Frequency, Fund, FundBalance, TransactionRow } from './types';

/** Horizonte operativo de un gasto: 3 meses. Lo que lo excede no sigue en el presupuesto ni en Hoy. */
export const EXPENSE_HORIZON_MONTHS = 3;

const FREQUENCY_MONTHS: Record<Frequency, number> = {
  QUINCENAL: 1,
  MENSUAL: 1,
  BIMESTRAL: 2,
  TRIMESTRAL: 3,
  ANUAL: 12,
  UNICO: 0,
};

export const OPERATING_EXPENSE_FREQUENCIES: Frequency[] = [
  'QUINCENAL',
  'MENSUAL',
  'BIMESTRAL',
  'TRIMESTRAL',
  'UNICO',
];

export function frequencyMonths(frequency: Frequency): number {
  return FREQUENCY_MONTHS[frequency];
}

export function frequencyExceedsExpenseHorizon(frequency: Frequency): boolean {
  return frequencyMonths(frequency) > EXPENSE_HORIZON_MONTHS;
}

export function addUtcMonths(date: Date, months: number): Date {
  const copy = new Date(date.getTime());
  const day = copy.getUTCDate();
  copy.setUTCDate(1);
  copy.setUTCMonth(copy.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(copy.getUTCFullYear(), copy.getUTCMonth() + 1, 0)).getUTCDate();
  copy.setUTCDate(Math.min(day, lastDay));
  return copy;
}

function utcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function isWithinExpenseHorizon(occurredAt: string, now = new Date()): boolean {
  const occurred = new Date(occurredAt);
  if (Number.isNaN(occurred.getTime())) return false;
  const cutoff = addUtcMonths(now, -EXPENSE_HORIZON_MONTHS);
  return utcDay(occurred) >= utcDay(cutoff);
}

export function isOperatingExpenseBeyondHorizon(
  item: Pick<BudgetItem, 'frequency' | 'category' | 'coverFundId'>,
  funds: Array<Fund | FundBalance>,
): boolean {
  if (!frequencyExceedsExpenseHorizon(item.frequency)) return false;
  return !isSavingsBudgetItem(item as BudgetItem, funds);
}

export function assertOperatingBudgetFrequency(
  item: Pick<BudgetItem, 'frequency' | 'category' | 'coverFundId'>,
  funds: Array<Fund | FundBalance>,
): void {
  if (isOperatingExpenseBeyondHorizon(item, funds)) {
    throw new DomainError(
      'Un gasto no puede superar 3 meses. Lo anual no entra en el presupuesto operativo',
    );
  }
}

export function visiblePostedMovements(
  rows: TransactionRow[],
  now = new Date(),
): TransactionRow[] {
  return rows.filter((row) => {
    if (row.status !== 'POSTED') return false;
    if (row.type === 'GASTO' && !isWithinExpenseHorizon(row.occurredAt, now)) return false;
    return true;
  });
}

/** Historial visible: POSTED y anulados originales. Oculta la inversa de una anulación. */
export function visibleHistoryMovements(
  rows: TransactionRow[],
  now = new Date(),
): TransactionRow[] {
  return rows
    .filter((row) => {
      if (row.reversesId) return false;
      if (row.status !== 'POSTED') return false;
      if (row.type === 'GASTO' && !isWithinExpenseHorizon(row.occurredAt, now)) return false;
      return true;
    })
    .sort((left, right) => {
      const byDate = right.occurredAt.localeCompare(left.occurredAt);
      if (byDate !== 0) return byDate;
      return right.createdAt.localeCompare(left.createdAt);
    });
}
