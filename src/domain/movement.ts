import type { Account, BudgetItem, CardCharge, Reservation, SplitRow, TransactionRow } from './types';
import type { Cents } from './money';
import { formatUsd } from './money';
import { isWithinExpenseHorizon } from './horizon';
import { isBarrasAccount } from './segments';

export type MovementDraft = {
  type: string;
  amountCents: Cents;
  note: string;
  occurredAt: string;
  accountId: string;
  fromAccountId: string;
  toAccountId: string;
  fundId: string;
  toFundId: string;
  personId: string;
  cardId: string;
  reservationId: string;
};

export function movementTypeLabel(type: string): string {
  const map: Record<string, string> = {
    INGRESO: 'Ingreso',
    GASTO: 'Gasto',
    CARGO_TARJETA: 'Gasto con tarjeta',
    TRANSFERENCIA: 'Transferencia',
    APORTE: 'Aporte',
    RESERVA: 'Reserva',
    LIBERACION_RESERVA: 'Liberación',
    AJUSTE: 'Ajuste',
    PAGO_DEUDA: 'Pago de deuda',
  };
  return map[type] ?? type;
}

export function movementPlaceLabel(
  draft: MovementDraft,
  names: { accountName: (id: string) => string; fundName: (id: string) => string },
): string {
  const fromAcc = names.accountName(draft.fromAccountId);
  const toAcc = names.accountName(draft.toAccountId);
  const acc = names.accountName(draft.accountId);
  const fund = names.fundName(draft.fundId);
  const toFund = names.fundName(draft.toFundId);

  if (draft.type === 'TRANSFERENCIA') {
    const accounts = [fromAcc, toAcc].filter(Boolean).join(' → ');
    const funds = [fund, toFund].filter(Boolean).join(' → ');
    return [accounts, funds].filter(Boolean).join(' · ') || '—';
  }

  const parts = [acc || fromAcc || toAcc, fund || toFund].filter(Boolean);
  return parts.join(' · ') || '—';
}

export function describeVoidEffect(row: TransactionRow, splits: SplitRow[]): string {
  const draft = describeMovement(row, splits);
  return `${movementTypeLabel(draft.type)} de ${formatUsd(draft.amountCents)} queda anulado. Se registra la inversa. El historial no se borra.`;
}

export function describeMovement(
  row: TransactionRow,
  splits: SplitRow[],
  reservations: Reservation[] = [],
): MovementDraft {
  const source = splits.find((split) => split.role === 'SOURCE');
  const dest = splits.find((split) => split.role === 'DESTINATION');
  const reserve = splits.find((split) => split.role === 'RESERVE');
  const equity = splits.find((split) => split.role === 'EQUITY');
  const cardId = source?.cardId ?? dest?.cardId ?? '';
  const type = row.type === 'GASTO' && cardId ? 'CARGO_TARJETA' : row.type;
  const signedAccount = dest?.accountId
    ? dest.amountCents
    : source?.accountId
      ? source.amountCents
      : 0;
  const amountCents =
    row.type === 'AJUSTE' ? signedAccount : Math.abs(equity?.amountCents ?? signedAccount ?? reserve?.amountCents ?? 0);
  const fundId = source?.fundId ?? reserve?.fundId ?? '';
  return {
    type,
    amountCents,
    note: row.note,
    occurredAt: row.occurredAt,
    accountId: source?.accountId ?? dest?.accountId ?? reserve?.accountId ?? '',
    fromAccountId: source?.accountId ?? '',
    toAccountId: dest?.accountId ?? '',
    fundId,
    toFundId: dest?.fundId ?? '',
    personId: dest?.personId ?? source?.personId ?? '',
    cardId,
    reservationId: reservations.find((item) => item.fundId === fundId)?.id ?? '',
  };
}

export const MOVEMENT_FILTER_TYPES = [
  'INGRESO',
  'GASTO',
  'CARGO_TARJETA',
  'TRANSFERENCIA',
  'APORTE',
  'RESERVA',
  'LIBERACION_RESERVA',
  'AJUSTE',
  'PAGO_DEUDA',
] as const;

export type MovementFilterType = (typeof MOVEMENT_FILTER_TYPES)[number];

/** Casa/Barras vs Gastos X. Vacío = ambos, solo si el usuario lo elige. */
export type SpendLane = 'CASA' | 'GASTO_X';

export type MovementFilter = {
  type?: MovementFilterType | '';
  accountId?: string;
  fundId?: string;
  budgetItemId?: string;
  personId?: string;
  fromOccurredAt?: string;
  toOccurredAt?: string;
  includeVoided?: boolean;
  horizonOnly?: boolean;
  spendLane?: SpendLane | '';
};

