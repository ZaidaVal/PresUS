import {
  cutoffLabel,
  currentPeriod,
  itemObligationInPeriod,
  periodRefKey,
  utcPeriodRef,
} from './budget';
import { DomainError, type LedgerTx } from './ledger';
import { assertCents, type Cents } from './money';
import { gastoAmountCents, isInUtcMonth } from './monthlySpend';
import { redeemUnusedBudget } from './budgetOps';
import { postLiberacion } from './posting';
import { accountBalanceFromSplits } from './balances';
import { isSavingsAccount } from './segments';
import type {
  Account,
  BudgetItem,
  CardCharge,
  Fund,
  Period,
  PeriodRef,
  SplitRow,
  TransactionRow,
} from './types';

export const BUDGET_CUTOFFS_META_KEY = 'budget_cutoffs';
export const LAST_CUTOFF_AT_META_KEY = 'last_cutoff_at';

export type BudgetOverrunRow = {
  budgetItemId: string;
  name: string;
  area: string;
  budgetedCents: Cents;
  spentCents: Cents;
  overrunCents: Cents;
};

export type BudgetCutoffRecord = {
  key: string;
  year: number;
  month: number;
  period: Period;
  closedAt: string;
  label: string;
  rows: BudgetOverrunRow[];
  totalOverrunCents: Cents;
  leftoverMovedCents?: Cents;
  destinationAccountId?: string | null;
};

export type BudgetOverrunReport = {
  period: PeriodRef;
  key: string;
  closed: boolean;
  closedAt: string | null;
  label: string;
  rows: BudgetOverrunRow[];
  overRows: BudgetOverrunRow[];
  totalBudgetedCents: Cents;
  totalSpentCents: Cents;
  totalOverrunCents: Cents;
};

export type BudgetOverrunInput = {
  items: BudgetItem[];
  funds: Array<Pick<Fund, 'id' | 'name'>>;
  transactions: TransactionRow[];
  splitsByTx: Map<string, SplitRow[]>;
  cardCharges?: CardCharge[];
  period?: PeriodRef;
  cutoffs?: BudgetCutoffRecord[];
  now?: Date;
};

function addCents(left: Cents, right: Cents): Cents {
  assertCents(left);
  assertCents(right);
  return left + right;
}

export function itemOverrunCents(spentCents: Cents, budgetedCents: Cents): Cents {
  assertCents(spentCents);
  assertCents(budgetedCents);
  const delta = spentCents - budgetedCents;
  return delta > 0 ? delta : 0;
}

export function isInPeriodRef(iso: string, ref: PeriodRef): boolean {
  if (!isInUtcMonth(iso, { year: ref.year, month: ref.month })) return false;
  const day = new Date(iso).getUTCDate();
  const period: Period = day <= 15 ? 'Q1' : 'Q2';
  return period === ref.period;
}

export function postedGastosInPeriod(
  transactions: TransactionRow[],
  ref: PeriodRef,
): TransactionRow[] {
  return transactions.filter(
    (row) =>
      row.type === 'GASTO' &&
      row.status === 'POSTED' &&
      row.reversesId == null &&
      isInPeriodRef(row.occurredAt, ref),
  );
}

function coverFundIdForGasto(
  row: TransactionRow,
  splits: SplitRow[],
  cardCharges: CardCharge[],
): string | null {
  const source = splits.find((split) => split.role === 'SOURCE' && split.fundId);
  if (source?.fundId) return source.fundId;
  const charge = cardCharges.find((item) => item.transactionId === row.id);
  return charge?.coverFundId ?? null;
}

function categoryOfItem(item: BudgetItem): string {
  const category = item.category.trim();
  return category || item.name.trim();
}

function emptyRow(item: BudgetItem, budgetedCents: Cents, spentCents: Cents): BudgetOverrunRow {
  return {
    budgetItemId: item.id,
    name: item.name,
    area: categoryOfItem(item),
    budgetedCents,
    spentCents,
    overrunCents: itemOverrunCents(spentCents, budgetedCents),
  };
}

