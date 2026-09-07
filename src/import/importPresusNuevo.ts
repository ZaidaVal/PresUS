import { defaultBudgetShares } from '../domain/budget';
import type { Ledger, LedgerTx } from '../domain/ledger';
import { postAjuste, postReserva, cardOwedCents } from '../domain/posting';
import {
  EMPTY_BOOK_PENDING_PUSH_KEY,
  IDS,
} from '../database/seed';
import {
  ONE_CARD_CAP_100_CENTS,
  ONE_CREDIT_LINE_CENTS,
  ONE_CREDIT_LINE_ID,
} from '../domain/creditLine';
import { saveDebt } from '../domain/debts';
import {
  PRESUS_NUEVO_BALANCES,
  PRESUS_NUEVO_BUDGET,
  PRESUS_NUEVO_CACEROLA_DEBT,
  PRESUS_NUEVO_GOAL_FUNDS,
  PRESUS_NUEVO_INCOME,
  PRESUS_NUEVO_OPENED_AT,
  PRESUS_NUEVO_RESERVATIONS,
  PRESUS_NUEVO_SOURCE,
  hasPresusNuevoSnapshotData,
} from './presusNuevoSnapshot';
import { postPresusNuevoOneCharges, replaceOpeningOneAjusteWithCharges } from './oneCharges';
import {
  ledgerHasListaPagosGastos,
  postPresusNuevoListaPagosExpenses,
} from './listaPagosExpenses';

export const PRESUS_NUEVO_IMPORTED_META = 'presus_nuevo_imported_v1';
export const PRESUS_NUEVO_ONE_CHARGES_META = 'presus_nuevo_one_charges_v1';
export const PRESUS_NUEVO_EXTRAS_META = 'presus_nuevo_extras_v1';
export const PRESUS_NUEVO_EXPENSES_META = 'presus_nuevo_lista_pagos_v1';

type FlagStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

async function hasOperationalRows(tx: LedgerTx) {
  return (
    (await tx.listAccounts()).length > 0 ||
    (await tx.listFunds()).length > 0 ||
    (await tx.listTransactions()).length > 0 ||
    (await tx.listBudgetItems()).length > 0 ||
    (await tx.listCreditCards()).length > 0 ||
    (await tx.listDebts()).length > 0 ||
    (await tx.listReservations()).length > 0
  );
}

async function ensurePeople(tx: LedgerTx) {
  const people = await tx.listPeople();
  if (!people.some((row) => row.code === 'Z')) {
    await tx.insertPerson({ id: IDS.people.z, code: 'Z', displayName: 'Z' });
  }
  if (!people.some((row) => row.code === 'A')) {
    await tx.insertPerson({ id: IDS.people.a, code: 'A', displayName: 'A' });
  }
}

