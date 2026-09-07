import type { Ledger, LedgerTx } from '../domain/ledger';
import { completeBudgetShares, defaultBudgetShares } from '../domain/budget';
import { postAjuste, postLiberacion, postReserva, postTransferencia } from '../domain/posting';
import { frenchInstallmentCents } from '../domain/amortization';
import { looksLikeSavingsFund } from '../domain/segments';
import type { BudgetItem, CreditCard, Frequency, Fund, PaymentMedium } from '../domain/types';
import { exportBackup, PREVENTIVE_BACKUP_KEY } from '../sync/backup';
import { getSecureStore } from '../security/secureStore';
import {
  ONE_CARD_CAP_100_CENTS,
  ONE_CREDIT_LINE_CENTS,
  ONE_CREDIT_LINE_ID,
} from '../domain/creditLine';

export const IDS = {
  people: { z: 'person-z', a: 'person-a' },
  accounts: {
    barras: 'acc-barras',
    atlantida: 'acc-atlantida',
    ahorro: 'acc-ahorro',
    ahorros2: 'acc-ahorros-2',
    z: 'acc-z',
    a: 'acc-a',
  },
  funds: {
    casa: 'fund-casa',
    luz: 'fund-luz',
    internet: 'fund-internet',
    movil: 'fund-movil',
    super: 'fund-super',
    cacerolas: 'fund-cacerolas',
    credito: 'fund-credito',
    salidas: 'fund-salidas',
    gasolina: 'fund-gasolina',
    youtube: 'fund-youtube',
    ahorroBarras: 'fund-ahorro-barras',
    cursor: 'fund-cursor',
    maestria: 'fund-maestria',
    chatgpt: 'fund-chatgpt',
    internetCel: 'fund-internet-cel',
    spotify: 'fund-spotify',
    agua: 'fund-agua',
    ahorroGeneral: 'fund-ahorro-general',
    pagoOne: 'fund-pago-one',
    ahorros2: 'fund-ahorros-2',
  },
  cards: {
    limited: 'card-one-limit',
    cap100: 'card-one-open',
    open: 'card-one-open',
  },
  debts: {
    hipoteca: 'debt-hipoteca',
  },
} as const;

const OPENED_AT = '2026-08-01T00:00:00.000Z';

const HOME_BUDGET_BUMPS: Array<[string, number]> = [
  ['bi-casa', 45000],
  ['bi-luz', 2000],
  ['bi-internet', 1800],
  ['bi-movil', 1000],
  ['bi-super', 6500],
  ['bi-cacerolas', 1500],
  ['bi-credito', 3500],
  ['bi-salidas', 3500],
  ['bi-gasolina', 3500],
  ['bi-youtube', 300],
  ['bi-ahorro', 5000],
  ['bi-cursor', 800],
  ['bi-agua', 400],
  ['bi-seguridad', 400],
];

const ORIGINAL_HOME_BUDGET: Record<string, number> = {
  'bi-casa': 37500,
  'bi-luz': 1500,
  'bi-internet': 1400,
  'bi-movil': 750,
  'bi-super': 5000,
  'bi-cacerolas': 1000,
  'bi-credito': 2500,
  'bi-salidas': 2500,
  'bi-gasolina': 2500,
  'bi-youtube': 200,
  'bi-ahorro': 3500,
  'bi-cursor': 500,
  'bi-agua': 250,
  'bi-seguridad': 275,
};

export const EMPTY_LEDGER_COPY = 'Sin datos locales. Restaura una copia de Drive.';
export const FACTORY_EMPTY_META = 'factory_empty_v1';
export const FACTORY_EMPTY_STORAGE_KEY = 'finanzasza-factory-empty-v2';
/** Pedido explícito: libro vacío (solo Z/A). No re-siembra PresUS. */
export const EXPLICIT_EMPTY_BOOK_META = 'explicit_empty_book_v1';
export const EMPTY_BOOK_PENDING_PUSH_KEY = 'finanzasza-empty-book-pending-push-v1';

type FlagStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** El wipe de PresUS en IndexedDB es una sola vez. El segundo init no borra el libro. */
export function shouldWipeLegacyDatabase(storage: FlagStorage | undefined): boolean {
  if (!storage) return false;
  return storage.getItem(FACTORY_EMPTY_STORAGE_KEY) !== '1';
}

export function markFactoryFileWipeDone(storage: FlagStorage): void {
  storage.setItem(FACTORY_EMPTY_STORAGE_KEY, '1');
}

const DRIVE_META_TO_KEEP = [
  'drive_folder_id',
  'drive_backups_folder_id',
  'last_backup_at',
  'last_backup_file_id',
] as const;

async function ensureCatalogPeople(tx: LedgerTx) {
  const people = await tx.listPeople();
  if (!people.some((row) => row.code === 'Z')) {
    await tx.insertPerson({ id: IDS.people.z, code: 'Z', displayName: 'Z' });
  }
  if (!people.some((row) => row.code === 'A')) {
    await tx.insertPerson({ id: IDS.people.a, code: 'A', displayName: 'A' });
  }
}

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

async function replaceOperationalBook(
  tx: LedgerTx,
  extraMeta: Record<string, string>,
) {
  const deviceId = (await tx.getMeta('device_id')) ?? crypto.randomUUID();
  const preservedMeta: Record<string, string> = {
    schema_version: '1',
    device_id: deviceId,
    catalog_initialized: '1',
    ...extraMeta,
  };
  for (const key of DRIVE_META_TO_KEEP) {
    const value = await tx.getMeta(key);
    if (value) preservedMeta[key] = value;
  }
  const people = await tx.listPeople();
  await tx.replaceDomain({
    meta: preservedMeta,
    people: [
      people.find((row) => row.code === 'Z') ?? { id: IDS.people.z, code: 'Z', displayName: 'Z' },
      people.find((row) => row.code === 'A') ?? { id: IDS.people.a, code: 'A', displayName: 'A' },
    ],
    accounts: [],
    funds: [],
    transactions: [],
    splits: [],
    reservations: [],
    budgetItems: [],
    creditCards: [],
    cardCharges: [],
    debts: [],
    debtPayments: [],
  });
}

/**
 * Reset de fábrica pedido por el usuario: el SQLite local no lleva PresUS.
 * No es un DELETE diario de POSTED; es recrear el libro vacío una vez.
 * Tras restaurar Drive, `factory_empty_v1` se conserva y no se vuelve a vaciar.
 */
export async function applyFactoryEmptyIfNeeded(ledger: Ledger) {
  await ledger.withTransaction(async (tx) => {
    if ((await tx.getMeta(FACTORY_EMPTY_META)) === '1') return;

    if (await hasOperationalRows(tx)) {
      await replaceOperationalBook(tx, { [FACTORY_EMPTY_META]: '1' });
      return;
    }

    await tx.setMeta(FACTORY_EMPTY_META, '1');
  });
}

/**
 * Reemplazo explícito del libro por factory empty (solo Z/A).
 * No es anulación diaria de POSTED: wipe/replace del dominio, con copia preventiva local.
 * No vuelve a sembrar cuentas ni saldos.
 */
export async function applyExplicitEmptyBookIfNeeded(ledger: Ledger): Promise<boolean> {
  const replaced = await ledger.withTransaction(async (tx) => {
    if ((await tx.getMeta(EXPLICIT_EMPTY_BOOK_META)) === '1') return false;
    const preventive = JSON.stringify(await exportBackup(tx));
    await getSecureStore().set(PREVENTIVE_BACKUP_KEY, preventive);
    await replaceOperationalBook(tx, {
      [FACTORY_EMPTY_META]: '1',
      [EXPLICIT_EMPTY_BOOK_META]: '1',
    });
    return true;
  });
  if (replaced && typeof localStorage !== 'undefined') {
    localStorage.setItem(EMPTY_BOOK_PENDING_PUSH_KEY, '1');
  }
  return replaced;
}

/** Solo personas Z/A y meta de esquema. Cero liquidez. */
export async function seedIfNeeded(ledger: Ledger) {
  await ledger.withTransaction(async (tx) => {
    await tx.setMeta('schema_version', '1');
    if (!(await tx.getMeta('device_id'))) {
      await tx.setMeta('device_id', crypto.randomUUID());
    }
    await ensureCatalogPeople(tx);
    await tx.setMeta('catalog_initialized', '1');
  });
}

