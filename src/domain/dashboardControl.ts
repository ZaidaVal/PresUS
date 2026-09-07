import { personMonthlyEquivalentCents } from './budget';
import { assertCents, type Cents } from './money';
import {
  buildMonthlySpendReport,
  shiftUtcMonth,
  utcYearMonthFromDate,
  type MonthlySpendInput,
  type MonthlySpendReport,
  type UtcYearMonth,
} from './monthlySpend';
import { isAtlantidaAccount } from './segments';
import type { AccountBalance, BudgetItem, CardCharge, SafeAvailable, TransactionRow } from './types';

export type MonthSpendCompare = {
  current: MonthlySpendReport;
  previous: MonthlySpendReport;
  spentDeltaCents: Cents;
};

export function monthSpendCompare(input: MonthlySpendInput): MonthSpendCompare {
  const currentYm = input.yearMonth ?? utcYearMonthFromDate(input.now ?? new Date());
  const previousYm = shiftUtcMonth(currentYm, -1);
  const current = buildMonthlySpendReport({ ...input, yearMonth: currentYm });
  const previous = buildMonthlySpendReport({ ...input, yearMonth: previousYm });
  return {
    current,
    previous,
    spentDeltaCents: current.totalSpentCents - previous.totalSpentCents,
  };
}

/** Presupuesto HOME desglosado Z vs A (equivalente mensual). */
export function homeZaBudgetedCents(items: BudgetItem[]): { zCents: Cents; aCents: Cents } {
  let zCents: Cents = 0;
  let aCents: Cents = 0;
  for (const item of items) {
    if (item.budgetScope !== 'HOME') continue;
    zCents += personMonthlyEquivalentCents(item, 'Z');
    aCents += personMonthlyEquivalentCents(item, 'A');
  }
  assertCents(zCents);
  assertCents(aCents);
  return { zCents, aCents };
}

export function lastUtcMonths(now: Date, count: number): UtcYearMonth[] {
  const start = utcYearMonthFromDate(now);
  const months: UtcYearMonth[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    months.push(shiftUtcMonth(start, -offset));
  }
  return months;
}

export type ReservaMonthPoint = {
  yearMonth: UtcYearMonth;
  pendingCents: Cents;
};

/** Cargos ONE aún no transferidos a Atlántida, agrupados por mes del movimiento. */
export function pendingReservaByMonth(
  transactions: TransactionRow[],
  charges: CardCharge[],
  now: Date,
  monthCount = 4,
): ReservaMonthPoint[] {
  const months = lastUtcMonths(now, monthCount);
  const byKey = new Map<string, Cents>();
  for (const month of months) {
    byKey.set(`${month.year}-${month.month}`, 0);
  }
  const txById = new Map(transactions.map((row) => [row.id, row]));
  for (const charge of charges) {
    if (charge.coverageStatus === 'TRANSFERIDO_A_ATLANTIDA') continue;
    const row = txById.get(charge.transactionId);
    if (!row || row.status !== 'POSTED') continue;
    assertCents(charge.amountCents);
    const occurred = new Date(row.occurredAt);
    if (Number.isNaN(occurred.getTime())) continue;
    const key = `${occurred.getUTCFullYear()}-${occurred.getUTCMonth()}`;
    if (!byKey.has(key)) continue;
    byKey.set(key, (byKey.get(key) ?? 0) + charge.amountCents);
  }
  return months.map((yearMonth) => ({
    yearMonth,
    pendingCents: byKey.get(`${yearMonth.year}-${yearMonth.month}`) ?? 0,
  }));
}

export type OneAtlantidaCompare = {
  oneOwedCents: Cents;
  oneCupoLeftCents: Cents;
  atlantidaApartadoCents: Cents;
};

export function oneVsAtlantidaCents(
  safe: Pick<SafeAvailable, 'limitedCardRemainingCents'>,
  balances: AccountBalance[],
  oneOwedCents: Cents,
): OneAtlantidaCompare {
  assertCents(oneOwedCents);
  const atlantida = balances.find((row) => isAtlantidaAccount(row.account));
  const atlantidaApartadoCents = atlantida?.reservedCents ?? 0;
  assertCents(atlantidaApartadoCents);
  assertCents(safe.limitedCardRemainingCents);
  return {
    oneOwedCents,
    oneCupoLeftCents: safe.limitedCardRemainingCents,
    atlantidaApartadoCents,
  };
}