async function insertCatalog(tx: LedgerTx) {
  await tx.insertAccount({
    id: IDS.accounts.barras,
    name: 'Barras',
    kind: 'BANK',
    visibility: 'PUBLIC',
    ownerPersonId: null,
    countsAsLiquidity: true,
    isCardPaymentSource: false,
  });
  await tx.insertAccount({
    id: IDS.accounts.atlantida,
    name: 'Atlántida',
    kind: 'CREDIT',
    visibility: 'PUBLIC',
    ownerPersonId: IDS.people.z,
    countsAsLiquidity: true,
    isCardPaymentSource: true,
  });
  await tx.insertAccount({
    id: IDS.accounts.ahorro,
    name: 'Ahorros',
    kind: 'BANK',
    visibility: 'PUBLIC',
    ownerPersonId: null,
    countsAsLiquidity: true,
    isCardPaymentSource: false,
  });
  await tx.insertAccount({
    id: IDS.accounts.ahorros2,
    name: 'Ahorros 2',
    kind: 'BANK',
    visibility: 'PUBLIC',
    ownerPersonId: null,
    countsAsLiquidity: true,
    isCardPaymentSource: false,
  });
  await tx.insertAccount({
    id: IDS.accounts.z,
    name: 'Cuenta Z',
    kind: 'BANK',
    visibility: 'PRIVATE',
    ownerPersonId: IDS.people.z,
    countsAsLiquidity: false,
    isCardPaymentSource: false,
  });
  await tx.insertAccount({
    id: IDS.accounts.a,
    name: 'Cuenta A',
    kind: 'BANK',
    visibility: 'PRIVATE',
    ownerPersonId: IDS.people.a,
    countsAsLiquidity: false,
    isCardPaymentSource: false,
  });

  const barrasFunds: Array<[string, string, string]> = [
    [IDS.funds.casa, 'Casa', 'Cuota / vivienda'],
    [IDS.funds.luz, 'Luz', 'Energía eléctrica'],
    [IDS.funds.internet, 'Internet', 'Internet casa'],
    [IDS.funds.movil, 'Móvil', 'Telefonía'],
    [IDS.funds.super, 'Supermercado', 'Despensa'],
    [IDS.funds.cacerolas, 'Cacerolas', 'Pago físico'],
    [IDS.funds.credito, 'Crédito', 'Crédito recurrente'],
    [IDS.funds.salidas, 'Salidas', 'Salidas compartidas'],
    [IDS.funds.gasolina, 'Gasolina', 'Transporte'],
    [IDS.funds.youtube, 'YouTube', 'Suscripción'],
    [IDS.funds.cursor, 'Cursor', 'Herramienta'],
    [IDS.funds.maestria, 'Maestría', 'Estudios Z'],
    [IDS.funds.chatgpt, 'ChatGPT', 'Suscripción'],
    [IDS.funds.internetCel, 'Internet celular', 'Datos'],
    [IDS.funds.spotify, 'Spotify', 'Suscripción'],
    [IDS.funds.agua, 'Agua', 'Servicio'],
  ];
  for (const [id, name, purpose] of barrasFunds) {
    await tx.insertFund({
      id,
      accountId: IDS.accounts.barras,
      name,
      purpose,
      targetAmountCents: null,
      priority: null,
      segment: 'OPERATING',
    });
  }
  await tx.insertFund({
    id: IDS.funds.ahorroGeneral,
    accountId: IDS.accounts.ahorro,
    name: 'Ahorros',
    purpose: 'Ahorro presupuestado (el normal)',
    targetAmountCents: null,
    priority: 1,
    segment: 'SAVINGS',
  });
  await tx.insertFund({
    id: IDS.funds.ahorros2,
    accountId: IDS.accounts.ahorros2,
    name: 'Ahorros 2',
    purpose: 'Cuenta de ahorro 2; el Excel no trae saldo',
    targetAmountCents: null,
    priority: 2,
    segment: 'SAVINGS',
  });
  await tx.insertFund({
    id: IDS.funds.pagoOne,
    accountId: IDS.accounts.atlantida,
    name: 'Pago ONE',
    purpose: 'Dinero en Atlántida para pagar ONE',
    targetAmountCents: null,
    priority: 1,
    segment: 'OPERATING',
  });

  const line = {
    creditLineId: ONE_CREDIT_LINE_ID,
    creditLineLimitCents: ONE_CREDIT_LINE_CENTS,
  } as const;
  await tx.insertCreditCard({
    id: IDS.cards.limited,
    name: 'ONE',
    paymentAccountId: IDS.accounts.atlantida,
    coverFundId: null,
    creditLimitCents: ONE_CREDIT_LINE_CENTS,
    ...line,
    personId: null,
  });
  await tx.insertCreditCard({
    id: IDS.cards.cap100,
    name: 'ONE $100',
    paymentAccountId: IDS.accounts.atlantida,
    coverFundId: null,
    creditLimitCents: ONE_CARD_CAP_100_CENTS,
    ...line,
    personId: null,
  });
}

/**
 * Carga el libro operativo de PresUSNuevo sobre un SQLite vacío (solo Z/A).
 * Saldos con AJUSTE explícito. No borra POSTED. No inventa hipoteca ni Ahorros 2.
 * Tras importar, el pending de Drive pasa a «subir este libro», no el vacío.
 */
