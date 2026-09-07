import { currentPeriod, itemObligationInPeriod } from './budget';
import { assertOperatingBudgetFrequency, isOperatingExpenseBeyondHorizon } from './horizon';
import { DomainError, type LedgerTx } from './ledger';
import { assertCents, formatUsd, type Cents } from './money';
import { accountBalanceFromSplits } from './balances';
import { coverCashExpenseFromFund, postGasto, postLiberacion, postReserva, postTransferencia } from './posting';
import { isSavingsFund } from './segments';
import { assertBudgetShares } from './budget';
import type { BudgetCoverMode, BudgetItem, BudgetItemDraft, Fund, FundBalance, Period } from './types';

export interface BudgetEnvelope {
  item: BudgetItem;
  coverFund: Fund | null;
  accountId: string | null;
  obligationCents: Cents;
  reservedCents: Cents;
  leftoverCents: Cents;
}

export type { BudgetCoverMode };

export interface BudgetCoverPlan {
  mode: BudgetCoverMode;
  amountCents: Cents;
  reservedCents: Cents;
  availableCents: Cents;
  willReserveCents: Cents;
  willSpendCents: Cents;
  feasible: boolean;
  rejection: string | null;
  summary: string;
}

function asFund(row: Fund | FundBalance): Fund {
  return 'fund' in row ? row.fund : row;
}

export function budgetItemsForAccount(
  items: BudgetItem[],
  funds: Array<Fund | FundBalance>,
  accountId: string,
): BudgetItem[] {
  return items.filter((item) => {
    if (!item.coverFundId) return false;
    const fund = funds.map(asFund).find((row) => row.id === item.coverFundId);
    return fund?.accountId === accountId;
  });
}

export function planBudgetCover(input: {
  mode: BudgetCoverMode;
  amountCents: Cents;
  reservedCents: Cents;
  availableCents: Cents;
  fundName: string;
  accountName: string;
}): BudgetCoverPlan {
  assertCents(input.amountCents);
  assertCents(input.reservedCents);
  assertCents(input.availableCents);
  if (input.amountCents <= 0) {
    throw new DomainError('El monto debe ser mayor que cero');
  }

  if (input.mode === 'RESERVE_ONLY') {
    const feasible = input.availableCents >= input.amountCents;
    return {
      mode: input.mode,
      amountCents: input.amountCents,
      reservedCents: input.reservedCents,
      availableCents: input.availableCents,
      willReserveCents: input.amountCents,
      willSpendCents: 0,
      feasible,
      rejection: feasible
        ? null
        : `No hay disponible en ${input.accountName} para retener ${formatUsd(input.amountCents)} en ${input.fundName}.`,
      summary: `Se retiene ${formatUsd(input.amountCents)} en ${input.fundName}. No es un gasto. El saldo de ${input.accountName} no baja.`,
    };
  }

  if (input.reservedCents >= input.amountCents) {
    return {
      mode: input.mode,
      amountCents: input.amountCents,
      reservedCents: input.reservedCents,
      availableCents: input.availableCents,
      willReserveCents: 0,
      willSpendCents: input.amountCents,
      feasible: true,
      rejection: null,
      summary: `Sale del apartado de ${input.fundName}.`,
    };
  }

  const shortfall = input.amountCents - input.reservedCents;
  const feasible = input.availableCents >= shortfall;
  const retainedThenSpent =
    input.reservedCents > 0
      ? `Sale del apartado de ${input.fundName} (${formatUsd(input.reservedCents)}) y primero se retiene ${formatUsd(shortfall)} del disponible.`
      : `Primero se retiene ${formatUsd(shortfall)} y luego se gasta. Sale del apartado de ${input.fundName}.`;
  return {
    mode: input.mode,
    amountCents: input.amountCents,
    reservedCents: input.reservedCents,
    availableCents: input.availableCents,
    willReserveCents: shortfall,
    willSpendCents: input.amountCents,
    feasible,
    rejection: feasible
      ? null
      : `No hay apartado en ${input.fundName} ni disponible en ${input.accountName} para cubrir ${formatUsd(input.amountCents)}. No se toma el apartado de otros fondos.`,
    summary: retainedThenSpent,
  };
}

