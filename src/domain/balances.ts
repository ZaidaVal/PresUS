import { assertCents, type Cents } from './money';
import { currentPeriod, itemObligationInPeriod } from './budget';
import type { LedgerTx } from './ledger';
import type {
  Account,
  AccountBalance,
  CardBalance,
  CardCharge,
  FundBalance,
  SafeAvailable,
  SplitRow,
} from './types';
import { debtViewsFromState, unreservedDebtInstallmentsCents } from './debts';
import {
  DASHBOARD_PREFS_KEY,
  parseDashboardPrefs,
  resolveExtraLimitedCard,
  resolveLimitedCard,
  resolvePaymentAccount,
} from './dashboardPrefs';
import {
  cardDisponibleCents,
  cardsOnSameLine,
  lineAvailableCents,
  lineSpentFromOwed,
  normalizeCreditCard,
} from './creditLine';
import { isBarrasAccount, isSavingsAccount, isSavingsLikeFund } from './segments';

export async function chargesFromPostedTransactions(tx: LedgerTx): Promise<CardCharge[]> {
  const charges = await tx.listCardCharges();
  const transactions = await tx.listTransactions();
  const posted = new Set(transactions.filter((row) => row.status === 'POSTED').map((row) => row.id));
  return charges.filter((row) => posted.has(row.transactionId));
}

const ACCOUNT_ROLES = new Set(['SOURCE', 'DESTINATION']);

export function accountBalanceFromSplits(accountId: string, splits: SplitRow[]): Cents {
  let total = 0;
  for (const split of splits) {
    if (split.accountId === accountId && ACCOUNT_ROLES.has(split.role)) {
      assertCents(split.amountCents);
      total += split.amountCents;
    }
  }
  return total;
}

export function cardBalanceFromSplits(cardId: string, splits: SplitRow[]): Cents {
  let total = 0;
  for (const split of splits) {
    if (split.cardId === cardId && ACCOUNT_ROLES.has(split.role)) {
      assertCents(split.amountCents);
      total += split.amountCents;
    }
  }
  const owed = -total;
  return owed === 0 ? 0 : owed;
}

export async function computeAccountBalances(tx: LedgerTx): Promise<AccountBalance[]> {
  const accounts = await tx.listAccounts();
  const funds = await tx.listFunds();
  const splits = await tx.listPostedSplits();
  const reservations = await tx.listActiveReservations();
  const reservedByFund = new Map<string, Cents>();
  for (const reservation of reservations) {
    reservedByFund.set(
      reservation.fundId,
      (reservedByFund.get(reservation.fundId) ?? 0) + reservation.amountCents,
    );
  }

  return accounts.map((account) => {
    const saldoCents = accountBalanceFromSplits(account.id, splits);
    const reservedCents = funds
      .filter((fund) => fund.accountId === account.id)
      .reduce((sum, fund) => sum + (reservedByFund.get(fund.id) ?? 0), 0);
    const disponibleCents = saldoCents - reservedCents;
    return {
      account,
      saldoCents,
      reservedCents,
      disponibleCents,
      disponibleUiCents: Math.max(0, disponibleCents),
    };
  });
}

export async function computeFundBalances(tx: LedgerTx): Promise<FundBalance[]> {
  const funds = await tx.listFunds();
  const reservations = await tx.listActiveReservations();
  return funds.map((fund) => ({
    fund,
    reservedCents: reservations
      .filter((row) => row.fundId === fund.id)
      .reduce((sum, row) => sum + row.amountCents, 0),
  }));
}