/**
 * Catálogo PresUS (cuentas, fondos, AJUSTE de apertura, presupuesto, ONE, hipoteca).
 * Solo si se llama a propósito sobre un libro sin cuentas. No pisa POSTED ni cuentas
 * restauradas. `factory_empty_v1` / `explicit_empty_book_v1` impiden volver a cargar demo
 * en un dispositivo vacío; no se llama en el boot.
 */
export async function seedDemoIfRestoreMissing(ledger: Ledger) {
  await ledger.withTransaction(async (tx) => {
    await classifySavingsIfNeeded(tx);

    const accounts = await tx.listAccounts();
    const posted = (await tx.listTransactions()).filter((row) => row.status === 'POSTED');
    if (accounts.length > 0 || posted.length > 0) {
      if ((await tx.getMeta('seeded')) === '1') {
        await ensureTwoSavingsAccounts(tx);
        await ensureAtlantidaCreditModel(tx);
        await ensureBudgetShares(tx);
        await ensureExampleMortgage(tx);
      }
      return;
    }

    if (
      (await tx.getMeta(FACTORY_EMPTY_META)) === '1' ||
      (await tx.getMeta(EXPLICIT_EMPTY_BOOK_META)) === '1'
    ) {
      return;
    }

    await tx.setMeta('schema_version', '1');
    if (!(await tx.getMeta('device_id'))) {
      await tx.setMeta('device_id', crypto.randomUUID());
    }
    await ensureCatalogPeople(tx);

    if (!(await tx.getAccount(IDS.accounts.barras))) {
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
    }

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
      if (await tx.getFund(id)) continue;
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
    if (!(await tx.getFund(IDS.funds.ahorroGeneral))) {
      await tx.insertFund({
        id: IDS.funds.ahorroGeneral,
        accountId: IDS.accounts.ahorro,
        name: 'Ahorros',
        purpose: 'Ahorro presupuestado (el normal)',
        targetAmountCents: null,
        priority: 1,
        segment: 'SAVINGS',
      });
    }
    if (!(await tx.getFund(IDS.funds.pagoOne))) {
      await tx.insertFund({
        id: IDS.funds.pagoOne,
        accountId: IDS.accounts.atlantida,
        name: 'Pago ONE',
        purpose: 'Dinero en Atlántida para pagar ONE',
        targetAmountCents: null,
        priority: 1,
        segment: 'OPERATING',
      });
    }
    if (!(await tx.getFund(IDS.funds.ahorros2))) {
      await tx.insertFund({
        id: IDS.funds.ahorros2,
        accountId: IDS.accounts.ahorros2,
        name: 'Ahorros 2',
        purpose: 'Cubre los gastos de la tarjeta ONE base; no paga ONE',
        targetAmountCents: 80000,
        priority: 2,
        segment: 'SAVINGS',
      });
    }

    await ensureCreditCards(tx);

    if ((await tx.listTransactions()).length === 0) {
      await postAjuste(tx, {
        accountId: IDS.accounts.barras,
        amountCents: 120000,
        note: 'Saldo de apertura Barras (PresUS)',
        occurredAt: OPENED_AT,
      });
      await postAjuste(tx, {
        accountId: IDS.accounts.ahorro,
        amountCents: 85000,
        note: 'Saldo de apertura Ahorros (PresUS)',
        occurredAt: OPENED_AT,
      });
      await postAjuste(tx, {
        accountId: IDS.accounts.ahorros2,
        amountCents: 80000,
        note: 'Saldo de apertura Ahorros 2 (PresUS)',
        occurredAt: OPENED_AT,
      });
      await postAjuste(tx, {
        accountId: IDS.accounts.atlantida,
        amountCents: 13065,
        note: 'Saldo de apertura Atlántida (PresUS)',
        occurredAt: OPENED_AT,
      });

      const reservations: Array<[string, number, string]> = [
        [IDS.funds.casa, 45000, 'Retenido Casa'],
        [IDS.funds.luz, 4000, 'Retenido Luz'],
        [IDS.funds.internet, 3600, 'Retenido Internet'],
        [IDS.funds.movil, 1000, 'Retenido Móvil'],
        [IDS.funds.super, 13000, 'Retenido Supermercado'],
        [IDS.funds.cacerolas, 3000, 'Retenido Cacerolas'],
        [IDS.funds.credito, 10500, 'Retenido Crédito'],
        [IDS.funds.gasolina, 7000, 'Retenido Gasolina'],
        [IDS.funds.youtube, 300, 'Retenido YouTube'],
        [IDS.funds.cursor, 3200, 'Retenido Cursor'],
        [IDS.funds.maestria, 15000, 'Retenido Maestría'],
        [IDS.funds.chatgpt, 2000, 'Retenido ChatGPT'],
        [IDS.funds.internetCel, 2000, 'Retenido Internet celular'],
        [IDS.funds.spotify, 700, 'Retenido Spotify'],
        [IDS.funds.agua, 1600, 'Retenido Agua'],
        [IDS.funds.ahorroGeneral, 85000, 'Ahorros no disponible'],
        [IDS.funds.ahorros2, 80000, 'Cobertura tarjeta ONE base'],
        [IDS.funds.pagoOne, 13065, 'Reservado para pagar ONE'],
      ];
      for (const [fundId, amountCents, note] of reservations) {
        await postReserva(tx, { fundId, amountCents, note, occurredAt: OPENED_AT });
      }
    }

    if ((await tx.listBudgetItems()).length === 0) {
      const home: Array<[string, string, string, Frequency, number, BudgetItem['fortnight'], string | null, PaymentMedium]> = [
        ['bi-casa', 'Casa', 'Vivienda', 'MENSUAL', 45000, 'BOTH', IDS.funds.casa, 'TRANSFER'],
        ['bi-luz', 'Luz', 'Servicios', 'QUINCENAL', 2000, 'BOTH', IDS.funds.luz, 'CARD'],
        ['bi-internet', 'Internet', 'Servicios', 'QUINCENAL', 1800, 'BOTH', IDS.funds.internet, 'CARD'],
        ['bi-movil', 'Móvil', 'Servicios', 'QUINCENAL', 1000, 'BOTH', IDS.funds.movil, 'CARD'],
        ['bi-super', 'Super', 'Supermercado', 'QUINCENAL', 6500, 'BOTH', IDS.funds.super, 'CARD'],
        ['bi-cacerolas', 'Cacerolas', 'Hogar', 'QUINCENAL', 1500, 'BOTH', IDS.funds.cacerolas, 'CASH'],
        ['bi-credito', 'Crédito', 'Deuda', 'QUINCENAL', 3500, 'BOTH', IDS.funds.credito, 'TRANSFER'],
        ['bi-salidas', 'Salidas', 'Ocio', 'QUINCENAL', 3500, 'BOTH', IDS.funds.salidas, 'TRANSFER'],
        ['bi-gasolina', 'Gasolina', 'Transporte', 'QUINCENAL', 3500, 'BOTH', IDS.funds.gasolina, 'CARD'],
        ['bi-youtube', 'YouTube', 'Suscripciones', 'QUINCENAL', 300, 'BOTH', IDS.funds.youtube, 'CARD'],
        ['bi-ahorro', 'Ahorros', 'Ahorro', 'QUINCENAL', 5000, 'BOTH', IDS.funds.ahorroGeneral, 'TRANSFER'],
        ['bi-cursor', 'Cursor', 'Herramientas', 'QUINCENAL', 800, 'BOTH', IDS.funds.cursor, 'CARD'],
        ['bi-agua', 'Agua', 'Servicios', 'QUINCENAL', 400, 'BOTH', IDS.funds.agua, 'CARD'],
        ['bi-seguridad', 'Seguridad', 'Servicios', 'QUINCENAL', 400, 'BOTH', null, 'TRANSFER'],
        ['bi-ahorros-2', 'Ahorros 2', 'Ahorro', 'QUINCENAL', 4000, 'BOTH', IDS.funds.ahorros2, 'TRANSFER'],
      ];
      for (const [id, name, category, frequency, amountCents, fortnight, coverFundId, usualMedium] of home) {
        await tx.insertBudgetItem({
          id,
          budgetScope: 'HOME',
          name,
          category,
          frequency,
          amountCents,
          ...defaultBudgetShares('HOME', amountCents, name),
          fortnight,
          coverFundId,
          usualMedium,
          active: true,
        });
      }

      const zItems: Array<[string, string, string, Frequency, number]> = [
        ['bi-z-ahorro', 'Ahorro Z', 'Ahorro', 'QUINCENAL', 10000],
        ['bi-z-master', 'Maestría', 'Estudios', 'QUINCENAL', 7500],
        ['bi-z-gpt', 'ChatGPT', 'Suscripciones', 'QUINCENAL', 1000],
        ['bi-z-cel', 'Internet celular', 'Servicios', 'QUINCENAL', 1000],
        ['bi-z-spoty', 'Spotify', 'Suscripciones', 'QUINCENAL', 350],
        ['bi-z-salidas', 'Salidas Z', 'Ocio', 'QUINCENAL', 2500],
        ['bi-z-cursor', 'Cursor Z', 'Herramientas', 'QUINCENAL', 500],
        ['bi-z-comida', 'Comida', 'Alimentos', 'QUINCENAL', 4000],
        ['bi-z-gas', 'Gasolina Z', 'Transporte', 'QUINCENAL', 750],
        ['bi-z-agua', 'Agua Z', 'Servicios', 'QUINCENAL', 250],
      ];
      for (const [id, name, category, frequency, amountCents] of zItems) {
        await tx.insertBudgetItem({
          id,
          budgetScope: 'Z',
          name,
          category,
          frequency,
          amountCents,
          zShareCents: amountCents,
          aShareCents: 0,
          fortnight: 'BOTH',
          coverFundId: null,
          usualMedium: 'TRANSFER',
          active: true,
        });
      }
    }

    await tx.setMeta('savings_classified', '1');
    await tx.setMeta('two_savings_accounts', '1');
    await tx.setMeta('atlantida_credit_model', '1');
    await ensureBudgetShares(tx);
    await ensureExampleMortgage(tx);
    await tx.setMeta('seeded', '1');
  });
}

