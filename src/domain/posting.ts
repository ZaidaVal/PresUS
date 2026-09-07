import { assertCents, formatUsd, type Cents } from './money';
import {
  accountBalanceFromSplits,
  assertFundsWithinAccount,
  cardBalanceFromSplits,
  chargesFromPostedTransactions,
  computeAccountBalances,
} from './balances';
import { DomainError, type LedgerTx } from './ledger';
import type {
  BudgetCoverMode,
  CardChargeClass,
  Period,
  SplitRole,
  SplitRow,
  TransactionRow,
  TransactionType,
} from './types';
import {
  planDebtPayment,
  remainingDebtCents,
} from './debts';
import {
  assertChargeFitsCardAndLine,
  cardsOnSameLine,
  lineSpentFromOwed,
  normalizeCreditCard,
} from './creditLine';
import { isBarrasAccount } from './segments';
import { assertAllowedReleaseDestination } from './releaseDestinations';

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

function periodFromDate(iso: string): Period {
  const day = new Date(iso).getUTCDate();
  return day <= 15 ? 'Q1' : 'Q2';
}

function assertPositive(amount: Cents) {
  assertCents(amount);
  if (amount <= 0) throw new DomainError('El monto debe ser mayor que cero');
}

function insufficientAccountAvailableMessage(
  accountName: string,
  availableCents: Cents,
  requestedCents: Cents,
): string {
  return `No hay disponible suficiente en ${accountName}: hay ${formatUsd(availableCents)} y pides ${formatUsd(requestedCents)}`;
}

function assertSplitsBalance(splits: Array<{ amountCents: Cents }>) {
  const total = splits.reduce((sum, split) => sum + split.amountCents, 0);
  if (total !== 0) {
    throw new DomainError('Los splits de la transacción no cuadran (suma ≠ 0)');
  }
}

async function insertPosted(
  tx: LedgerTx,
  input: {
    type: TransactionType;
    occurredAt?: string;
    note?: string;
    reversesId?: string | null;
    splits: Array<{
      accountId?: string | null;
      fundId?: string | null;
      personId?: string | null;
      cardId?: string | null;
      amountCents: Cents;
      role: SplitRole;
    }>;
  },
) {
  assertSplitsBalance(input.splits);
  const occurredAt = input.occurredAt ?? nowIso();
  const transactionId = newId();
  await tx.insertTransaction({
    id: transactionId,
    type: input.type,
    occurredAt,
    period: periodFromDate(occurredAt),
    note: input.note ?? '',
    createdAt: nowIso(),
    status: 'POSTED',
    reversesId: input.reversesId ?? null,
  });
  for (const split of input.splits) {
    assertCents(split.amountCents);
    await tx.insertSplit({
      id: newId(),
      transactionId,
      accountId: split.accountId ?? null,
      fundId: split.fundId ?? null,
      personId: split.personId ?? null,
      cardId: split.cardId ?? null,
      amountCents: split.amountCents,
      role: split.role,
    });
  }
  return transactionId;
}

async function reservedOnAccount(tx: LedgerTx, accountId: string): Promise<Cents> {
  const funds = await tx.listFundsByAccount(accountId);
  const reservations = await tx.listActiveReservations();
  const fundIds = new Set(funds.map((fund) => fund.id));
  return reservations
    .filter((row) => fundIds.has(row.fundId))
    .reduce((sum, row) => sum + row.amountCents, 0);
}

async function reservedOnFund(tx: LedgerTx, fundId: string): Promise<Cents> {
  const reservations = await tx.listActiveReservations();
  return reservations
    .filter((row) => row.fundId === fundId)
    .reduce((sum, row) => sum + row.amountCents, 0);
}

async function accountSaldo(tx: LedgerTx, accountId: string): Promise<Cents> {
  const splits = await tx.listPostedSplitsForAccount(accountId);
  return accountBalanceFromSplits(accountId, splits);
}

async function assertAccountConstraint(tx: LedgerTx, accountId: string) {
  const saldo = await accountSaldo(tx, accountId);
  const reserved = await reservedOnAccount(tx, accountId);
  assertFundsWithinAccount(saldo, reserved);
}

async function consumeFromFund(tx: LedgerTx, fundId: string, amount: Cents) {
  const reservations = (await tx.listActiveReservations())
    .filter((row) => row.fundId === fundId)
    .sort((a, b) => a.sourceTransactionId.localeCompare(b.sourceTransactionId));
  let remaining = amount;
  for (const reservation of reservations) {
    if (remaining <= 0) break;
    if (reservation.amountCents <= remaining) {
      remaining -= reservation.amountCents;
      await tx.updateReservationStatus(reservation.id, 'CONSUMED');
    } else {
      await tx.updateReservation({
        ...reservation,
        amountCents: reservation.amountCents - remaining,
      });
      remaining = 0;
    }
  }
  if (remaining > 0) {
    throw new DomainError('No hay apartado suficiente en el fondo');
  }
}

export async function postIngreso(
  tx: LedgerTx,
  input: { accountId: string; amountCents: Cents; note?: string; occurredAt?: string },
) {
  assertPositive(input.amountCents);
  const account = await tx.getAccount(input.accountId);
  if (!account) throw new DomainError('Cuenta no encontrada');
  if (account.visibility === 'PRIVATE') {
    throw new DomainError('No se registran ingresos en cuentas privadas');
  }
  return insertPosted(tx, {
    type: 'INGRESO',
    note: input.note,
    occurredAt: input.occurredAt,
    splits: [
      { accountId: account.id, amountCents: input.amountCents, role: 'DESTINATION' },
      { amountCents: -input.amountCents, role: 'EQUITY' },
    ],
  });
}