export async function computeCardBalances(tx: LedgerTx): Promise<CardBalance[]> {
  const cards = (await tx.listCreditCards()).map(normalizeCreditCard);
  const splits = await tx.listPostedSplits();
  const charges = await chargesFromPostedTransactions(tx);
  const reservations = await tx.listActiveReservations();
  const reservedByFund = new Map<string, Cents>();
  for (const reservation of reservations) {
    reservedByFund.set(
      reservation.fundId,
      (reservedByFund.get(reservation.fundId) ?? 0) + reservation.amountCents,
    );
  }
  const owedByCard = new Map<string, Cents>();
  for (const card of cards) {
    owedByCard.set(card.id, cardBalanceFromSplits(card.id, splits));
  }
  return cards.map((card) => {
    const saldoCents = owedByCard.get(card.id) ?? 0;
    const cubiertoCents = charges
      .filter(
        (row) =>
          row.cardId === card.id &&
          (row.coverageStatus === 'CUBIERTO_PENDIENTE_TRASPASO' ||
            row.coverageStatus === 'TRANSFERIDO_A_ATLANTIDA'),
      )
      .reduce((sum, row) => sum + row.amountCents, 0);
    const sinCubrirCents = charges
      .filter((row) => row.cardId === card.id && row.coverageStatus === 'SIN_COBERTURA')
      .reduce((sum, row) => sum + row.amountCents, 0);
    const reserved = card.coverFundId ? (reservedByFund.get(card.coverFundId) ?? 0) : 0;
    const pendingCovered = charges
      .filter(
        (row) =>
          row.coverFundId === card.coverFundId && row.coverageStatus === 'CUBIERTO_PENDIENTE_TRASPASO',
      )
      .reduce((sum, row) => sum + row.amountCents, 0);
    const lineLimit = card.creditLineLimitCents ?? null;
    const lineSpent =
      lineLimit != null ? lineSpentFromOwed(cardsOnSameLine(card, cards), owedByCard) : saldoCents;
    const lineLeft = lineLimit != null ? lineAvailableCents(lineLimit, lineSpent) : null;
    return {
      card,
      saldoCents,
      cubiertoCents,
      sinCubrirCents,
      limiteCents: card.creditLimitCents,
      coberturaDisponibleCents: reserved - pendingCovered,
      disponibleTarjetaCents: cardDisponibleCents(card, cards, owedByCard),
      lineSpentCents: lineSpent,
      lineAvailableCents: lineLeft,
    };
  });
}

export function unreservedObligationsCents(
  items: Awaited<ReturnType<LedgerTx['listBudgetItems']>>,
  reservedByFund: Map<string, Cents>,
  period = currentPeriod(),
): Cents {
  const remaining = new Map(reservedByFund);
  let total = 0;
  for (const item of items) {
    const obligation = itemObligationInPeriod(item, period);
    if (obligation <= 0) continue;
    const fundId = item.coverFundId;
    const reserved = fundId ? (remaining.get(fundId) ?? 0) : 0;
    const applied = Math.min(obligation, reserved);
    if (fundId) remaining.set(fundId, reserved - applied);
    total += obligation - applied;
  }
  return total;
}

export function disponibleSeguroRaw(input: {
  saldoCuentasPublicas: Cents;
  fondosApartados: Cents;
  obligacionesProximasNoReservadas: Cents;
  tarjetaPendienteNoCubierta?: Cents;
  pagosComprometidos?: Cents;
}): Cents {
  return (
    input.saldoCuentasPublicas -
    input.fondosApartados -
    input.obligacionesProximasNoReservadas -
    (input.tarjetaPendienteNoCubierta ?? 0) -
    (input.pagosComprometidos ?? 0)
  );
}

export type UsableWithoutSavings = {
  paymentCents: Cents;
  lineCents: Cents;
  extraCents: Cents;
  totalCents: Cents;
};

/**
 * «Puedo usar» de Inicio: Atlántida (saldo − apartado) + cupo de línea ONE + slot extra.
 * No suma cuentas/fondos de ahorro (Ahorros y Ahorros 2 no pagan ONE).
 */
export function usableWithoutSavings(input: {
  paymentAccount: Pick<Account, 'id' | 'name'> | null;
  paymentAccountDisponibleCents: Cents;
  limitedRemainingCents: Cents;
  extraLimitedRemainingCents: Cents;
}): UsableWithoutSavings {
  assertCents(input.paymentAccountDisponibleCents, 'disponible de cuenta');
  assertCents(input.limitedRemainingCents, 'cupo de línea');
  assertCents(input.extraLimitedRemainingCents, 'cupo extra');
  const paymentCents =
    input.paymentAccount && !isSavingsAccount(input.paymentAccount)
      ? Math.max(0, input.paymentAccountDisponibleCents)
      : 0;
  const lineCents = Math.max(0, input.limitedRemainingCents);
  const extraCents = Math.max(0, input.extraLimitedRemainingCents);
  return {
    paymentCents,
    lineCents,
    extraCents,
    totalCents: paymentCents + lineCents + extraCents,
  };
}

export function usableWithoutSavingsCents(input: {
  paymentAccount: Pick<Account, 'id' | 'name'> | null;
  paymentAccountDisponibleCents: Cents;
  limitedRemainingCents: Cents;
  extraLimitedRemainingCents: Cents;
}): Cents {
  return usableWithoutSavings(input).totalCents;
}

/** Hero de Inicio: lo que sobra en Barras. Un cargo ONE no cambia este número. */
export function barrasDisponibleUiCents(balances: AccountBalance[]): Cents {
  const row = balances.find(
    (item) => isBarrasAccount(item.account) && item.account.visibility === 'PUBLIC',
  );
  return row ? Math.max(0, row.disponibleCents) : 0;
}