export interface ReserveCoverPlan {
  amountCents: Cents;
  reservedCents: Cents;
  availableCents: Cents;
  coverFromReserveCents: Cents;
  consumedCents: Cents;
  fromAvailableCents: Cents;
  leftoverReserveCents: Cents;
  feasible: boolean;
  rejection: string | null;
  summary: string;
}

/** consumed = min(gasto, apartado, lo que indica la persona). El resto sale del disponible de la misma cuenta. */
export function planReserveCover(input: {
  amountCents: Cents;
  reservedCents: Cents;
  availableCents: Cents;
  coverFromReserveCents: Cents;
  fundName: string;
  accountName: string;
}): ReserveCoverPlan {
  assertCents(input.amountCents);
  assertCents(input.reservedCents);
  assertCents(input.availableCents);
  assertCents(input.coverFromReserveCents, 'Lo cubierto con apartado');
  if (input.amountCents <= 0) {
    throw new DomainError('El monto debe ser mayor que cero');
  }
  if (input.coverFromReserveCents < 0) {
    throw new DomainError('Lo cubierto con apartado no puede ser negativo');
  }

  const consumedCents = Math.min(input.amountCents, input.reservedCents, input.coverFromReserveCents);
  const fromAvailableCents = input.amountCents - consumedCents;
  const leftoverReserveCents = input.reservedCents - consumedCents;
  const feasible = input.availableCents >= fromAvailableCents;
  const leftoverNote =
    leftoverReserveCents > 0
      ? ` Queda apartado ${formatUsd(leftoverReserveCents)} en ${input.fundName}.`
      : ` El apartado de ${input.fundName} queda en 0.`;
  const excessNote =
    fromAvailableCents > 0
      ? ` ${formatUsd(fromAvailableCents)} sale del disponible de ${input.accountName} (sobrecosto vs presupuesto).`
      : '';
  return {
    amountCents: input.amountCents,
    reservedCents: input.reservedCents,
    availableCents: input.availableCents,
    coverFromReserveCents: input.coverFromReserveCents,
    consumedCents,
    fromAvailableCents,
    leftoverReserveCents,
    feasible,
    rejection: feasible
      ? null
      : `No hay disponible en ${input.accountName} para los ${formatUsd(fromAvailableCents)} que no cubre el apartado de ${input.fundName}. No se toma el apartado de otros fondos.`,
    summary: `Se consume ${formatUsd(consumedCents)} del apartado de ${input.fundName}.${excessNote}${leftoverNote}`,
  };
}

export async function assignGastoToBudgetItem(
  tx: LedgerTx,
  input: {
    budgetItemId: string;
    accountId: string;
    amountCents: Cents;
    coverFromReserveCents: Cents;
    note?: string;
    occurredAt?: string;
  },
): Promise<{
  gastoTransactionId: string;
  consumedCents: Cents;
  fromAvailableCents: Cents;
  leftoverReserveCents: Cents;
}> {
  assertCents(input.amountCents);
  assertCents(input.coverFromReserveCents, 'Lo cubierto con apartado');
  const item = await tx.getBudgetItem(input.budgetItemId);
  if (!item) throw new DomainError('Partida de presupuesto no encontrada');
  if (!item.coverFundId) {
    throw new DomainError('Esta partida no tiene fondo: asígnalo para cubrir el gasto');
  }
  const funds = await tx.listFunds();
  if (isOperatingExpenseBeyondHorizon(item, funds)) {
    throw new DomainError('Este gasto superó 3 meses. No se gasta: redime el apartado si queda');
  }
  const account = await tx.getAccount(input.accountId);
  if (!account) throw new DomainError('Cuenta no encontrada');
  const fund = await tx.getFund(item.coverFundId);
  if (!fund) throw new DomainError('El fondo que cubre esta partida no existe');
  if (fund.accountId !== account.id) {
    const fundAccount = await tx.getAccount(fund.accountId);
    throw new DomainError(
      `El fondo ${fund.name} pertenece a ${fundAccount?.name ?? 'otra cuenta'}, no a ${account.name}. No se cubre un gasto de una cuenta con el apartado de otra.`,
    );
  }

  const reservations = await tx.listActiveReservations();
  const reservedCents = reservations
    .filter((row) => row.fundId === fund.id)
    .reduce((sum, row) => sum + row.amountCents, 0);
  const splits = await tx.listPostedSplitsForAccount(account.id);
  const saldo = accountBalanceFromSplits(account.id, splits);
  const reservedOnAccount = reservations
    .filter((row) => funds.some((itemFund) => itemFund.id === row.fundId && itemFund.accountId === account.id))
    .reduce((sum, row) => sum + row.amountCents, 0);
  const availableCents = saldo - reservedOnAccount;
  const plan = planReserveCover({
    amountCents: input.amountCents,
    reservedCents,
    availableCents,
    coverFromReserveCents: input.coverFromReserveCents,
    fundName: fund.name,
    accountName: account.name,
  });
  if (!plan.feasible) {
    throw new DomainError(plan.rejection ?? 'No hay disponible para el sobrecosto');
  }

  const gastoTransactionId = await postGasto(tx, {
    accountId: account.id,
    fundId: fund.id,
    amountCents: input.amountCents,
    consumeFromFundCents: plan.consumedCents,
    note: input.note?.trim() || `Gasto presupuestado: ${item.name}`,
    occurredAt: input.occurredAt,
  });
  return {
    gastoTransactionId,
    consumedCents: plan.consumedCents,
    fromAvailableCents: plan.fromAvailableCents,
    leftoverReserveCents: plan.leftoverReserveCents,
  };
}