export async function postGasto(
  tx: LedgerTx,
  input: {
    accountId: string;
    amountCents: Cents;
    fundId?: string | null;
    /** Cuánto del gasto consume el apartado del fondo. Por defecto, el total si hay fondo. */
    consumeFromFundCents?: Cents;
    note?: string;
    occurredAt?: string;
  },
) {
  assertPositive(input.amountCents);
  const account = await tx.getAccount(input.accountId);
  if (!account) throw new DomainError('Cuenta no encontrada');
  if (account.visibility === 'PRIVATE') {
    throw new DomainError('Las cuentas privadas no llevan ledger de gastos');
  }
  const consumeCents =
    input.consumeFromFundCents != null
      ? input.consumeFromFundCents
      : input.fundId
        ? input.amountCents
        : 0;
  assertCents(consumeCents, 'Lo cubierto con apartado');
  if (consumeCents < 0) {
    throw new DomainError('Lo cubierto con apartado no puede ser negativo');
  }
  if (consumeCents > input.amountCents) {
    throw new DomainError('No se puede cubrir con apartado más que el gasto');
  }
  if (consumeCents > 0 && !input.fundId) {
    throw new DomainError('Indica el fondo para consumir el apartado');
  }
  if (input.fundId) {
    const fund = await tx.getFund(input.fundId);
    if (!fund || fund.accountId !== account.id) {
      throw new DomainError('El fondo no pertenece a la cuenta');
    }
    if (consumeCents > 0) {
      await consumeFromFund(tx, fund.id, consumeCents);
    }
    const saldo = await accountSaldo(tx, account.id);
    const reserved = await reservedOnAccount(tx, account.id);
    if (saldo - reserved < input.amountCents) {
      throw new DomainError('No hay disponible suficiente en la cuenta para el resto del gasto');
    }
  } else {
    const saldo = await accountSaldo(tx, account.id);
    const reserved = await reservedOnAccount(tx, account.id);
    if (saldo - reserved < input.amountCents) {
      throw new DomainError('No hay disponible suficiente (el apartado no se toca)');
    }
  }
  const id = await insertPosted(tx, {
    type: 'GASTO',
    note: input.note,
    occurredAt: input.occurredAt,
    splits: [
      { accountId: account.id, fundId: input.fundId ?? null, amountCents: -input.amountCents, role: 'SOURCE' },
      { amountCents: input.amountCents, role: 'EQUITY' },
    ],
  });
  await assertAccountConstraint(tx, account.id);
  return id;
}

/** Gasto X en efectivo: no toca Barras ni fondos de casa. */
export async function postGastoX(
  tx: LedgerTx,
  input: { accountId: string; amountCents: Cents; note?: string; occurredAt?: string },
) {
  const account = await tx.getAccount(input.accountId);
  if (!account) throw new DomainError('Cuenta no encontrada');
  if (isBarrasAccount(account)) {
    throw new DomainError('Gastos X no se mezclan con Barras');
  }
  return postGasto(tx, {
    accountId: input.accountId,
    amountCents: input.amountCents,
    fundId: null,
    note: input.note,
    occurredAt: input.occurredAt,
  });
}

export async function postTransferencia(
  tx: LedgerTx,
  input: {
    fromAccountId: string;
    toAccountId: string;
    amountCents: Cents;
    fromFundId?: string | null;
    toFundId?: string | null;
    note?: string;
    occurredAt?: string;
  },
) {
  assertPositive(input.amountCents);
  if (input.fromAccountId === input.toAccountId && !input.fromFundId && !input.toFundId) {
    throw new DomainError('Una transferencia necesita dos cuentas o dos fondos');
  }
  const from = await tx.getAccount(input.fromAccountId);
  const to = await tx.getAccount(input.toAccountId);
  if (!from || !to) throw new DomainError('Cuenta no encontrada');
  if (from.visibility === 'PRIVATE' || to.visibility === 'PRIVATE') {
    throw new DomainError('Usa APORTE para mover dinero desde una persona hacia el sistema');
  }

  if (input.fromFundId) {
    const fund = await tx.getFund(input.fromFundId);
    if (!fund || fund.accountId !== from.id) throw new DomainError('Fondo origen inválido');
    await assertAllowedReleaseDestination(tx, to.id);
    await consumeFromFund(tx, fund.id, input.amountCents);
  } else {
    const saldo = await accountSaldo(tx, from.id);
    const reserved = await reservedOnAccount(tx, from.id);
    const availableCents = saldo - reserved;
    if (availableCents < input.amountCents) {
      const base = insufficientAccountAvailableMessage(from.name, availableCents, input.amountCents);
      throw new DomainError(
        reserved > 0
          ? `${base}. Elige un fondo origen para mover el apartado; el disponible de cuenta no lo incluye.`
          : base,
      );
    }
  }

  const splits: Array<{
    accountId?: string | null;
    fundId?: string | null;
    amountCents: Cents;
    role: SplitRole;
  }> = [
    { accountId: from.id, fundId: input.fromFundId ?? null, amountCents: -input.amountCents, role: 'SOURCE' },
    { accountId: to.id, fundId: input.toFundId ?? null, amountCents: input.amountCents, role: 'DESTINATION' },
  ];

  const id = await insertPosted(tx, {
    type: 'TRANSFERENCIA',
    note: input.note,
    occurredAt: input.occurredAt,
    splits,
  });

  if (input.toFundId) {
    const fund = await tx.getFund(input.toFundId);
    if (!fund || fund.accountId !== to.id) throw new DomainError('Fondo destino inválido');
    await tx.insertReservation({
      id: newId(),
      fundId: fund.id,
      sourceTransactionId: id,
      amountCents: input.amountCents,
      status: 'ACTIVE',
    });
  }

  await assertAccountConstraint(tx, from.id);
  await assertAccountConstraint(tx, to.id);
  return id;
}