async function ensureExampleMortgage(tx: LedgerTx) {
  if (await tx.getDebt(IDS.debts.hipoteca)) return;
  const originalCents = 10_000_000;
  const annualRateBps = 600;
  const termMonths = 360;
  const installmentCents = frenchInstallmentCents(originalCents, annualRateBps, termMonths, 'MONTHLY');
  await tx.insertDebt({
    id: IDS.debts.hipoteca,
    name: 'Hipoteca',
    kind: 'MORTGAGE',
    originalCents,
    annualRateBps,
    termMonths,
    installmentCents,
    startedAt: OPENED_AT,
    paymentAccountId: IDS.accounts.barras,
    coverFundId: IDS.funds.casa,
    amortization: 'FRENCH',
    compounding: 'MONTHLY',
    extraMonthlyCents: 0,
    extraFortnightCents: 0,
    extraEveryNMonths: null,
    extraEveryNAmountCents: 0,
    note: 'Catálogo de ejemplo. Crear la deuda no saca efectivo.',
    active: true,
  });
}

async function classifySavingsIfNeeded(tx: LedgerTx) {
  if ((await tx.getMeta('savings_classified')) === '1') return;
  const funds = await tx.listFunds();
  for (const fund of funds) {
    if (looksLikeSavingsFund(fund) && fund.segment !== 'SAVINGS') {
      await tx.updateFund({ ...fund, segment: 'SAVINGS' });
    }
  }
  await tx.setMeta('savings_classified', '1');
}

