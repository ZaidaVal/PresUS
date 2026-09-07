import { completeBudgetShares, monthlyEquivalentCents, personMonthlyEquivalentCents } from './budget';
import { assertCents, type Cents } from './money';
import type {
  BudgetItem,
  BudgetScope,
  CardCharge,
  Fund,
  SplitRow,
  TransactionRow,
} from './types';

export const UNASSIGNED_AREA = 'Sin área';

/** Mes calendario UTC: `month` es 0–11, igual que `Date.getUTCMonth()`. */
export type UtcYearMonth = { year: number; month: number };

export type AreaSpendRow = {
  area: string;
  spentCents: Cents;
  budgetedMonthlyCents: Cents;
};

export type ScopeSpendRow = {
  scope: BudgetScope;
  spentCents: Cents;
  budgetedMonthlyCents: Cents;
  /** Suma de montos por quincena (partidas QUINCENAL activas). No se duplica al mensual. */
  quincenalCents: Cents;
  /** Suma de montos por mes (partidas MENSUAL activas). */
  mensualCents: Cents;
};

export type MonthlySpendReport = {
  yearMonth: UtcYearMonth;
  areas: AreaSpendRow[];
  home: ScopeSpendRow;
  personZ: ScopeSpendRow;
  personA: ScopeSpendRow;
  totalSpentCents: Cents;
  totalBudgetedMonthlyCents: Cents;
};

export type MonthlySpendInput = {
  items: BudgetItem[];
  funds: Array<Pick<Fund, 'id' | 'name'>>;
  transactions: TransactionRow[];
  splitsByTx: Map<string, SplitRow[]>;
  cardCharges?: CardCharge[];
  now?: Date;
  yearMonth?: UtcYearMonth;
};