export async function postAporte(
  tx: LedgerTx,
  input: {
    personId: string;
    toAccountId: string;
    amountCents: Cents;
    note?: string;
    occurredAt?: string;
  },
) {
  assertPositive(input.amountCents);
  const person = await tx.getPerson(input.personId);
  const account = await tx.getAccount(input.toAccountId);
  if (!person) throw new DomainError('Persona no encontrada');
  if (!account) throw new DomainError('Cuenta no encontrada');
  if (account.visibility !== 'PUBLIC') {
    throw new DomainError('Un aporte debe ir a una cuenta pública');
  }
  return insertPosted(tx, {
    type: 'APORTE',
    note: input.note,
    occurredAt: input.occurredAt,
    splits: [
      { accountId: account.id, personId: person.id, amountCents: input.amountCents, role: 'DESTINATION' },
      { personId: person.id, amountCents: -input.amountCents, role: 'EQUITY' },
    ],
  });
}

export async function postReserva(
  tx: LedgerTx,
  input: { fundId: string; amountCents: Cents; note?: string; occurredAt?: string },
) {
  assertPositive(input.amountCents);
  const fund = await tx.getFund(input.fundId);
  if (!fund) throw new DomainError('Fondo no encontrado');
  const saldo = await accountSaldo(tx, fund.accountId);
  const reserved = await reservedOnAccount(tx, fund.accountId);
  if (saldo - reserved < input.amountCents) {
    throw new DomainError('No hay disponible para apartar');
  }
  const id = await insertPosted(tx, {
    type: 'RESERVA',
    note: input.note,
    occurredAt: input.occurredAt,
    splits: [
      { fundId: fund.id, accountId: fund.accountId, amountCents: input.amountCents, role: 'RESERVE' },
      { amountCents: -input.amountCents, role: 'EQUITY' },
    ],
  });
  await tx.insertReservation({
    id: newId(),
    fundId: fund.id,
    sourceTransactionId: id,
    amountCents: input.amountCents,
    status: 'ACTIVE',
  });
  await assertAccountConstraint(tx, fund.accountId);
  return id;
}

export async function coverCashExpenseFromFund(
  tx: LedgerTx,
  input: {
    accountId: string;
    fundId: string;
    amountCents: Cents;
    mode: BudgetCoverMode;
    note?: string;
    occurredAt?: string;
  },
): Promise<{ reservaTransactionId: string | null; gastoTransactionId: string | null }> {
  assertPositive(input.amountCents);
  const account = await tx.getAccount(input.accountId);
  if (!account) throw new DomainError('Cuenta no encontrada');
  if (account.visibility === 'PRIVATE') {
    throw new DomainError('Las cuentas privadas no llevan ledger de gastos');
  }
  const fund = await tx.getFund(input.fundId);
  if (!fund) throw new DomainError('Fondo no encontrado');
  if (fund.accountId !== account.id) {
    const fundAccount = await tx.getAccount(fund.accountId);
    throw new DomainError(
      `El fondo ${fund.name} pertenece a ${fundAccount?.name ?? 'otra cuenta'}, no a ${account.name}. No se cubre un gasto de una cuenta con el apartado de otra.`,
    );
  }

  const reserved = await reservedOnFund(tx, fund.id);
  const saldo = await accountSaldo(tx, account.id);
  const reservedOnThisAccount = await reservedOnAccount(tx, account.id);
  const available = saldo - reservedOnThisAccount;

  if (input.mode === 'RESERVE_ONLY') {
    if (available < input.amountCents) {
      throw new DomainError(
        `No hay disponible en ${account.name} para retener ${formatUsd(input.amountCents)} en ${fund.name}.`,
      );
    }
    const reservaTransactionId = await postReserva(tx, {
      fundId: fund.id,
      amountCents: input.amountCents,
      note: input.note,
      occurredAt: input.occurredAt,
    });
    return { reservaTransactionId, gastoTransactionId: null };
  }

  if (reserved >= input.amountCents) {
    const gastoTransactionId = await postGasto(tx, {
      accountId: account.id,
      fundId: fund.id,
      amountCents: input.amountCents,
      note: input.note,
      occurredAt: input.occurredAt,
    });
    return { reservaTransactionId: null, gastoTransactionId };
  }

  const shortfall = input.amountCents - reserved;
  if (available < shortfall) {
    throw new DomainError(
      `No hay apartado en ${fund.name} ni disponible en ${account.name} para cubrir ${formatUsd(input.amountCents)}. No se toma el apartado de otros fondos.`,
    );
  }

  const reservaTransactionId = await postReserva(tx, {
    fundId: fund.id,
    amountCents: shortfall,
    note: input.note?.trim() || `Retenido para ${fund.name}`,
    occurredAt: input.occurredAt,
  });
  const gastoTransactionId = await postGasto(tx, {
    accountId: account.id,
    fundId: fund.id,
    amountCents: input.amountCents,
    note: input.note,
    occurredAt: input.occurredAt,
  });
  return { reservaTransactionId, gastoTransactionId };
}