export function deriveBudgetOverrunRows(input: {
  items: BudgetItem[];
  transactions: TransactionRow[];
  splitsByTx: Map<string, SplitRow[]>;
  cardCharges?: CardCharge[];
  period: PeriodRef;
}): BudgetOverrunRow[] {
  const cardCharges = input.cardCharges ?? [];
  const spentByFund = new Map<string, Cents>();
  for (const row of postedGastosInPeriod(input.transactions, input.period)) {
    const splits = input.splitsByTx.get(row.id) ?? [];
    const fundId = coverFundIdForGasto(row, splits, cardCharges);
    if (!fundId) continue;
    const amount = gastoAmountCents(splits);
    spentByFund.set(fundId, addCents(spentByFund.get(fundId) ?? 0, amount));
  }

  const rows: BudgetOverrunRow[] = [];
  for (const item of input.items) {
    const budgetedCents = itemObligationInPeriod(item, input.period.period);
    const spentCents = item.coverFundId ? (spentByFund.get(item.coverFundId) ?? 0) : 0;
    if (budgetedCents === 0 && spentCents === 0) continue;
    rows.push(emptyRow(item, budgetedCents, spentCents));
  }
  return rows.sort((left, right) => {
    const byOver = right.overrunCents - left.overrunCents;
    if (byOver !== 0) return byOver;
    return left.name.localeCompare(right.name, 'es');
  });
}

export function areaOverrunRows(rows: BudgetOverrunRow[]): BudgetOverrunRow[] {
  const byArea = new Map<string, BudgetOverrunRow>();
  for (const row of rows) {
    const current = byArea.get(row.area);
    if (!current) {
      byArea.set(row.area, {
        budgetItemId: row.area,
        name: row.area,
        area: row.area,
        budgetedCents: row.budgetedCents,
        spentCents: row.spentCents,
        overrunCents: 0,
      });
      continue;
    }
    current.budgetedCents = addCents(current.budgetedCents, row.budgetedCents);
    current.spentCents = addCents(current.spentCents, row.spentCents);
  }
  return [...byArea.values()]
    .map((row) => ({ ...row, overrunCents: itemOverrunCents(row.spentCents, row.budgetedCents) }))
    .sort((left, right) => {
      const byOver = right.overrunCents - left.overrunCents;
      if (byOver !== 0) return byOver;
      return left.area.localeCompare(right.area, 'es');
    });
}

function totals(rows: BudgetOverrunRow[]): {
  totalBudgetedCents: Cents;
  totalSpentCents: Cents;
  totalOverrunCents: Cents;
} {
  let totalBudgetedCents: Cents = 0;
  let totalSpentCents: Cents = 0;
  let totalOverrunCents: Cents = 0;
  for (const row of rows) {
    totalBudgetedCents = addCents(totalBudgetedCents, row.budgetedCents);
    totalSpentCents = addCents(totalSpentCents, row.spentCents);
    totalOverrunCents = addCents(totalOverrunCents, row.overrunCents);
  }
  return {
    totalBudgetedCents,
    totalSpentCents,
    totalOverrunCents,
  };
}

export function buildBudgetOverrunReport(input: BudgetOverrunInput): BudgetOverrunReport {
  const period = input.period ?? utcPeriodRef(input.now ?? new Date());
  const key = periodRefKey(period);
  const cutoffs = input.cutoffs ?? [];
  const snapshot = cutoffs.find((row) => row.key === key) ?? null;
  const derived = deriveBudgetOverrunRows({
    items: input.items,
    transactions: input.transactions,
    splitsByTx: input.splitsByTx,
    cardCharges: input.cardCharges,
    period,
  });
  const rows = snapshot ? snapshot.rows : derived;
  const overRows = rows.filter((row) => row.overrunCents > 0);
  return {
    period,
    key,
    closed: Boolean(snapshot),
    closedAt: snapshot?.closedAt ?? null,
    label: snapshot?.label ?? cutoffLabel(period.period),
    rows,
    overRows,
    ...totals(rows),
  };
}

function asCents(value: unknown, label: string): Cents {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new DomainError(`${label} debe ser un entero en centavos`);
  }
  return value;
}

function parseOverrunRow(raw: unknown): BudgetOverrunRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Partial<BudgetOverrunRow>;
  if (typeof row.budgetItemId !== 'string' || typeof row.name !== 'string' || typeof row.area !== 'string') {
    return null;
  }
  return {
    budgetItemId: row.budgetItemId,
    name: row.name,
    area: row.area,
    budgetedCents: asCents(row.budgetedCents, 'Presupuestado'),
    spentCents: asCents(row.spentCents, 'Gastado'),
    overrunCents: asCents(row.overrunCents, 'Sobrecosto'),
  };
}