async function upsertCreditCard(tx: LedgerTx, row: CreditCard) {
  const existing = await tx.getCreditCard(row.id);
  if (!existing) {
    await tx.insertCreditCard(row);
    return;
  }
  await tx.updateCreditCard({ ...existing, ...row, personId: existing.personId });
}

async function ensureCreditCards(tx: LedgerTx) {
  const line = {
    creditLineId: ONE_CREDIT_LINE_ID,
    creditLineLimitCents: ONE_CREDIT_LINE_CENTS,
  } as const;
  await upsertCreditCard(tx, {
    id: IDS.cards.limited,
    name: 'ONE',
    paymentAccountId: IDS.accounts.atlantida,
    coverFundId: IDS.funds.ahorros2,
    creditLimitCents: ONE_CREDIT_LINE_CENTS,
    ...line,
    personId: null,
  });
  await upsertCreditCard(tx, {
    id: IDS.cards.cap100,
    name: 'ONE $100',
    paymentAccountId: IDS.accounts.atlantida,
    coverFundId: null,
    creditLimitCents: ONE_CARD_CAP_100_CENTS,
    ...line,
    personId: null,
  });
}

async function reservedOnFund(tx: LedgerTx, fundId: string): Promise<number> {
  return (await tx.listActiveReservations())
    .filter((row) => row.fundId === fundId)
    .reduce((sum, row) => sum + row.amountCents, 0);
}