export async function postLiberacion(
  tx: LedgerTx,
  input: {
    reservationId: string;
    amountCents?: Cents;
    note?: string;
    occurredAt?: string;
    toAccountId?: string;
    skipDestinationPolicy?: boolean;
  },
) {
  const reservation = await tx.getReservation(input.reservationId);
  if (!reservation || reservation.status !== 'ACTIVE') {
    throw new DomainError('Reserva activa no encontrada');
  }
  const amount = input.amountCents ?? reservation.amountCents;
  assertPositive(amount);
  if (amount > reservation.amountCents) {
    throw new DomainError('No se puede liberar más de lo apartado');
  }
  const fund = await tx.getFund(reservation.fundId);
  if (!fund) throw new DomainError('Fondo no encontrado');
  const destId = input.toAccountId?.trim() || fund.accountId;
  if (!input.skipDestinationPolicy) {
    await assertAllowedReleaseDestination(tx, destId);
  }
  const id = await insertPosted(tx, {
    type: 'LIBERACION_RESERVA',
    note: input.note,
    occurredAt: input.occurredAt,
    splits: [
      { fundId: fund.id, accountId: fund.accountId, amountCents: -amount, role: 'RESERVE' },
      { amountCents: amount, role: 'EQUITY' },
    ],
  });
  if (amount === reservation.amountCents) {
    await tx.updateReservationStatus(reservation.id, 'RELEASED');
  } else {
    await tx.updateReservation({ ...reservation, amountCents: reservation.amountCents - amount });
  }
  if (destId !== fund.accountId) {
    await postTransferencia(tx, {
      fromAccountId: fund.accountId,
      toAccountId: destId,
      amountCents: amount,
      note: input.note,
      occurredAt: input.occurredAt,
    });
  }
  return id;
}

export async function cardOwedCents(tx: LedgerTx, cardId: string): Promise<Cents> {
  const splits = await tx.listPostedSplits();
  return cardBalanceFromSplits(cardId, splits);
}

async function coverageAvailableOnFund(tx: LedgerTx, fundId: string): Promise<Cents> {
  const reserved = (await tx.listActiveReservations())
    .filter((row) => row.fundId === fundId)
    .reduce((sum, row) => sum + row.amountCents, 0);
  const pending = (await chargesFromPostedTransactions(tx))
    .filter((row) => row.coverFundId === fundId && row.coverageStatus === 'CUBIERTO_PENDIENTE_TRASPASO')
    .reduce((sum, row) => sum + row.amountCents, 0);
  return reserved - pending;
}

export async function postCardCharge(
  tx: LedgerTx,
  input: {
    cardId: string;
    amountCents: Cents;
    coverFundId?: string | null;
    chargeClass?: CardChargeClass;
    /** Gasto X: clase SHARED_UNBUDGETED y sin cobertura de Ahorros 2 / Barras. */
    gastoX?: boolean;
    /** Cubierto con el sobrante de Barras (no saca efectivo ahora). */
    barrasLeftover?: boolean;
    note?: string;
    occurredAt?: string;
  },
) {
  assertPositive(input.amountCents);
  const found = await tx.getCreditCard(input.cardId);
  if (!found) throw new DomainError('Tarjeta no encontrada');
  const card = normalizeCreditCard(found);
  const payer = await tx.getAccount(card.paymentAccountId);
  if (!payer) throw new DomainError('Cuenta de pago de la tarjeta no encontrada');
  if (!payer.isCardPaymentSource) {
    throw new DomainError('Esta tarjeta se paga solo desde Atlántida');
  }

  const chargeClass = input.gastoX ? 'SHARED_UNBUDGETED' : (input.chargeClass ?? 'SHARED_BUDGETED');
  if (input.gastoX && (input.coverFundId || input.barrasLeftover)) {
    throw new DomainError('Gastos X no se mezclan con Barras');
  }
  if (input.coverFundId) {
    const requested = await tx.getFund(input.coverFundId);
    if (!requested) throw new DomainError('Fondo de cobertura no encontrado');
    const requestedAccount = await tx.getAccount(requested.accountId);
    if (card.coverFundId && requestedAccount && isBarrasAccount(requestedAccount)) {
      throw new DomainError('La tarjeta con límite se cubre con Ahorros 2, no con Barras');
    }
  }

  const allCards = (await tx.listCreditCards()).map(normalizeCreditCard);
  const owedByCard = new Map<string, Cents>();
  for (const row of allCards) {
    owedByCard.set(row.id, await cardOwedCents(tx, row.id));
  }
  const owed = owedByCard.get(card.id) ?? 0;
  const lineLimit = card.creditLineLimitCents ?? null;
  const lineSpent =
    lineLimit != null ? lineSpentFromOwed(cardsOnSameLine(card, allCards), owedByCard) : owed;
  assertChargeFitsCardAndLine({
    amountCents: input.amountCents,
    cardOwedCents: owed,
    cardCapCents: card.creditLimitCents ?? null,
    lineLimitCents: lineLimit,
    lineSpentCents: lineSpent,
  });

  let coverFundId: string | null = null;
  let coverageStatus: 'SIN_COBERTURA' | 'CUBIERTO_PENDIENTE_TRASPASO' = 'SIN_COBERTURA';

  if (input.gastoX) {
    coverFundId = null;
    coverageStatus = 'SIN_COBERTURA';
  } else if (input.barrasLeftover && !card.coverFundId) {
    coverFundId = null;
    coverageStatus = 'CUBIERTO_PENDIENTE_TRASPASO';
  } else if (card.coverFundId) {
    if (input.coverFundId && input.coverFundId !== card.coverFundId) {
      throw new DomainError('La tarjeta con límite se cubre con Ahorros 2, no con otro fondo');
    }
    const cover = await tx.getFund(card.coverFundId);
    if (!cover) throw new DomainError('El fondo de cobertura de la tarjeta no existe');
    const coverAccount = await tx.getAccount(cover.accountId);
    if (coverAccount && isBarrasAccount(coverAccount)) {
      throw new DomainError('Gastos de tarjeta no se mezclan con Barras');
    }
    const available = await coverageAvailableOnFund(tx, cover.id);
    if (available < input.amountCents) {
      throw new DomainError('No hay cobertura suficiente en Ahorros 2');
    }
    coverFundId = cover.id;
    coverageStatus = 'CUBIERTO_PENDIENTE_TRASPASO';
  } else if (input.coverFundId) {
    coverFundId = input.coverFundId;
    coverageStatus = 'CUBIERTO_PENDIENTE_TRASPASO';
  }

  const transactionId = await insertPosted(tx, {
    type: 'GASTO',
    note: input.note ?? `Cargo ${card.name}`,
    occurredAt: input.occurredAt,
    splits: [
      { cardId: card.id, amountCents: -input.amountCents, role: 'SOURCE' },
      { amountCents: input.amountCents, role: 'EQUITY' },
    ],
  });
  await tx.insertCardCharge({
    id: newId(),
    cardId: card.id,
    transactionId,
    amountCents: input.amountCents,
    chargeClass,
    coverageStatus,
    coverFundId,
  });
  return transactionId;
}