export function parseBudgetCutoffs(raw: string | undefined | null): BudgetCutoffRecord[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const rows: BudgetCutoffRecord[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Partial<BudgetCutoffRecord>;
      if (typeof row.key !== 'string' || typeof row.closedAt !== 'string') continue;
      if (row.period !== 'Q1' && row.period !== 'Q2') continue;
      if (typeof row.year !== 'number' || !Number.isInteger(row.year)) continue;
      if (typeof row.month !== 'number' || !Number.isInteger(row.month) || row.month < 0 || row.month > 11) {
        continue;
      }
      const overrunRows = Array.isArray(row.rows)
        ? row.rows.map(parseOverrunRow).filter((entry): entry is BudgetOverrunRow => entry != null)
        : [];
      rows.push({
        key: row.key,
        year: row.year,
        month: row.month,
        period: row.period,
        closedAt: row.closedAt,
        label: typeof row.label === 'string' ? row.label : cutoffLabel(row.period),
        rows: overrunRows,
        totalOverrunCents: asCents(row.totalOverrunCents ?? totals(overrunRows).totalOverrunCents, 'Sobrecosto del corte'),
        leftoverMovedCents:
          row.leftoverMovedCents == null ? 0 : asCents(row.leftoverMovedCents, 'Excedente movido'),
        destinationAccountId: typeof row.destinationAccountId === 'string' ? row.destinationAccountId : null,
      });
    }
    return rows;
  } catch {
    return [];
  }
}

export function serializeBudgetCutoffs(rows: BudgetCutoffRecord[]): string {
  return JSON.stringify(rows);
}

type CutoffAccount = Pick<Account, 'id' | 'name' | 'visibility'>;

/**
 * Destinos válidos del excedente: cuentas públicas de ahorro (Ahorros, Ahorros 2, y las que existan).
 * No hay default: el corte exige una elección. Atlántida y Barras no aplican.
 */
export function cutoffDestinationAccounts(accounts: CutoffAccount[]): CutoffAccount[] {
  return accounts
    .filter((row) => row.visibility === 'PUBLIC' && isSavingsAccount(row))
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, 'es'));
}

function isCutoffDestination(account: CutoffAccount | undefined): account is CutoffAccount {
  return Boolean(account && account.visibility === 'PUBLIC' && isSavingsAccount(account));
}

export type CutoffDisposition = 'TRANSFER' | 'RELEASE' | 'NONE';

export type CutoffTransferLine = {
  budgetItemId: string;
  name: string;
  fundId: string;
  fundName: string;
  sourceAccountId: string;
  sourceAccountName: string;
  budgetedCents: Cents;
  spentCents: Cents;
  overrunCents: Cents;
  leftoverCents: Cents;
  disposition: CutoffDisposition;
  sourceReservedBeforeCents: Cents;
  sourceReservedAfterCents: Cents;
};

export type CutoffTransferPlan = {
  period: PeriodRef;
  key: string;
  alreadyClosed: boolean;
  toAccountId: string;
  toAccountName: string;
  destinationSaldoBeforeCents: Cents;
  destinationSaldoAfterCents: Cents;
  totalLeftoverCents: Cents;
  totalTransferredCents: Cents;
  totalReleasedCents: Cents;
  totalOverrunCents: Cents;
  lines: CutoffTransferLine[];
  feasible: boolean;
  rejection: string | null;
};

/** Excedente = lo presupuestado no gastado, capado por el apartado. El sobrecosto no se mueve. */
export function itemLeftoverCents(reservedCents: Cents, budgetedCents: Cents, spentCents: Cents): Cents {
  assertCents(reservedCents);
  assertCents(budgetedCents);
  assertCents(spentCents);
  const unspentBudgeted = budgetedCents - spentCents;
  if (unspentBudgeted <= 0) return 0;
  return Math.min(reservedCents, unspentBudgeted);
}