export function utcYearMonthFromDate(date: Date): UtcYearMonth {
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

export function shiftUtcMonth(yearMonth: UtcYearMonth, delta: number): UtcYearMonth {
  const shifted = new Date(Date.UTC(yearMonth.year, yearMonth.month + delta, 1));
  return utcYearMonthFromDate(shifted);
}

export function isInUtcMonth(iso: string, yearMonth: UtcYearMonth): boolean {
  const occurred = new Date(iso);
  if (Number.isNaN(occurred.getTime())) return false;
  return occurred.getUTCFullYear() === yearMonth.year && occurred.getUTCMonth() === yearMonth.month;
}

export function utcMonthBoundsIso(yearMonth: UtcYearMonth): { fromOccurredAt: string; toOccurredAt: string } {
  return {
    fromOccurredAt: new Date(Date.UTC(yearMonth.year, yearMonth.month, 1, 0, 0, 0, 0)).toISOString(),
    toOccurredAt: new Date(Date.UTC(yearMonth.year, yearMonth.month + 1, 0, 23, 59, 59, 999)).toISOString(),
  };
}

export function utcMonthLabel(yearMonth: UtcYearMonth): string {
  return new Date(Date.UTC(yearMonth.year, yearMonth.month, 1)).toLocaleDateString('es', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function itemMonthlyEquivalentCents(item: BudgetItem): Cents {
  return monthlyEquivalentCents(item.frequency, item.amountCents, item.active);
}

export function gastoAmountCents(splits: SplitRow[]): Cents {
  const equity = splits.find((split) => split.role === 'EQUITY');
  if (equity) {
    assertCents(equity.amountCents);
    return Math.abs(equity.amountCents);
  }
  const source = splits.find((split) => split.role === 'SOURCE');
  if (!source) return 0;
  assertCents(source.amountCents);
  return Math.abs(source.amountCents);
}

function categoryOfItem(item: BudgetItem): string {
  const category = item.category.trim();
  return category || item.name.trim() || UNASSIGNED_AREA;
}

export function coverFundIdForGasto(
  row: TransactionRow,
  splits: SplitRow[],
  cardCharges: CardCharge[],
): string | null {
  const source = splits.find((split) => split.role === 'SOURCE');
  if (source?.fundId) return source.fundId;
  const charge = cardCharges.find((item) => item.transactionId === row.id);
  return charge?.coverFundId ?? null;
}

function itemsCoveringFund(items: BudgetItem[], fundId: string): BudgetItem[] {
  return items.filter((item) => item.coverFundId === fundId);
}

export function areaForGasto(
  row: TransactionRow,
  splits: SplitRow[],
  items: BudgetItem[],
  funds: Array<Pick<Fund, 'id' | 'name'>>,
  cardCharges: CardCharge[] = [],
): string {
  const fundId = coverFundIdForGasto(row, splits, cardCharges);
  if (fundId) {
    const linked = itemsCoveringFund(items, fundId);
    const unique = [...new Set(linked.map(categoryOfItem))];
    if (unique.length === 1) return unique[0]!;
    if (unique.length > 1) return [...unique].sort((left, right) => left.localeCompare(right))[0]!;
    const fund = funds.find((item) => item.id === fundId);
    if (fund?.name.trim()) return fund.name.trim();
  }
  const note = row.note.trim();
  if (note) return note;
  return UNASSIGNED_AREA;
}

function scopeForGasto(
  row: TransactionRow,
  splits: SplitRow[],
  items: BudgetItem[],
  cardCharges: CardCharge[],
): BudgetScope {
  const charge = cardCharges.find((item) => item.transactionId === row.id);
  if (charge?.chargeClass === 'PERSONAL_Z') return 'Z';
  if (charge?.chargeClass === 'PERSONAL_A') return 'A';
  const fundId = coverFundIdForGasto(row, splits, cardCharges);
  if (fundId) {
    const scopes = [...new Set(itemsCoveringFund(items, fundId).map((item) => item.budgetScope))];
    if (scopes.length === 1) return scopes[0]!;
  }
  return 'HOME';
}

function emptyScope(scope: BudgetScope): ScopeSpendRow {
  return {
    scope,
    spentCents: 0,
    budgetedMonthlyCents: 0,
    quincenalCents: 0,
    mensualCents: 0,
  };
}

function addCents(left: Cents, right: Cents): Cents {
  assertCents(left);
  assertCents(right);
  return left + right;
}

export function postedGastosInMonth(
  transactions: TransactionRow[],
  yearMonth: UtcYearMonth,
): TransactionRow[] {
  return transactions.filter(
    (row) =>
      row.type === 'GASTO' &&
      row.status === 'POSTED' &&
      row.reversesId == null &&
      isInUtcMonth(row.occurredAt, yearMonth),
  );
}

export function buildMonthlySpendReport(input: MonthlySpendInput): MonthlySpendReport {
  const yearMonth = input.yearMonth ?? utcYearMonthFromDate(input.now ?? new Date());
  const cardCharges = input.cardCharges ?? [];
  const spentByArea = new Map<string, Cents>();
  const budgetedByArea = new Map<string, Cents>();
  const home = emptyScope('HOME');
  const personZ = emptyScope('Z');
  const personA = emptyScope('A');
  const byScope: Record<BudgetScope, ScopeSpendRow> = { HOME: home, Z: personZ, A: personA };

  for (const raw of input.items) {
    const item = completeBudgetShares(raw);
    const monthly = itemMonthlyEquivalentCents(item);
    assertCents(monthly);
    const scopeRow = byScope[item.budgetScope];
    if (item.budgetScope === 'HOME') {
      scopeRow.budgetedMonthlyCents = addCents(scopeRow.budgetedMonthlyCents, monthly);
      if (item.active && item.frequency === 'QUINCENAL') {
        scopeRow.quincenalCents = addCents(scopeRow.quincenalCents, item.amountCents);
      }
      if (item.active && item.frequency === 'MENSUAL') {
        scopeRow.mensualCents = addCents(scopeRow.mensualCents, item.amountCents);
      }
    }
    const zMonthly = personMonthlyEquivalentCents(item, 'Z');
    const aMonthly = personMonthlyEquivalentCents(item, 'A');
    personZ.budgetedMonthlyCents = addCents(personZ.budgetedMonthlyCents, zMonthly);
    personA.budgetedMonthlyCents = addCents(personA.budgetedMonthlyCents, aMonthly);
    if (item.active && item.frequency === 'QUINCENAL') {
      personZ.quincenalCents = addCents(personZ.quincenalCents, item.zShareCents);
      personA.quincenalCents = addCents(personA.quincenalCents, item.aShareCents);
    }
    if (item.active && item.frequency === 'MENSUAL') {
      personZ.mensualCents = addCents(personZ.mensualCents, item.zShareCents);
      personA.mensualCents = addCents(personA.mensualCents, item.aShareCents);
    }
    const area = categoryOfItem(item);
    budgetedByArea.set(area, addCents(budgetedByArea.get(area) ?? 0, monthly));
  }

  let totalSpentCents: Cents = 0;
  for (const row of postedGastosInMonth(input.transactions, yearMonth)) {
    const splits = input.splitsByTx.get(row.id) ?? [];
    const amount = gastoAmountCents(splits);
    totalSpentCents = addCents(totalSpentCents, amount);
    const area = areaForGasto(row, splits, input.items, input.funds, cardCharges);
    spentByArea.set(area, addCents(spentByArea.get(area) ?? 0, amount));
    const scopeRow = byScope[scopeForGasto(row, splits, input.items, cardCharges)];
    scopeRow.spentCents = addCents(scopeRow.spentCents, amount);
  }

  const areaNames = new Set<string>([...budgetedByArea.keys(), ...spentByArea.keys()]);
  const areas: AreaSpendRow[] = [...areaNames]
    .map((area) => ({
      area,
      spentCents: spentByArea.get(area) ?? 0,
      budgetedMonthlyCents: budgetedByArea.get(area) ?? 0,
    }))
    .sort((left, right) => {
      const byBudget = right.budgetedMonthlyCents - left.budgetedMonthlyCents;
      if (byBudget !== 0) return byBudget;
      const bySpent = right.spentCents - left.spentCents;
      if (bySpent !== 0) return bySpent;
      return left.area.localeCompare(right.area, 'es');
    });

  const totalFromAreas = areas.reduce((sum, row) => addCents(sum, row.spentCents), 0);
  if (totalFromAreas !== totalSpentCents) {
    throw new Error('El total conjunto debe ser la suma de las áreas');
  }

  const totalBudgetedMonthlyCents = input.items.reduce(
    (sum, raw) => addCents(sum, itemMonthlyEquivalentCents(completeBudgetShares(raw))),
    0,
  );

  return {
    yearMonth,
    areas,
    home,
    personZ,
    personA,
    totalSpentCents,
    totalBudgetedMonthlyCents,
  };
}