export async function postCardPayment(
  tx: LedgerTx,
  input: { cardId: string; fromAccountId: string; amountCents: Cents; note?: string; occurredAt?: string },
) {
  assertPositive(input.amountCents);
  const card = await tx.getCreditCard(input.cardId);
  if (!card) throw new DomainError('Tarjeta no encontrada');
  const from = await tx.getAccount(input.fromAccountId);
  if (!from) throw new DomainError('Cuenta no encontrada');
  if (!from.isCardPaymentSource || from.id !== card.paymentAccountId) {
    throw new DomainError('La tarjeta se paga solo desde Atlántida');
  }
  const owed = await cardOwedCents(tx, card.id);
  if (input.amountCents > owed) {
    throw new DomainError('No se puede pagar más de lo que debe la tarjeta');
  }
  const saldo = await accountSaldo(tx, from.id);
  const reserved = await reservedOnAccount(tx, from.id);
  if (saldo - reserved < input.amountCents) {
    throw new DomainError('No hay disponible en Atlántida para pagar la tarjeta');
  }
  const id = await insertPosted(tx, {
    type: 'PAGO_DEUDA',
    note: input.note ?? `Pago ${card.name}`,
    occurredAt: input.occurredAt,
    splits: [
      { accountId: from.id, amountCents: -input.amountCents, role: 'SOURCE' },
      { cardId: card.id, amountCents: input.amountCents, role: 'DESTINATION' },
    ],
  });
  let remaining = input.amountCents;
  const charges = (await chargesFromPostedTransactions(tx))
    .filter((row) => row.cardId === card.id && row.coverageStatus !== 'TRANSFERIDO_A_ATLANTIDA')
    .sort((a, b) => a.transactionId.localeCompare(b.transactionId));
  for (const charge of charges) {
    if (remaining <= 0) break;
    remaining -= charge.amountCents;
    await tx.updateCardCharge({ ...charge, coverageStatus: 'TRANSFERIDO_A_ATLANTIDA' });
  }
  await assertAccountConstraint(tx, from.id);
  return id;
}

export async function postPagoDeuda(
  tx: LedgerTx,
  input: { debtId: string; amountCents: Cents; accountId?: string; note?: string; occurredAt?: string },
) {
  assertPositive(input.amountCents);
  const debt = await tx.getDebt(input.debtId);
  if (!debt) throw new DomainError('Deuda no encontrada');
  if (!debt.active) throw new DomainError('La deuda no está activa');
  const payments = await tx.listDebtPaymentsByDebt(debt.id);
  const transactions = await tx.listTransactions();
  const remainingCents = remainingDebtCents(debt.originalCents, payments, transactions);
  const plan = planDebtPayment({
    debt,
    remainingCents,
    amountCents: input.amountCents,
  });
  if (plan.principalCents + plan.interestCents !== input.amountCents) {
    throw new DomainError('El pago no cuadra entre interés y capital');
  }

  const accountId = input.accountId ?? debt.paymentAccountId;
  if (!accountId) throw new DomainError('Indica la cuenta de pago');
  const account = await tx.getAccount(accountId);
  if (!account) throw new DomainError('Cuenta no encontrada');
  if (account.visibility === 'PRIVATE') {
    throw new DomainError('La cuenta de pago no puede ser privada');
  }

  let consumeCents = 0;
  let fundId: string | null = null;
  if (debt.coverFundId) {
    const fund = await tx.getFund(debt.coverFundId);
    if (fund && fund.accountId === account.id) {
      const reserved = await reservedOnFund(tx, fund.id);
      consumeCents = Math.min(reserved, input.amountCents);
      if (consumeCents > 0) {
        fundId = fund.id;
        await consumeFromFund(tx, fund.id, consumeCents);
      }
    }
  }
  const saldo = await accountSaldo(tx, account.id);
  const reserved = await reservedOnAccount(tx, account.id);
  if (saldo - reserved < input.amountCents - consumeCents) {
    throw new DomainError('No hay disponible suficiente para pagar la deuda');
  }

  const occurredAt = input.occurredAt ?? nowIso();
  const id = await insertPosted(tx, {
    type: 'PAGO_DEUDA',
    note: input.note ?? `Pago ${debt.name}`,
    occurredAt,
    splits: [
      {
        accountId: account.id,
        fundId,
        amountCents: -input.amountCents,
        role: 'SOURCE',
      },
      { amountCents: input.amountCents, role: 'EQUITY' },
    ],
  });
  await tx.insertDebtPayment({
    id: newId(),
    debtId: debt.id,
    transactionId: id,
    principalCents: plan.principalCents,
    interestCents: plan.interestCents,
    occurredAt,
  });
  if (plan.remainingAfterCents === 0 && debt.active) {
    await tx.updateDebt({ ...debt, active: false });
  }
  await assertAccountConstraint(tx, account.id);
  return id;
}