async function moveFundToAccount(tx: LedgerTx, fund: Fund, destAccountId: string, note: string) {
  if (fund.accountId === destAccountId) return;
  const reserved = await reservedOnFund(tx, fund.id);
  const sourceAccountId = fund.accountId;
  if (reserved > 0) {
    const reservations = (await tx.listActiveReservations()).filter((row) => row.fundId === fund.id);
    for (const row of reservations) {
      await postLiberacion(tx, {
        reservationId: row.id,
        amountCents: row.amountCents,
        note,
        occurredAt: OPENED_AT,
      });
    }
  }
  await tx.updateFund({ ...fund, accountId: destAccountId });
  if (reserved > 0) {
    await postTransferencia(tx, {
      fromAccountId: sourceAccountId,
      toAccountId: destAccountId,
      amountCents: reserved,
      toFundId: fund.id,
      note,
      occurredAt: OPENED_AT,
    });
  }
}

/**
 * Dos cuentas de ahorro de primera clase. No inventa un tercer ahorro ni mueve
 * dinero de Ahorros → Ahorros 2 salvo el que ya estaba apartado en el fondo Ahorros 2.
 */
async function ensureTwoSavingsAccounts(tx: LedgerTx) {
  const ahorro = await tx.getAccount(IDS.accounts.ahorro);
  if (!ahorro) {
    await tx.setMeta('two_savings_accounts', '1');
    return;
  }
  if (ahorro.name === 'Ahorro' || ahorro.isCardPaymentSource) {
    await tx.updateAccount({
      ...ahorro,
      name: ahorro.name === 'Ahorro' ? 'Ahorros' : ahorro.name,
      isCardPaymentSource: false,
    });
  }

  if (!(await tx.getAccount(IDS.accounts.ahorros2))) {
    await tx.insertAccount({
      id: IDS.accounts.ahorros2,
      name: 'Ahorros 2',
      kind: 'BANK',
      visibility: 'PUBLIC',
      ownerPersonId: null,
      countsAsLiquidity: true,
      isCardPaymentSource: false,
    });
  } else {
    const ahorros2Account = await tx.getAccount(IDS.accounts.ahorros2);
    if (ahorros2Account?.isCardPaymentSource) {
      await tx.updateAccount({ ...ahorros2Account, isCardPaymentSource: false });
    }
  }

  const general = await tx.getFund(IDS.funds.ahorroGeneral);
  if (!general) {
    await tx.insertFund({
      id: IDS.funds.ahorroGeneral,
      accountId: IDS.accounts.ahorro,
      name: 'Ahorros',
      purpose: 'Ahorro presupuestado (el normal)',
      targetAmountCents: null,
      priority: 1,
      segment: 'SAVINGS',
    });
  } else {
    const next = {
      ...general,
      name: general.name === 'Ahorro general' || general.name === 'Ahorro' ? 'Ahorros' : general.name,
      accountId: IDS.accounts.ahorro,
      segment: 'SAVINGS' as const,
    };
    if (next.name !== general.name || next.accountId !== general.accountId || general.segment !== 'SAVINGS') {
      if (general.accountId !== IDS.accounts.ahorro && (await reservedOnFund(tx, general.id)) > 0) {
        await moveFundToAccount(tx, general, IDS.accounts.ahorro, 'Ahorros a su cuenta');
        const moved = await tx.getFund(IDS.funds.ahorroGeneral);
        if (moved && moved.name !== next.name) {
          await tx.updateFund({ ...moved, name: next.name, segment: 'SAVINGS' });
        }
      } else {
        await tx.updateFund(next);
      }
    }
  }

  const ahorros2 = await tx.getFund(IDS.funds.ahorros2);
  if (!ahorros2) {
    await tx.insertFund({
      id: IDS.funds.ahorros2,
      accountId: IDS.accounts.ahorros2,
      name: 'Ahorros 2',
      purpose: 'Cubre los gastos de la tarjeta ONE base; no paga ONE',
      targetAmountCents: 80000,
      priority: 2,
      segment: 'SAVINGS',
    });
  } else if (ahorros2.accountId !== IDS.accounts.ahorros2) {
    await moveFundToAccount(
      tx,
      ahorros2,
      IDS.accounts.ahorros2,
      'Separa Ahorros 2 a su propia cuenta',
    );
    const moved = await tx.getFund(IDS.funds.ahorros2);
    if (moved && moved.name !== 'Ahorros 2') {
      await tx.updateFund({
        ...moved,
        name: 'Ahorros 2',
        purpose: 'Cubre los gastos de la tarjeta ONE base; no paga ONE',
        segment: 'SAVINGS',
      });
    }
  }

  const biAhorro = await tx.getBudgetItem('bi-ahorro');
  if (biAhorro && (biAhorro.coverFundId === IDS.funds.ahorroBarras || biAhorro.name === 'Ahorro')) {
    await tx.updateBudgetItem({
      ...biAhorro,
      name: biAhorro.name === 'Ahorro' ? 'Ahorros' : biAhorro.name,
      coverFundId: IDS.funds.ahorroGeneral,
    });
  }

  await tx.setMeta('two_savings_accounts', '1');
}