export function barrasAccountId(balances: AccountBalance[]): string | null {
  return (
    balances.find((item) => isBarrasAccount(item.account) && item.account.visibility === 'PUBLIC')
      ?.account.id ?? null
  );
}

export type OneReservaCover = 'PRESUPUESTO' | 'BOLSILLO_Z' | 'BOLSILLO_A' | 'GASTO_X';

export type OnePendingReservaSummary = {
  totalCents: Cents;
  presupuestoCents: Cents;
  bolsilloZCents: Cents;
  bolsilloACents: Cents;
  gastoXCents: Cents;
};

/** Reserva (en Inicio): cargo ONE aún no cubierto/pagado. No es dinero dormido en un fondo. */
export function coverKindForCharge(charge: Pick<CardCharge, 'chargeClass'>): OneReservaCover {
  if (charge.chargeClass === 'PERSONAL_Z') return 'BOLSILLO_Z';
  if (charge.chargeClass === 'PERSONAL_A') return 'BOLSILLO_A';
  if (charge.chargeClass === 'SHARED_UNBUDGETED') return 'GASTO_X';
  return 'PRESUPUESTO';
}

export function onePendingReservaSummary(charges: CardCharge[]): OnePendingReservaSummary {
  const empty: OnePendingReservaSummary = {
    totalCents: 0,
    presupuestoCents: 0,
    bolsilloZCents: 0,
    bolsilloACents: 0,
    gastoXCents: 0,
  };
  return charges
    .filter((row) => row.coverageStatus !== 'TRANSFERIDO_A_ATLANTIDA')
    .reduce((sum, row) => {
      assertCents(row.amountCents, 'cargo ONE');
      const kind = coverKindForCharge(row);
      const next = { ...sum, totalCents: sum.totalCents + row.amountCents };
      if (kind === 'BOLSILLO_Z') next.bolsilloZCents += row.amountCents;
      else if (kind === 'BOLSILLO_A') next.bolsilloACents += row.amountCents;
      else if (kind === 'GASTO_X') next.gastoXCents += row.amountCents;
      else next.presupuestoCents += row.amountCents;
      return next;
    }, empty);
}

/** Tengo / apartado de cuentas públicas no-ahorro. Fondos SAVINGS no entran en apartado. */
export function operatingLiquidityCents(
  balances: AccountBalance[],
  funds: FundBalance[],
): { tengoCents: Cents; apartadoCents: Cents } {
  const operatingIds = new Set(
    balances
      .filter(
        (row) =>
          row.account.visibility === 'PUBLIC' &&
          row.account.countsAsLiquidity &&
          !isSavingsAccount(row.account),
      )
      .map((row) => row.account.id),
  );
  const tengoCents = balances
    .filter((row) => operatingIds.has(row.account.id))
    .reduce((sum, row) => sum + row.saldoCents, 0);
  const apartadoCents = funds
    .filter((row) => operatingIds.has(row.fund.accountId) && !isSavingsLikeFund(row.fund))
    .reduce((sum, row) => sum + row.reservedCents, 0);
  return { tengoCents, apartadoCents };
}