function displayType(row: TransactionRow, splits: SplitRow[]): string {
  const cardId = splits.some((split) => split.cardId);
  return row.type === 'GASTO' && cardId ? 'CARGO_TARJETA' : row.type;
}

function coversFund(
  row: TransactionRow,
  splits: SplitRow[],
  charges: CardCharge[],
  fundId: string,
): boolean {
  if (splits.some((split) => split.fundId === fundId)) return true;
  const charge = charges.find((item) => item.transactionId === row.id);
  return charge?.coverFundId === fundId;
}

function matchesPerson(splits: SplitRow[], personId: string): boolean {
  return splits.some((split) => split.personId === personId);
}

function matchesAccount(splits: SplitRow[], accountId: string): boolean {
  return splits.some(
    (split) => split.accountId === accountId && (split.role === 'SOURCE' || split.role === 'DESTINATION'),
  );
}

/** Gasto X: cargo SHARED_UNBUDGETED o efectivo que no sale de Barras. */
export function isGastoXMovement(
  row: TransactionRow,
  splits: SplitRow[],
  charges: CardCharge[],
  accounts: Array<Pick<Account, 'id' | 'name' | 'kind'>>,
): boolean {
  const charge = charges.find((item) => item.transactionId === row.id);
  if (charge) return charge.chargeClass === 'SHARED_UNBUDGETED';
  if (row.type !== 'GASTO') return false;
  const source = splits.find((split) => split.role === 'SOURCE');
  const account = accounts.find((item) => item.id === source?.accountId);
  if (!account) return false;
  return !isBarrasAccount(account);
}

export function filterHistoryMovements(
  rows: TransactionRow[],
  splitsByTx: Map<string, SplitRow[]>,
  input: {
    filter?: MovementFilter;
    cardCharges?: CardCharge[];
    budgetItems?: BudgetItem[];
    accounts?: Array<Pick<Account, 'id' | 'name' | 'kind'>>;
    now?: Date;
  } = {},
): TransactionRow[] {
  const filter = input.filter ?? {};
  const charges = input.cardCharges ?? [];
  const items = input.budgetItems ?? [];
  const accounts = input.accounts ?? [];
  const now = input.now ?? new Date();
  const coverFundId = filter.budgetItemId
    ? (items.find((item) => item.id === filter.budgetItemId)?.coverFundId ?? null)
    : null;
  const fromMs = filter.fromOccurredAt ? Date.parse(filter.fromOccurredAt) : Number.NaN;
  const toMs = filter.toOccurredAt ? Date.parse(filter.toOccurredAt) : Number.NaN;

  return rows
    .filter((row) => {
      if (row.reversesId) return false;
      if (row.status === 'VOID' && !filter.includeVoided) return false;
      if (row.status !== 'POSTED' && row.status !== 'VOID') return false;
      if (filter.horizonOnly && row.type === 'GASTO' && !isWithinExpenseHorizon(row.occurredAt, now)) {
        return false;
      }
      const splits = splitsByTx.get(row.id) ?? [];
      const type = displayType(row, splits);
      if (filter.type) {
        if (filter.type === 'GASTO') {
          if (row.type !== 'GASTO') return false;
        } else if (type !== filter.type) {
          return false;
        }
      }
      if (filter.spendLane === 'CASA' || filter.spendLane === 'GASTO_X') {
        if (row.type !== 'GASTO') return false;
        const gastoX = isGastoXMovement(row, splits, charges, accounts);
        if (filter.spendLane === 'GASTO_X' ? !gastoX : gastoX) return false;
      }
      if (filter.accountId && !matchesAccount(splits, filter.accountId)) return false;
      if (filter.fundId && !coversFund(row, splits, charges, filter.fundId)) return false;
      if (filter.budgetItemId) {
        if (!coverFundId) return false;
        if (!coversFund(row, splits, charges, coverFundId)) return false;
      }
      if (filter.personId && !matchesPerson(splits, filter.personId)) return false;
      const occurred = Date.parse(row.occurredAt);
      if (Number.isFinite(fromMs) && occurred < fromMs) return false;
      if (Number.isFinite(toMs) && occurred > toMs) return false;
      return true;
    })
    .sort((left, right) => {
      const byDate = right.occurredAt.localeCompare(left.occurredAt);
      if (byDate !== 0) return byDate;
      return right.createdAt.localeCompare(left.createdAt);
    });
}