export async function importPresusNuevoIfNeeded(
  ledger: Ledger,
  storage?: FlagStorage | null,
): Promise<boolean> {
  if (!hasPresusNuevoSnapshotData()) return false;
  return ledger.withTransaction(async (tx) => {
    if ((await tx.getMeta(PRESUS_NUEVO_IMPORTED_META)) === '1') return false;
    if (await hasOperationalRows(tx)) return false;

    await tx.setMeta('schema_version', '1');
    if (!(await tx.getMeta('device_id'))) {
      await tx.setMeta('device_id', crypto.randomUUID());
    }
    await ensurePeople(tx);
    await insertCatalog(tx);

    await postAjuste(tx, {
      accountId: IDS.accounts.barras,
      amountCents: PRESUS_NUEVO_BALANCES.barrasCents,
      note: `AJUSTE de apertura Barras (${PRESUS_NUEVO_SOURCE})`,
      occurredAt: PRESUS_NUEVO_OPENED_AT,
    });
    await postAjuste(tx, {
      accountId: IDS.accounts.atlantida,
      amountCents: PRESUS_NUEVO_BALANCES.atlantidaCents,
      note: `AJUSTE de apertura Atlántida (${PRESUS_NUEVO_SOURCE})`,
      occurredAt: PRESUS_NUEVO_OPENED_AT,
    });

    for (const row of PRESUS_NUEVO_RESERVATIONS) {
      await postReserva(tx, {
        fundId: row.fundId,
        amountCents: row.amountCents,
        note: row.note,
        occurredAt: PRESUS_NUEVO_OPENED_AT,
      });
    }

    await postPresusNuevoOneCharges(tx, IDS.cards.limited);
    const oneOwed = await cardOwedCents(tx, IDS.cards.limited);
    if (oneOwed !== PRESUS_NUEVO_BALANCES.oneOwedCents) {
      throw new Error(
        `ONE importado ${oneOwed} ¢ no cuadra con el debe ${PRESUS_NUEVO_BALANCES.oneOwedCents} ¢`,
      );
    }

    await postPresusNuevoListaPagosExpenses(tx);

    for (const item of PRESUS_NUEVO_BUDGET) {
      await tx.insertBudgetItem({
        id: item.id,
        budgetScope: item.budgetScope,
        name: item.name,
        category: item.category,
        frequency: item.frequency,
        amountCents: item.amountCents,
        ...defaultBudgetShares(item.budgetScope, item.amountCents, item.name),
        fortnight: 'BOTH',
        coverFundId: item.coverFundId,
        usualMedium: item.usualMedium,
        active: true,
      });
    }

    await applyPresusNuevoExtras(tx);

    await tx.setMeta(PRESUS_NUEVO_IMPORTED_META, '1');
    await tx.setMeta(PRESUS_NUEVO_ONE_CHARGES_META, '1');
    await tx.setMeta(PRESUS_NUEVO_EXPENSES_META, '1');
    await tx.setMeta(PRESUS_NUEVO_EXTRAS_META, '1');
    await tx.setMeta('catalog_initialized', '1');
    await tx.setMeta('two_savings_accounts', '1');
    await tx.setMeta('atlantida_credit_model', '1');
    await tx.setMeta('budget_item_shares', '1');
    storage?.setItem(EMPTY_BOOK_PENDING_PUSH_KEY, '1');
    return true;
  });
}

/** Libros ya importados con el debe ONE en un solo AJUSTE: sustituye por cargos línea a línea. */
export async function importPresusNuevoOneChargesIfNeeded(ledger: Ledger): Promise<boolean> {
  return ledger.withTransaction(async (tx) => {
    if ((await tx.getMeta(PRESUS_NUEVO_ONE_CHARGES_META)) === '1') return false;
    if ((await tx.getMeta(PRESUS_NUEVO_IMPORTED_META)) !== '1') return false;
    if ((await tx.listCardCharges()).length > 0) {
      await tx.setMeta(PRESUS_NUEVO_ONE_CHARGES_META, '1');
      return false;
    }
    await replaceOpeningOneAjusteWithCharges(tx, IDS.cards.limited);
    const oneOwed = await cardOwedCents(tx, IDS.cards.limited);
    if (oneOwed !== PRESUS_NUEVO_BALANCES.oneOwedCents) {
      throw new Error(
        `ONE tras cargos ${oneOwed} ¢ no cuadra con el debe ${PRESUS_NUEVO_BALANCES.oneOwedCents} ¢`,
      );
    }
    await tx.setMeta(PRESUS_NUEVO_ONE_CHARGES_META, '1');
    return true;
  });
}

/**
 * Backfill: libros v1 ya importados sin las 21 líneas. Misma escritura que el import inicial.
 * Un flag. Si el libro ya tiene las 21 (o cualquier GASTO Lista Pagos), no agrega otra tanda.
 * No duplica cargos ONE. No crea PartnerDebt.
 */
export async function importPresusNuevoExpensesIfNeeded(
  ledger: Ledger,
  storage?: FlagStorage | null,
): Promise<boolean> {
  return ledger.withTransaction(async (tx) => {
    return applyListaPagosExpensesIfNeeded(tx, storage);
  });
}