export async function postAjuste(
  tx: LedgerTx,
  input: { accountId: string; amountCents: Cents; note?: string; occurredAt?: string },
) {
  assertCents(input.amountCents, 'ajuste');
  if (input.amountCents === 0) throw new DomainError('El ajuste no puede ser cero');
  const account = await tx.getAccount(input.accountId);
  if (!account) throw new DomainError('Cuenta no encontrada');
  const id = await insertPosted(tx, {
    type: 'AJUSTE',
    note: input.note ?? 'Ajuste de apertura o conciliación',
    occurredAt: input.occurredAt,
    splits: [
      { accountId: account.id, amountCents: input.amountCents, role: input.amountCents > 0 ? 'DESTINATION' : 'SOURCE' },
      { amountCents: -input.amountCents, role: 'EQUITY' },
    ],
  });
  await assertAccountConstraint(tx, account.id);
  return id;
}

export async function setAccountBase(
  tx: LedgerTx,
  input: { accountId: string; targetCents: Cents; note?: string; occurredAt?: string },
) {
  assertCents(input.targetCents, 'saldo base');
  if (input.targetCents < 0) throw new DomainError('El saldo base no puede ser negativo');
  const current = await accountSaldo(tx, input.accountId);
  const delta = input.targetCents - current;
  if (delta === 0) throw new DomainError('Ese ya es el saldo de la cuenta');
  return postAjuste(tx, {
    accountId: input.accountId,
    amountCents: delta,
    note: input.note?.trim() || `Base ${formatUsd(current)} → ${formatUsd(input.targetCents)}`,
    occurredAt: input.occurredAt,
  });
}

export function planCardOwedCuadre(
  appCents: Cents,
  informedCents: Cents,
): { appCents: Cents; informedCents: Cents; diffCents: Cents; summary: string } {
  assertCents(appCents, 'debe en la app');
  assertCents(informedCents, 'debe informado');
  if (informedCents < 0) {
    throw new DomainError('El debe informado no puede ser negativo');
  }
  const diffCents = informedCents - appCents;
  if (diffCents === 0) {
    throw new DomainError('Ya cuadra: la app ya tiene ese debe');
  }
  const signed = diffCents > 0 ? formatUsd(diffCents) : `−${formatUsd(-diffCents)}`;
  return {
    appCents,
    informedCents,
    diffCents,
    summary: `App tiene ${formatUsd(appCents)}, tú indicas ${formatUsd(informedCents)}, se registrará un ajuste de ${signed}.`,
  };
}

/** Ajuste del debe de una tarjeta. No es cargo: no toca Barras ni crea gasto del mes. */
export async function postCardAjuste(
  tx: LedgerTx,
  input: { cardId: string; amountCents: Cents; note?: string; occurredAt?: string },
) {
  assertCents(input.amountCents, 'ajuste de tarjeta');
  if (input.amountCents === 0) throw new DomainError('El ajuste no puede ser cero');
  const card = await tx.getCreditCard(input.cardId);
  if (!card) throw new DomainError('Tarjeta no encontrada');
  const payer = await tx.getAccount(card.paymentAccountId);
  if (!payer) throw new DomainError('Cuenta de pago de la tarjeta no encontrada');
  if (!payer.isCardPaymentSource) {
    throw new DomainError('Esta tarjeta se paga solo desde Atlántida');
  }
  const cardSplit = -input.amountCents;
  return insertPosted(tx, {
    type: 'AJUSTE',
    note: input.note ?? `Cuadre ${card.name}`,
    occurredAt: input.occurredAt,
    splits: [
      { cardId: card.id, amountCents: cardSplit, role: cardSplit > 0 ? 'DESTINATION' : 'SOURCE' },
      { amountCents: -cardSplit, role: 'EQUITY' },
    ],
  });
}