export async function executeBudgetCover(
  tx: LedgerTx,
  input: {
    budgetItemId: string;
    accountId: string;
    amountCents: Cents;
    mode: BudgetCoverMode;
    note?: string;
    occurredAt?: string;
  },
): Promise<{ reservaTransactionId: string | null; gastoTransactionId: string | null }> {
  assertCents(input.amountCents);
  const item = await tx.getBudgetItem(input.budgetItemId);
  if (!item) throw new DomainError('Partida de presupuesto no encontrada');
  if (!item.coverFundId) {
    throw new DomainError('Esta partida no tiene fondo: asígnalo para cubrir el gasto');
  }
  const funds = await tx.listFunds();
  if (input.mode !== 'RESERVE_ONLY' && isOperatingExpenseBeyondHorizon(item, funds)) {
    throw new DomainError('Este gasto superó 3 meses. No se gasta: redime el apartado si queda');
  }
  const note =
    input.note?.trim() ||
    (input.mode === 'RESERVE_ONLY' ? `Retenido para ${item.name}` : `Gasto presupuestado: ${item.name}`);
  return coverCashExpenseFromFund(tx, {
    accountId: input.accountId,
    fundId: item.coverFundId,
    amountCents: input.amountCents,
    mode: input.mode,
    note,
    occurredAt: input.occurredAt,
  });
}

export function envelopeForItem(
  item: BudgetItem,
  funds: FundBalance[],
  period: Period = currentPeriod(),
): BudgetEnvelope {
  const obligationCents = itemObligationInPeriod(item, period);
  const cover = item.coverFundId ? funds.find((row) => row.fund.id === item.coverFundId) : undefined;
  const reservedCents = cover?.reservedCents ?? 0;
  return {
    item,
    coverFund: cover?.fund ?? null,
    accountId: cover?.fund.accountId ?? null,
    obligationCents,
    reservedCents,
    leftoverCents: reservedCents,
  };
}

export async function spendFromBudget(
  tx: LedgerTx,
  input: { budgetItemId: string; amountCents: Cents; note?: string; occurredAt?: string },
) {
  assertCents(input.amountCents);
  const item = await tx.getBudgetItem(input.budgetItemId);
  if (!item) throw new DomainError('Partida de presupuesto no encontrada');
  if (!item.coverFundId) {
    throw new DomainError('Esta partida no tiene fondo: asígnalo para sustraer de lo presupuestado');
  }
  const funds = await tx.listFunds();
  if (isOperatingExpenseBeyondHorizon(item, funds)) {
    throw new DomainError('Este gasto superó 3 meses. No se gasta: redime el apartado si queda');
  }
  const fund = await tx.getFund(item.coverFundId);
  if (!fund) throw new DomainError('El fondo que cubre esta partida no existe');
  return postGasto(tx, {
    accountId: fund.accountId,
    fundId: fund.id,
    amountCents: input.amountCents,
    note: input.note?.trim() || `Gasto presupuestado: ${item.name}`,
    occurredAt: input.occurredAt,
  });
}