export async function computeSafeAvailable(
  tx: LedgerTx,
  now = new Date(),
): Promise<SafeAvailable> {
  const balances = await computeAccountBalances(tx);
  const items = await tx.listBudgetItems();
  const funds = await tx.listFunds();
  const reservations = await tx.listActiveReservations();
  const cards = (await tx.listCreditCards()).map(normalizeCreditCard);
  const prefs = parseDashboardPrefs(await tx.getMeta(DASHBOARD_PREFS_KEY));
  const accounts = balances.map((row) => row.account);
  const limitedCard = resolveLimitedCard(cards, prefs);
  const paymentAccount = resolvePaymentAccount(accounts, prefs);
  const extraCard = resolveExtraLimitedCard(cards, prefs, limitedCard?.id ?? null);
  const cardBalances = cards.length ? await computeCardBalances(tx) : [];
  const owedByCard = new Map(cardBalances.map((row) => [row.card.id, row.saldoCents]));

  const publicBalances = balances.filter(
    (row) => row.account.visibility === 'PUBLIC' && row.account.countsAsLiquidity,
  );
  const tengoCents = publicBalances.reduce((sum, row) => sum + row.saldoCents, 0);
  const apartadoCents = publicBalances.reduce((sum, row) => sum + row.reservedCents, 0);

  const reservedByFund = new Map<string, Cents>();
  for (const reservation of reservations) {
    const fund = funds.find((row) => row.id === reservation.fundId);
    if (!fund) continue;
    const account = publicBalances.find((row) => row.account.id === fund.accountId);
    if (!account) continue;
    reservedByFund.set(
      reservation.fundId,
      (reservedByFund.get(reservation.fundId) ?? 0) + reservation.amountCents,
    );
  }

  const obligacionesPresupuestoCents = unreservedObligationsCents(
    items.filter((item) => item.budgetScope === 'HOME'),
    reservedByFund,
    currentPeriod(now),
  );
  const debtViews = debtViewsFromState(
    await tx.listDebts(),
    await tx.listDebtPayments(),
    await tx.listTransactions(),
  );
  const obligacionesDeudaCents = unreservedDebtInstallmentsCents(debtViews, reservedByFund, items);
  const obligacionesNoReservadasCents = obligacionesPresupuestoCents + obligacionesDeudaCents;
  const deboCents = cardBalances.reduce((sum, row) => sum + row.saldoCents, 0);

  let creditLineRemainingCents = 0;
  const creditLineId = limitedCard?.creditLineId ?? null;
  if (limitedCard?.creditLineLimitCents != null) {
    const spent = lineSpentFromOwed(cardsOnSameLine(limitedCard, cards), owedByCard);
    creditLineRemainingCents = lineAvailableCents(limitedCard.creditLineLimitCents, spent);
  } else if (limitedCard?.creditLimitCents != null) {
    const owed = owedByCard.get(limitedCard.id) ?? 0;
    const left = limitedCard.creditLimitCents - owed;
    creditLineRemainingCents = left > 0 ? left : 0;
  }
  const limitedRemainingCents = creditLineRemainingCents;

  const paymentRow = paymentAccount
    ? balances.find((row) => row.account.id === paymentAccount.id)
    : undefined;
  const paymentAccountDisponibleCents = paymentRow ? Math.max(0, paymentRow.disponibleCents) : 0;

  const extraLimitedRemainingCents = extraCard
    ? extraCard.creditLineLimitCents != null
      ? lineAvailableCents(
          extraCard.creditLineLimitCents,
          lineSpentFromOwed(cardsOnSameLine(extraCard, cards), owedByCard),
        )
      : extraCard.creditLimitCents != null
        ? Math.max(0, extraCard.creditLimitCents - (owedByCard.get(extraCard.id) ?? 0))
        : 0
    : 0;

  /*
   * Inicio hero = sobra Barras. ONE y reservas de cargo van aparte.
   * Puedo usar (centavos). Cuenta Atlántida ≠ tarjeta ONE. Sin ahorro.
   *   (A) max(0, saldo − apartado) de acc-atlantida. Fondos (Pago ONE) ya están en apartado: no se suman.
   *   (B) max(0, linea − gastadoTotal) de la línea ONE. Gastado = debe POSTED de ambas tarjetas.
   *       No sumar el tope de $100 otra vez. Un cargo no baja (A) ni el hero de Barras.
   *   (C) otra línea/cuenta con límite, si el usuario la marca. Slot vacío por defecto.
   * Ahorros y Ahorros 2 no se suman ni se restan aquí; Ahorros 2 cubre la tarjeta base, no la paga.
   * kind CREDIT de la cuenta no la convierte en la tarjeta.
   */
  const raw = usableWithoutSavingsCents({
    paymentAccount,
    paymentAccountDisponibleCents,
    limitedRemainingCents,
    extraLimitedRemainingCents,
  });
  const heroBarrasCents = barrasDisponibleUiCents(balances);
  return {
    tengoCents,
    apartadoCents,
    deboCents,
    obligacionesNoReservadasCents,
    disponibleSeguroCents: raw,
    disponibleSeguroRawCents: raw,
    disponibleSeguroUiCents: Math.max(0, raw),
    limitedCardRemainingCents: limitedRemainingCents,
    limitedCardId: limitedCard?.id ?? null,
    creditLineRemainingCents,
    creditLineId,
    paymentAccountDisponibleCents,
    paymentAccountId: paymentAccount?.id ?? null,
    extraLimitedRemainingCents,
    extraLimitedCardId: extraCard?.id ?? null,
    barrasDisponibleUiCents: heroBarrasCents,
    barrasAccountId: barrasAccountId(balances),
  };
}

export function assertFundsWithinAccount(
  accountSaldo: Cents,
  reservedOnAccount: Cents,
): void {
  if (reservedOnAccount > accountSaldo) {
    throw new Error('La suma de fondos apartados no puede superar el saldo de la cuenta');
  }
}