export function planCutoffTransfer(input: {
  items: BudgetItem[];
  funds: Array<Pick<Fund, 'id' | 'name' | 'accountId'>>;
  accounts: CutoffAccount[];
  reservedByFund: Map<string, Cents>;
  accountSaldoById: Map<string, Cents>;
  transactions: TransactionRow[];
  splitsByTx: Map<string, SplitRow[]>;
  cardCharges?: CardCharge[];
  period: PeriodRef;
  toAccountId?: string;
  cutoffs?: BudgetCutoffRecord[];
}): CutoffTransferPlan {
  const key = periodRefKey(input.period);
  const alreadyClosed = (input.cutoffs ?? []).some((row) => row.key === key);
  const toAccountId = input.toAccountId?.trim() ?? '';
  const destination = toAccountId ? input.accounts.find((row) => row.id === toAccountId) : undefined;
  const destinationSaldoBeforeCents = toAccountId ? (input.accountSaldoById.get(toAccountId) ?? 0) : 0;
  const remainingReserved = new Map(input.reservedByFund);
  const spentRows = deriveBudgetOverrunRows({
    items: input.items,
    transactions: input.transactions,
    splitsByTx: input.splitsByTx,
    cardCharges: input.cardCharges,
    period: input.period,
  });
  const spentByItem = new Map(spentRows.map((row) => [row.budgetItemId, row]));

  const lines: CutoffTransferLine[] = [];
  for (const item of input.items) {
    if (!item.coverFundId) continue;
    const fund = input.funds.find((row) => row.id === item.coverFundId);
    if (!fund) continue;
    const account = input.accounts.find((row) => row.id === fund.accountId);
    if (!account) continue;
    const spent = spentByItem.get(item.id);
    const budgetedCents = spent?.budgetedCents ?? itemObligationInPeriod(item, input.period.period);
    const spentCents = spent?.spentCents ?? 0;
    const overrunCents = spent?.overrunCents ?? itemOverrunCents(spentCents, budgetedCents);
    const reservedNow = remainingReserved.get(fund.id) ?? 0;
    const leftoverCents = itemLeftoverCents(reservedNow, budgetedCents, spentCents);
    remainingReserved.set(fund.id, reservedNow - leftoverCents);
    let disposition: CutoffDisposition = 'NONE';
    if (leftoverCents > 0 && toAccountId) {
      disposition = fund.accountId === toAccountId ? 'RELEASE' : 'TRANSFER';
    }
    lines.push({
      budgetItemId: item.id,
      name: item.name,
      fundId: fund.id,
      fundName: fund.name,
      sourceAccountId: account.id,
      sourceAccountName: account.name,
      budgetedCents,
      spentCents,
      overrunCents,
      leftoverCents,
      disposition,
      sourceReservedBeforeCents: reservedNow,
      sourceReservedAfterCents: reservedNow - leftoverCents,
    });
  }

  const moveLines = lines.filter((row) => row.leftoverCents > 0);
  const totalLeftoverCents = moveLines.reduce((sum, row) => sum + row.leftoverCents, 0);
  const totalTransferredCents = moveLines
    .filter((row) => row.disposition === 'TRANSFER')
    .reduce((sum, row) => sum + row.leftoverCents, 0);
  const totalReleasedCents = moveLines
    .filter((row) => row.disposition === 'RELEASE')
    .reduce((sum, row) => sum + row.leftoverCents, 0);
  const totalOverrunCents = lines.reduce((sum, row) => sum + row.overrunCents, 0);

  let rejection: string | null = null;
  if (alreadyClosed) rejection = 'Este período ya está cortado';
  else if (totalLeftoverCents > 0) {
    if (cutoffDestinationAccounts(input.accounts).length === 0) {
      rejection = 'No hay cuenta de ahorro destino';
    } else if (!toAccountId) {
      rejection = 'Elige la cuenta destino del excedente';
    } else if (!destination) {
      rejection = 'Cuenta destino no encontrada';
    } else if (destination.visibility === 'PRIVATE') {
      rejection = 'El excedente no va a una cuenta privada';
    } else if (!isCutoffDestination(destination)) {
      rejection = 'El excedente va a una cuenta de ahorro';
    }
  }

  return {
    period: input.period,
    key,
    alreadyClosed,
    toAccountId,
    toAccountName: destination?.name ?? '',
    destinationSaldoBeforeCents,
    destinationSaldoAfterCents: destinationSaldoBeforeCents + totalTransferredCents,
    totalLeftoverCents,
    totalTransferredCents,
    totalReleasedCents,
    totalOverrunCents,
    lines,
    feasible: rejection == null,
    rejection,
  };
}

export async function planCutoffTransferFromTx(
  tx: LedgerTx,
  input: { now?: Date; period?: Period; year?: number; month?: number; toAccountId?: string } = {},
): Promise<CutoffTransferPlan> {
  const now = input.now ?? new Date();
  const period: PeriodRef = {
    year: input.year ?? now.getUTCFullYear(),
    month: input.month ?? now.getUTCMonth(),
    period: input.period ?? currentPeriod(now),
  };
  const items = await tx.listBudgetItems();
  const funds = await tx.listFunds();
  const accounts = await tx.listAccounts();
  const transactions = await tx.listTransactions();
  const splits = await tx.listSplits();
  const cardCharges = await tx.listCardCharges();
  const reservations = await tx.listActiveReservations();
  const postedSplits = await tx.listPostedSplits();
  const splitsByTx = new Map<string, SplitRow[]>();
  for (const split of splits) {
    const list = splitsByTx.get(split.transactionId) ?? [];
    list.push(split);
    splitsByTx.set(split.transactionId, list);
  }
  const reservedByFund = new Map<string, Cents>();
  for (const reservation of reservations) {
    reservedByFund.set(
      reservation.fundId,
      (reservedByFund.get(reservation.fundId) ?? 0) + reservation.amountCents,
    );
  }
  const accountSaldoById = new Map<string, Cents>();
  for (const account of accounts) {
    accountSaldoById.set(account.id, accountBalanceFromSplits(account.id, postedSplits));
  }
  return planCutoffTransfer({
    items,
    funds,
    accounts,
    reservedByFund,
    accountSaldoById,
    transactions,
    splitsByTx,
    cardCharges,
    period,
    toAccountId: input.toAccountId,
    cutoffs: parseBudgetCutoffs(await tx.getMeta(BUDGET_CUTOFFS_META_KEY)),
  });
}