async function ensureAtlantidaCreditModel(tx: LedgerTx) {
  const atlantida = await tx.getAccount(IDS.accounts.atlantida);
  if (atlantida && atlantida.kind !== 'CREDIT') {
    await tx.updateAccount({
      ...atlantida,
      kind: 'CREDIT',
      isCardPaymentSource: true,
    });
  }

  const destAhorros2 = await tx.getAccount(IDS.accounts.ahorros2);
  if (atlantida && destAhorros2 && !(await tx.getFund(IDS.funds.ahorros2))) {
    await tx.insertFund({
      id: IDS.funds.ahorros2,
      accountId: destAhorros2.id,
      name: 'Ahorros 2',
      purpose: 'Cubre los gastos de la tarjeta ONE base; no paga ONE',
      targetAmountCents: 80000,
      priority: 2,
      segment: 'SAVINGS',
    });
  }

  if (atlantida) await ensureCreditCards(tx);

  for (const [id, amountCents] of HOME_BUDGET_BUMPS) {
    const item = await tx.getBudgetItem(id);
    if (item && item.amountCents === ORIGINAL_HOME_BUDGET[id]) {
      await tx.updateBudgetItem(completeBudgetShares({ ...item, amountCents }));
    }
  }
  if (atlantida && !(await tx.getBudgetItem('bi-ahorros-2'))) {
    await tx.insertBudgetItem({
      id: 'bi-ahorros-2',
      budgetScope: 'HOME',
      name: 'Ahorros 2',
      category: 'Ahorro',
      frequency: 'QUINCENAL',
      amountCents: 4000,
      ...defaultBudgetShares('HOME', 4000, 'Ahorros 2'),
      fortnight: 'BOTH',
      coverFundId: IDS.funds.ahorros2,
      usualMedium: 'TRANSFER',
      active: true,
    });
  }

  await tx.setMeta('atlantida_credit_model', '1');
}

async function ensureBudgetShares(tx: LedgerTx) {
  if ((await tx.getMeta('budget_item_shares')) === '1') return;
  const items = await tx.listBudgetItems();
  for (const item of items) {
    await tx.updateBudgetItem(completeBudgetShares(item));
  }
  await tx.setMeta('budget_item_shares', '1');
}