async function applyListaPagosExpensesIfNeeded(
  tx: LedgerTx,
  storage?: FlagStorage | null,
): Promise<boolean> {
  if ((await tx.getMeta(PRESUS_NUEVO_EXPENSES_META)) === '1') return false;
  if ((await tx.getMeta(PRESUS_NUEVO_IMPORTED_META)) !== '1') return false;
  if (await ledgerHasListaPagosGastos(tx)) {
    await tx.setMeta(PRESUS_NUEVO_EXPENSES_META, '1');
    return false;
  }
  const oneBefore = (await tx.listCardCharges()).length;
  const posted = await postPresusNuevoListaPagosExpenses(tx);
  const oneAfter = (await tx.listCardCharges()).length;
  if (oneAfter !== oneBefore) {
    throw new Error('El import de Lista Pagos no debe crear cargos ONE');
  }
  await tx.setMeta(PRESUS_NUEVO_EXPENSES_META, '1');
  if (posted) storage?.setItem(EMPTY_BOOK_PENDING_PUSH_KEY, '1');
  return posted;
}

/**
 * Una pasada de boot: libro vacío → import; extras; Lista Pagos (solo si faltan).
 * No reimporta cargos ONE.
 */
export async function applyPresusNuevoBootImports(
  ledger: Ledger,
  storage?: FlagStorage | null,
): Promise<{ imported: boolean; extras: boolean; expenses: boolean }> {
  const imported = await importPresusNuevoIfNeeded(ledger, storage);
  const extras = await importPresusNuevoExtrasIfNeeded(ledger);
  const expenses = await importPresusNuevoExpensesIfNeeded(ledger, storage);
  return { imported, extras, expenses };
}

async function applyPresusNuevoExtras(tx: LedgerTx) {
  const existingFunds = await tx.listFunds();
  const fundIds = new Set(existingFunds.map((row) => row.id));
  for (const row of PRESUS_NUEVO_GOAL_FUNDS) {
    if (fundIds.has(row.id)) continue;
    await tx.insertFund({
      id: row.id,
      accountId: IDS.accounts.ahorro,
      name: row.name,
      purpose: row.purpose,
      targetAmountCents: row.targetAmountCents,
      priority: row.priority,
      segment: 'SAVINGS',
    });
  }

  const existingItems = await tx.listBudgetItems();
  const itemIds = new Set(existingItems.map((row) => row.id));
  for (const item of PRESUS_NUEVO_BUDGET) {
    if (itemIds.has(item.id)) continue;
    await tx.insertBudgetItem({
      id: item.id,
      budgetScope: item.budgetScope,
      name: item.name,
      category: item.category,
      frequency: item.frequency,
      amountCents: item.amountCents,
      ...defaultBudgetShares(item.budgetScope, item.amountCents, item.name),
      fortnight: 'BOTH',
      coverFundId: item.coverFundId,
      usualMedium: item.usualMedium,
      active: true,
    });
  }

  if (!(await tx.getDebt(PRESUS_NUEVO_CACEROLA_DEBT.id))) {
    await saveDebt(
      tx,
      {
        id: PRESUS_NUEVO_CACEROLA_DEBT.id,
        name: PRESUS_NUEVO_CACEROLA_DEBT.name,
        kind: 'PERSONAL',
        originalCents: PRESUS_NUEVO_CACEROLA_DEBT.originalCents,
        annualRateBps: 0,
        termMonths: PRESUS_NUEVO_CACEROLA_DEBT.termMonths,
        installmentCents: PRESUS_NUEVO_CACEROLA_DEBT.installmentCents,
        startedAt: PRESUS_NUEVO_CACEROLA_DEBT.startedAt,
        paymentAccountId: IDS.accounts.barras,
        coverFundId: IDS.funds.cacerolas,
        amortization: 'SIMPLE',
        compounding: 'MONTHLY',
        extraMonthlyCents: 0,
        extraFortnightCents: 0,
        extraEveryNMonths: null,
        extraEveryNAmountCents: 0,
        note: `${PRESUS_NUEVO_CACEROLA_DEBT.note} (${PRESUS_NUEVO_SOURCE})`,
        active: true,
      },
      true,
    );
  }

  await tx.setMeta('presus_income_z_cents', String(PRESUS_NUEVO_INCOME.zAvailableCents));
  await tx.setMeta('presus_income_a_cents', String(PRESUS_NUEVO_INCOME.aAvailableCents));
}

/**
 * Libros ya importados (v1): partidas Z cacheadas, metas/proyectos y cacerolas.
 * No duplica cargos ONE ni toca Barras/Atlántida.
 */
export async function importPresusNuevoExtrasIfNeeded(ledger: Ledger): Promise<boolean> {
  return ledger.withTransaction(async (tx) => {
    if ((await tx.getMeta(PRESUS_NUEVO_EXTRAS_META)) === '1') return false;
    if ((await tx.getMeta(PRESUS_NUEVO_IMPORTED_META)) !== '1') return false;
    await applyPresusNuevoExtras(tx);
    await tx.setMeta(PRESUS_NUEVO_EXTRAS_META, '1');
    return true;
  });
}