async function releaseFromFund(
  tx: LedgerTx,
  fundId: string,
  amountCents: Cents,
  note: string,
  occurredAt?: string,
) {
  assertCents(amountCents);
  let remaining = amountCents;
  const reservations = (await tx.listActiveReservations())
    .filter((row) => row.fundId === fundId)
    .sort((left, right) => left.sourceTransactionId.localeCompare(right.sourceTransactionId));
  for (const reservation of reservations) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, reservation.amountCents);
    await postLiberacion(tx, {
      skipDestinationPolicy: true,
      reservationId: reservation.id,
      amountCents: take,
      note,
      occurredAt,
    });
    remaining -= take;
  }
  if (remaining > 0) {
    throw new DomainError('No hay apartado suficiente para liberar el excedente');
  }
}

export async function executeBudgetCutoff(
  tx: LedgerTx,
  input: {
    now?: Date;
    period?: Period;
    year?: number;
    month?: number;
    toAccountId?: string;
  } = {},
): Promise<BudgetCutoffRecord> {
  const now = input.now ?? new Date();
  const period: PeriodRef = {
    year: input.year ?? now.getUTCFullYear(),
    month: input.month ?? now.getUTCMonth(),
    period: input.period ?? currentPeriod(now),
  };
  const key = periodRefKey(period);
  const existing = parseBudgetCutoffs(await tx.getMeta(BUDGET_CUTOFFS_META_KEY));
  if (existing.some((row) => row.key === key)) {
    throw new DomainError('Este período ya está cortado');
  }

  const items = await tx.listBudgetItems();
  const funds = await tx.listFunds();
  const transactions = await tx.listTransactions();
  const splits = await tx.listSplits();
  const cardCharges = await tx.listCardCharges();
  const splitsByTx = new Map<string, SplitRow[]>();
  for (const split of splits) {
    const list = splitsByTx.get(split.transactionId) ?? [];
    list.push(split);
    splitsByTx.set(split.transactionId, list);
  }
  const report = buildBudgetOverrunReport({
    items,
    funds,
    transactions,
    splitsByTx,
    cardCharges,
    period,
  });

  const plan = await planCutoffTransferFromTx(tx, {
    now,
    period: input.period,
    year: input.year,
    month: input.month,
    toAccountId: input.toAccountId,
  });
  if (!plan.feasible) {
    throw new DomainError(plan.rejection ?? 'No se puede ejecutar el corte');
  }

  let leftoverMovedCents: Cents = 0;
  if (plan.totalLeftoverCents > 0) {
    leftoverMovedCents = plan.totalLeftoverCents;
    const occurredAt = now.toISOString();
    for (const line of plan.lines) {
      if (line.leftoverCents <= 0) continue;
      const note = `Corte: excedente ${line.name}`;
      if (line.disposition === 'RELEASE') {
        await releaseFromFund(tx, line.fundId, line.leftoverCents, note, occurredAt);
      } else if (line.disposition === 'TRANSFER') {
        await redeemUnusedBudget(tx, {
          budgetItemId: line.budgetItemId,
          amountCents: line.leftoverCents,
          toAccountId: plan.toAccountId,
          note,
          occurredAt,
        });
      }
    }
  }

  const record: BudgetCutoffRecord = {
    key,
    year: period.year,
    month: period.month,
    period: period.period,
    closedAt: now.toISOString(),
    label: cutoffLabel(period.period),
    rows: report.rows,
    totalOverrunCents: report.totalOverrunCents,
    leftoverMovedCents,
    destinationAccountId: plan.toAccountId || null,
  };
  await tx.setMeta(BUDGET_CUTOFFS_META_KEY, serializeBudgetCutoffs([...existing, record]));
  await tx.setMeta(LAST_CUTOFF_AT_META_KEY, record.closedAt);
  return record;
}