export async function setCardOwedBase(
  tx: LedgerTx,
  input: { cardId: string; targetCents: Cents; note?: string; occurredAt?: string },
) {
  assertCents(input.targetCents, 'debe informado');
  if (input.targetCents < 0) throw new DomainError('El debe no puede ser negativo');
  const card = await tx.getCreditCard(input.cardId);
  if (!card) throw new DomainError('Tarjeta no encontrada');
  const current = await cardOwedCents(tx, card.id);
  const plan = planCardOwedCuadre(current, input.targetCents);
  return postCardAjuste(tx, {
    cardId: card.id,
    amountCents: plan.diffCents,
    note: input.note?.trim() || `Cuadre ${card.name}: ${plan.summary}`,
    occurredAt: input.occurredAt,
  });
}

export function assertMutableTransaction(row: TransactionRow) {
  if (row.reversesId) {
    throw new DomainError('No se puede anular una anulación');
  }
  if (row.status === 'VOID') {
    throw new DomainError('El movimiento ya está anulado');
  }
}

async function restoreLiberatedReservation(tx: LedgerTx, splits: SplitRow[]) {
  const reserveSplit = splits.find((split) => split.role === 'RESERVE' && split.fundId);
  if (!reserveSplit?.fundId) return;
  const liberated = -reserveSplit.amountCents;
  if (liberated <= 0) return;
  const forFund = (await tx.listReservations()).filter((row) => row.fundId === reserveSplit.fundId);
  const released =
    forFund.find((row) => row.status === 'RELEASED' && row.amountCents === liberated) ??
    forFund.find((row) => row.status === 'RELEASED');
  if (released) {
    await tx.updateReservation({ ...released, status: 'ACTIVE', amountCents: liberated });
    return;
  }
  const active = forFund.find((row) => row.status === 'ACTIVE');
  if (active) {
    await tx.updateReservation({ ...active, amountCents: active.amountCents + liberated });
  }
}

async function restorePaidCardCharges(tx: LedgerTx, cardId: string, amountCents: Cents) {
  let remaining = amountCents;
  const transferred = (await tx.listCardCharges())
    .filter((row) => row.cardId === cardId && row.coverageStatus === 'TRANSFERIDO_A_ATLANTIDA')
    .sort((left, right) => right.transactionId.localeCompare(left.transactionId));
  for (const charge of transferred) {
    if (remaining <= 0) break;
    remaining -= charge.amountCents;
    await tx.updateCardCharge({
      ...charge,
      coverageStatus: charge.coverFundId ? 'CUBIERTO_PENDIENTE_TRASPASO' : 'SIN_COBERTURA',
    });
  }
}

export async function voidTransaction(tx: LedgerTx, transactionId: string) {
  const original = await tx.getTransaction(transactionId);
  if (!original) throw new DomainError('Transacción no encontrada');
  assertMutableTransaction(original);
  const splits = await tx.listSplitsForTransaction(transactionId);
  const charges = (await tx.listCardCharges()).filter((row) => row.transactionId === transactionId);
  for (const charge of charges) {
    if (charge.coverageStatus === 'TRANSFERIDO_A_ATLANTIDA') {
      throw new DomainError('No se puede anular un cargo ya pagado desde Atlántida');
    }
  }

  const inverseSplits = splits.map((split) => ({
    accountId: split.accountId,
    fundId: split.fundId,
    personId: split.personId,
    cardId: split.cardId,
    amountCents: -split.amountCents,
    role: split.role,
  }));
  await tx.updateTransactionStatus(transactionId, 'VOID');
  const inverseId = await insertPosted(tx, {
    type: original.type,
    note: `Anulación de ${transactionId}`,
    reversesId: transactionId,
    splits: inverseSplits,
  });
  await tx.updateTransactionStatus(inverseId, 'VOID');

  const reservations = await tx.listReservations();
  for (const reservation of reservations) {
    if (reservation.sourceTransactionId === transactionId && reservation.status === 'ACTIVE') {
      await tx.updateReservationStatus(reservation.id, 'RELEASED');
    }
  }

  if (original.type === 'GASTO' || original.type === 'TRANSFERENCIA' || original.type === 'PAGO_DEUDA') {
    for (const split of splits) {
      if (split.role === 'SOURCE' && split.fundId && split.amountCents < 0) {
        await tx.insertReservation({
          id: newId(),
          fundId: split.fundId,
          sourceTransactionId: inverseId,
          amountCents: -split.amountCents,
          status: 'ACTIVE',
        });
      }
    }
  }

  if (original.type === 'LIBERACION_RESERVA') {
    await restoreLiberatedReservation(tx, splits);
  }

  if (original.type === 'PAGO_DEUDA') {
    const cardSplit = splits.find((split) => split.cardId);
    const amount = Math.abs(cardSplit?.amountCents ?? 0);
    if (cardSplit?.cardId && amount > 0) {
      await restorePaidCardCharges(tx, cardSplit.cardId, amount);
    }
    const payment = (await tx.listDebtPayments()).find((row) => row.transactionId === transactionId);
    if (payment) {
      const debt = await tx.getDebt(payment.debtId);
      if (debt && !debt.active) {
        await tx.updateDebt({ ...debt, active: true });
      }
    }
  }

  return inverseId;
}

export async function changeReservationAmount(
  tx: LedgerTx,
  input: { reservationId: string; amountCents: Cents; note?: string; occurredAt?: string },
) {
  const reservation = await tx.getReservation(input.reservationId);
  if (!reservation || reservation.status !== 'ACTIVE') {
    throw new DomainError('Reserva activa no encontrada');
  }
  assertPositive(input.amountCents);
  if (input.amountCents === reservation.amountCents) {
    throw new DomainError('Ese ya es el monto apartado');
  }
  const note = input.note?.trim() || 'Cambio de apartado';
  await postLiberacion(tx, {
    reservationId: reservation.id,
    amountCents: reservation.amountCents,
    note,
    occurredAt: input.occurredAt,
    skipDestinationPolicy: true,
  });
  return postReserva(tx, {
    fundId: reservation.fundId,
    amountCents: input.amountCents,
    note,
    occurredAt: input.occurredAt,
  });
}