export async function redeemUnusedBudget(
  tx: LedgerTx,
  input: {
    budgetItemId: string;
    amountCents: Cents;
    toAccountId: string;
    note?: string;
    occurredAt?: string;
  },
) {
  assertCents(input.amountCents);
  const item = await tx.getBudgetItem(input.budgetItemId);
  if (!item) throw new DomainError('Partida de presupuesto no encontrada');
  if (!item.coverFundId) {
    throw new DomainError('Esta partida no tiene fondo: no hay apartado que redimir');
  }
  const fund = await tx.getFund(item.coverFundId);
  if (!fund) throw new DomainError('El fondo que cubre esta partida no existe');
  if (input.toAccountId === fund.accountId) {
    throw new DomainError('Redimir envía el sobrante a otra cuenta. Elige un destino distinto');
  }
  const destination = await tx.getAccount(input.toAccountId);
  if (!destination) throw new DomainError('Cuenta destino no encontrada');
  if (destination.visibility === 'PRIVATE') {
    throw new DomainError('El sobrante no va a una cuenta privada');
  }
  return postTransferencia(tx, {
    fromAccountId: fund.accountId,
    toAccountId: destination.id,
    fromFundId: fund.id,
    amountCents: input.amountCents,
    note: input.note?.trim() || `Redime presupuesto no usado: ${item.name}`,
    occurredAt: input.occurredAt,
  });
}

export async function retireExpenseBudgetsBeyondHorizon(tx: LedgerTx): Promise<number> {
  const items = await tx.listBudgetItems();
  const funds = await tx.listFunds();
  let retired = 0;
  for (const item of items) {
    if (!item.active) continue;
    if (!isOperatingExpenseBeyondHorizon(item, funds)) continue;
    await tx.updateBudgetItem({ ...item, active: false });
    retired += 1;
  }
  return retired;
}

export function assertBudgetItem(row: BudgetItemDraft, funds: Array<Fund | FundBalance>): BudgetItem {
  assertCents(row.amountCents, 'El monto de la partida');
  if (row.amountCents <= 0) {
    throw new DomainError('El monto de la partida debe ser mayor que 0');
  }
  const named = {
    ...row,
    name: row.name.trim(),
    category: row.category.trim(),
  };
  if (!named.name) throw new DomainError('El nombre de la partida no puede quedar vacío');
  const withShares = assertBudgetShares(named);
  assertOperatingBudgetFrequency(withShares, funds);
  return withShares;
}

export async function saveBudgetItem(tx: LedgerTx, input: BudgetItemDraft, isNew: boolean): Promise<BudgetItem> {
  const funds = await tx.listFunds();
  const row = assertBudgetItem(input, funds);
  const existing = await tx.getBudgetItem(row.id);
  if (isNew) {
    if (existing) throw new DomainError('Ya existe una partida con ese id');
    await tx.insertBudgetItem(row);
    return row;
  }
  if (!existing) throw new DomainError('Partida de presupuesto no encontrada');
  await tx.updateBudgetItem(row);
  return row;
}

export async function removeBudgetItem(
  tx: LedgerTx,
  budgetItemId: string,
): Promise<{ outcome: 'deleted' } | { outcome: 'deactivated' }> {
  const item = await tx.getBudgetItem(budgetItemId);
  if (!item) throw new DomainError('Partida de presupuesto no encontrada');
  if (item.active) {
    await tx.updateBudgetItem({ ...item, active: false });
    return { outcome: 'deactivated' };
  }
  await tx.deleteBudgetItem(budgetItemId);
  return { outcome: 'deleted' };
}