export type MovementCorrection = {
  type: string;
  amountCents: Cents;
  note?: string;
  occurredAt?: string;
  accountId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  fundId?: string | null;
  toFundId?: string | null;
  personId?: string;
  cardId?: string;
  reservationId?: string;
  chargeClass?: CardChargeClass;
  budgetCoverMode?: BudgetCoverMode;
  debtId?: string;
};

export async function correctTransaction(
  tx: LedgerTx,
  originalId: string,
  correction: MovementCorrection,
): Promise<string> {
  const original = await tx.getTransaction(originalId);
  if (!original) throw new DomainError('Transacción no encontrada');
  assertMutableTransaction(original);
  await voidTransaction(tx, originalId);
  const note = correction.note;
  const occurredAt = correction.occurredAt;
  const amountCents = correction.amountCents;
  switch (correction.type) {
    case 'INGRESO':
      if (!correction.accountId) throw new DomainError('Cuenta no encontrada');
      return postIngreso(tx, { accountId: correction.accountId, amountCents, note, occurredAt });
    case 'GASTO': {
      if (!correction.accountId) throw new DomainError('Cuenta no encontrada');
      const coverMode = correction.budgetCoverMode;
      if (coverMode && correction.fundId) {
        const covered = await coverCashExpenseFromFund(tx, {
          accountId: correction.accountId,
          fundId: correction.fundId,
          amountCents,
          mode: coverMode,
          note,
          occurredAt,
        });
        return covered.gastoTransactionId ?? covered.reservaTransactionId!;
      }
      return postGasto(tx, {
        accountId: correction.accountId,
        amountCents,
        fundId: correction.fundId,
        note,
        occurredAt,
      });
    }
    case 'CARGO_TARJETA':
      if (!correction.cardId) throw new DomainError('Tarjeta no encontrada');
      return postCardCharge(tx, {
        cardId: correction.cardId,
        amountCents,
        coverFundId: correction.fundId,
        chargeClass: correction.chargeClass,
        note,
        occurredAt,
      });
    case 'TRANSFERENCIA':
      if (!correction.fromAccountId || !correction.toAccountId) {
        throw new DomainError('Cuenta no encontrada');
      }
      return postTransferencia(tx, {
        fromAccountId: correction.fromAccountId,
        toAccountId: correction.toAccountId,
        amountCents,
        fromFundId: correction.fundId,
        toFundId: correction.toFundId,
        note,
        occurredAt,
      });
    case 'APORTE':
      if (!correction.personId || !correction.accountId) throw new DomainError('Cuenta no encontrada');
      return postAporte(tx, {
        personId: correction.personId,
        toAccountId: correction.accountId,
        amountCents,
        note,
        occurredAt,
      });
    case 'RESERVA':
      if (!correction.fundId) throw new DomainError('Fondo no encontrado');
      return postReserva(tx, { fundId: correction.fundId, amountCents, note, occurredAt });
    case 'LIBERACION_RESERVA':
      if (!correction.reservationId) throw new DomainError('Reserva activa no encontrada');
      return postLiberacion(tx, {
        reservationId: correction.reservationId,
        amountCents,
        note,
        occurredAt,
        toAccountId: correction.toAccountId,
      });
    case 'AJUSTE':
      if (!correction.accountId) throw new DomainError('Cuenta no encontrada');
      return postAjuste(tx, { accountId: correction.accountId, amountCents, note, occurredAt });
    case 'PAGO_DEUDA':
      if (correction.debtId) {
        return postPagoDeuda(tx, {
          debtId: correction.debtId,
          accountId: correction.fromAccountId ?? correction.accountId,
          amountCents,
          note,
          occurredAt,
        });
      }
      if (!correction.cardId || !correction.fromAccountId) throw new DomainError('Cuenta no encontrada');
      return postCardPayment(tx, {
        cardId: correction.cardId,
        fromAccountId: correction.fromAccountId,
        amountCents,
        note,
        occurredAt,
      });
    default:
      throw new DomainError('Tipo de corrección no soportado');
  }
}

export async function snapshot(tx: LedgerTx) {
  const [
    people,
    accounts,
    funds,
    transactions,
    budgetItems,
    balances,
    reservations,
    creditCards,
    cardCharges,
    debts,
    debtPayments,
  ] = await Promise.all([
    tx.listPeople(),
    tx.listAccounts(),
    tx.listFunds(),
    tx.listTransactions(),
    tx.listBudgetItems(),
    computeAccountBalances(tx),
    tx.listReservations(),
    tx.listCreditCards(),
    tx.listCardCharges(),
    tx.listDebts(),
    tx.listDebtPayments(),
  ]);
  const splitsByTx = new Map<string, SplitRow[]>();
  for (const transaction of transactions) {
    splitsByTx.set(transaction.id, await tx.listSplitsForTransaction(transaction.id));
  }
  return {
    people,
    accounts,
    funds,
    transactions,
    budgetItems,
    balances,
    reservations,
    creditCards,
    cardCharges,
    debts,
    debtPayments,
    splitsByTx,
  };
}