/** Recarga quincenal de mini-fondos desde el disponible de su cuenta. No es GASTO. */
export async function injectBudgetedFortnightReserves(
  tx: LedgerTx,
  input: { note?: string; occurredAt?: string } = {},
): Promise<string[]> {
  const items = (await tx.listBudgetItems()).filter(
    (item) => item.active && item.frequency === 'QUINCENAL' && item.coverFundId,
  );
  const posted: string[] = [];
  for (const item of items) {
    const fund = await tx.getFund(item.coverFundId!);
    if (!fund || isSavingsFund(fund)) continue;
    posted.push(
      await postReserva(tx, {
        fundId: fund.id,
        amountCents: item.amountCents,
        note: input.note?.trim() || `Ingreso de fondo presupuestado · ${item.name}`,
        occurredAt: input.occurredAt,
      }),
    );
  }
  if (posted.length === 0) {
    throw new DomainError('No hay mini-fondos quincenales con disponible para recargar');
  }
  return posted;
}

/** Vacía el apartado de un fondo hacia una cuenta destino de liberación. No es gasto. */
export async function emptyFundToAvailable(
  tx: LedgerTx,
  input: { fundId: string; toAccountId: string; note?: string; occurredAt?: string },
): Promise<string[]> {
  const fund = await tx.getFund(input.fundId);
  if (!fund) throw new DomainError('Fondo no encontrado');
  if (!input.toAccountId.trim()) {
    throw new DomainError('Elige la cuenta destino de la liberación');
  }
  const reservations = (await tx.listActiveReservations()).filter((row) => row.fundId === fund.id);
  if (reservations.length === 0) {
    throw new DomainError(`El fondo ${fund.name} ya está vacío`);
  }
  const ids: string[] = [];
  for (const reservation of reservations) {
    ids.push(
      await postLiberacion(tx, {
        reservationId: reservation.id,
        toAccountId: input.toAccountId,
        note: input.note?.trim() || `Vaciar ${fund.name} al disponible`,
        occurredAt: input.occurredAt,
      }),
    );
  }
  return ids;
}

/** Vacía uno o varios fondos hacia una cuenta de desembolso. No es gasto. */
export async function emptyFundsToAvailable(
  tx: LedgerTx,
  input: { fundIds: string[]; toAccountId: string; note?: string; occurredAt?: string },
): Promise<string[]> {
  const unique = [...new Set(input.fundIds.filter((id) => id.trim().length > 0))];
  if (unique.length === 0) {
    throw new DomainError('Elige al menos un fondo para vaciar');
  }
  if (!input.toAccountId.trim()) {
    throw new DomainError('Elige la cuenta destino de la liberación');
  }
  const ids: string[] = [];
  let emptied = 0;
  for (const fundId of unique) {
    const fund = await tx.getFund(fundId);
    if (!fund) throw new DomainError('Fondo no encontrado');
    const reserved = (await tx.listActiveReservations()).filter((row) => row.fundId === fund.id);
    if (reserved.length === 0) continue;
    ids.push(
      ...(await emptyFundToAvailable(tx, {
        fundId,
        toAccountId: input.toAccountId,
        note: input.note,
        occurredAt: input.occurredAt,
      })),
    );
    emptied += 1;
  }
  if (emptied === 0) {
    throw new DomainError('Esos fondos ya están vacíos');
  }
  return ids;
}

/** Vacía el fondo y cubre el gasto con el sobrante de la cuenta. La vaciada no es GASTO. */
export async function emptyFundThenSpendFromLeftover(
  tx: LedgerTx,
  input: {
    fundId: string;
    accountId: string;
    amountCents: Cents;
    note?: string;
    occurredAt?: string;
  },
): Promise<{ releaseIds: string[]; gastoTransactionId: string }> {
  const fund = await tx.getFund(input.fundId);
  if (!fund) throw new DomainError('Fondo no encontrado');
  if (fund.accountId !== input.accountId) {
    throw new DomainError('El fondo no pertenece a esa cuenta');
  }
  const reserved = (await tx.listActiveReservations())
    .filter((row) => row.fundId === fund.id)
    .reduce((sum, row) => sum + row.amountCents, 0);
  const releaseIds =
    reserved > 0
      ? await emptyFundToAvailable(tx, {
          fundId: fund.id,
          toAccountId: fund.accountId,
          note: input.note,
          occurredAt: input.occurredAt,
        })
      : [];
  const gastoTransactionId = await postGasto(tx, {
    accountId: input.accountId,
    amountCents: input.amountCents,
    fundId: null,
    note: input.note,
    occurredAt: input.occurredAt,
  });
  return { releaseIds, gastoTransactionId };
}
