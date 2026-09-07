import { DomainError, type LedgerTx } from './ledger';
import { assertCents } from './money';
import { normalizeCreditCard } from './creditLine';
import { isSavingsAccount } from './segments';
import { normalizeFundDueAnchor } from './fundDue';
import {
  assertGoalPlacement,
  goalPurposeOf,
  isGoalFund,
  newGoalFundId,
  type GoalKind,
} from './projects';
import type {
  Account,
  AccountKind,
  AccountVisibility,
  CreditCard,
  Fund,
  FundSegment,
  Person,
  PersonCode,
} from './types';

const KINDS = new Set<AccountKind>(['BANK', 'CASH', 'FUND_HOLDER', 'CREDIT']);
const VISIBILITIES = new Set<AccountVisibility>(['PUBLIC', 'PRIVATE']);
const PERSON_CODES = new Set<PersonCode>(['Z', 'A']);
const SEGMENTS = new Set<FundSegment>(['OPERATING', 'SAVINGS']);

function requireName(value: string, label: string): string {
  const name = value.trim();
  if (!name) throw new DomainError(`${label} no puede quedar vacío`);
  return name;
}

export function assertPersonPatch(existing: Person, patch: Person): Person {
  if (existing.id !== patch.id) {
    throw new DomainError('No se puede cambiar el id de una persona');
  }
  if (existing.code !== patch.code) {
    throw new DomainError('Z y A son fijas: no se cambia el código de persona');
  }
  if (!PERSON_CODES.has(patch.code)) {
    throw new DomainError('Solo hay dos personas: Z y A');
  }
  return {
    id: existing.id,
    code: existing.code,
    displayName: requireName(patch.displayName, 'El nombre'),
  };
}

export async function savePersonName(tx: LedgerTx, id: string, displayName: string): Promise<Person> {
  const existing = await tx.getPerson(id);
  if (!existing) throw new DomainError('Persona no encontrada');
  const row = assertPersonPatch(existing, { ...existing, displayName });
  await tx.updatePerson(row);
  return row;
}

export function assertAccount(row: Account, people: Person[]): Account {
  const name = requireName(row.name, 'El nombre de la cuenta');
  if (!KINDS.has(row.kind)) {
    throw new DomainError('Tipo de cuenta inválido');
  }
  if (!VISIBILITIES.has(row.visibility)) {
    throw new DomainError('Visibilidad de cuenta inválida');
  }
  const ownerPersonId = row.ownerPersonId?.trim() ? row.ownerPersonId : null;
  if (ownerPersonId && !people.some((person) => person.id === ownerPersonId)) {
    throw new DomainError('La persona dueña de la cuenta no existe');
  }
  if (row.visibility === 'PRIVATE' && !ownerPersonId) {
    throw new DomainError('Una cuenta privada necesita dueño (Z o A)');
  }
  const privateAccount = row.visibility === 'PRIVATE';
  if (privateAccount && row.isCardPaymentSource) {
    throw new DomainError('El pago de tarjeta no sale de una cuenta privada');
  }
  if (isSavingsAccount(row) && row.isCardPaymentSource) {
    throw new DomainError('Ahorros no paga la tarjeta: ONE se paga solo desde Atlántida');
  }
  if (privateAccount && row.kind === 'CREDIT') {
    throw new DomainError('Una cuenta de crédito no es privada');
  }
  return {
    id: requireName(row.id, 'El id de la cuenta'),
    name,
    kind: row.kind,
    visibility: row.visibility,
    ownerPersonId,
    countsAsLiquidity: privateAccount ? false : Boolean(row.countsAsLiquidity),
    isCardPaymentSource: privateAccount ? false : Boolean(row.isCardPaymentSource),
  };
}

export async function saveAccount(tx: LedgerTx, input: Account, isNew: boolean): Promise<Account> {
  const people = await tx.listPeople();
  const row = assertAccount(input, people);
  const existing = await tx.getAccount(row.id);
  if (isNew) {
    if (existing) throw new DomainError('Ya existe una cuenta con ese id');
    await tx.insertAccount(row);
    return row;
  }
  if (!existing) throw new DomainError('Cuenta no encontrada');
  await tx.updateAccount(row);
  return row;
}

export function assertFund(
  row: Omit<Fund, 'segment' | 'interestKind' | 'annualRateBps' | 'dueAnchor'> & {
    segment?: FundSegment;
    interestKind?: Fund['interestKind'];
    annualRateBps?: Fund['annualRateBps'];
    dueAnchor?: Fund['dueAnchor'];
  },
): Fund {
  const name = requireName(row.name, 'El nombre del fondo');
  const accountId = requireName(row.accountId, 'La cuenta del fondo');
  const segment: FundSegment = row.segment && SEGMENTS.has(row.segment) ? row.segment : 'OPERATING';
  const budgetedOperating = segment === 'OPERATING';
  if (!budgetedOperating && row.targetAmountCents != null) {
    assertCents(row.targetAmountCents, 'La meta del fondo');
    if (row.targetAmountCents < 0) {
      throw new DomainError('La meta del fondo no puede ser negativa');
    }
  }
  if (row.priority != null && !Number.isInteger(row.priority)) {
    throw new DomainError('La prioridad del fondo debe ser un entero');
  }
  return {
    id: requireName(row.id, 'El id del fondo'),
    accountId,
    name,
    purpose: row.purpose.trim(),
    targetAmountCents: budgetedOperating ? null : row.targetAmountCents,
    priority: row.priority,
    segment,
    interestKind: row.interestKind ?? 'NONE',
    annualRateBps: row.annualRateBps ?? null,
    dueAnchor: normalizeFundDueAnchor(row.dueAnchor),
  };
}

export async function saveFund(
  tx: LedgerTx,
  input: Omit<Fund, 'segment' | 'interestKind' | 'annualRateBps' | 'dueAnchor'> & {
    segment?: FundSegment;
    interestKind?: Fund['interestKind'];
    annualRateBps?: Fund['annualRateBps'];
    dueAnchor?: Fund['dueAnchor'];
  },
  isNew: boolean,
): Promise<Fund> {
  const existing = await tx.getFund(input.id);
  const row = assertFund({
    ...input,
    segment: input.segment ?? existing?.segment,
    interestKind: input.interestKind ?? existing?.interestKind,
    annualRateBps: input.annualRateBps ?? existing?.annualRateBps,
    dueAnchor: input.dueAnchor !== undefined ? input.dueAnchor : existing?.dueAnchor,
  });
  const account = await tx.getAccount(row.accountId);
  if (!account) throw new DomainError('El fondo debe pertenecer a una cuenta existente');
  if (isGoalFund(row)) {
    if (row.segment !== 'SAVINGS') {
      throw new DomainError('Proyectos y sueños son fondos de ahorro, no presupuestados');
    }
    assertGoalPlacement(account);
  }

  if (isNew) {
    if (existing) throw new DomainError('Ya existe un fondo con ese id');
    await tx.insertFund(row);
    return row;
  }
  if (!existing) throw new DomainError('Fondo no encontrado');

  if (existing.accountId !== row.accountId) {
    const reservations = await tx.listActiveReservations();
    const reservedCents = reservations
      .filter((item) => item.fundId === row.id)
      .reduce((sum, item) => sum + item.amountCents, 0);
    if (reservedCents > 0) {
      throw new DomainError('No se mueve un fondo con apartado activo a otra cuenta');
    }
  }

  await tx.updateFund(row);
  return row;
}

export async function saveGoalFund(
  tx: LedgerTx,
  input: {
    id?: string;
    kind: GoalKind;
    name: string;
    accountId: string;
    targetAmountCents: number | null;
    priority: number | null;
    purposeRest?: string;
  },
  isNew: boolean,
): Promise<Fund> {
  return saveFund(
    tx,
    {
      id: input.id ?? newGoalFundId(input.kind),
      accountId: input.accountId,
      name: input.name,
      purpose: goalPurposeOf(input.kind, input.purposeRest ?? ''),
      targetAmountCents: input.targetAmountCents,
      priority: input.priority,
      segment: 'SAVINGS',
      dueAnchor: null,
    },
    isNew,
  );
}

export async function saveFunds(
  tx: LedgerTx,
  rows: Array<Parameters<typeof saveFund>[1]>,
): Promise<Fund[]> {
  const saved: Fund[] = [];
  for (const input of rows) {
    saved.push(await saveFund(tx, input, false));
  }
  return saved;
}

export function assertCreditCard(
  row: CreditCard,
  accounts: Account[],
  funds: Fund[],
  people: Person[],
): CreditCard {
  const name = requireName(row.name, 'El nombre de la tarjeta');
  const paymentAccountId = requireName(row.paymentAccountId, 'La cuenta de pago');
  const payment = accounts.find((account) => account.id === paymentAccountId);
  if (!payment) throw new DomainError('La cuenta de pago de la tarjeta no existe');
  if (payment.visibility === 'PRIVATE') {
    throw new DomainError('El pago de tarjeta no sale de una cuenta privada');
  }
  if (isSavingsAccount(payment) || !payment.isCardPaymentSource) {
    throw new DomainError('La tarjeta se paga solo desde Atlántida');
  }
  const coverFundId = row.coverFundId?.trim() ? row.coverFundId : null;
  if (coverFundId && !funds.some((fund) => fund.id === coverFundId)) {
    throw new DomainError('El fondo de cobertura de la tarjeta no existe');
  }
  if (row.creditLimitCents != null) {
    assertCents(row.creditLimitCents, 'El tope de la tarjeta');
    if (row.creditLimitCents < 0) throw new DomainError('El tope de la tarjeta no puede ser negativo');
  }
  if (row.creditLineLimitCents != null) {
    assertCents(row.creditLineLimitCents, 'El límite de la línea');
    if (row.creditLineLimitCents < 0) throw new DomainError('El límite de la línea no puede ser negativo');
  }
  if (
    row.creditLimitCents != null &&
    row.creditLineLimitCents != null &&
    row.creditLimitCents > row.creditLineLimitCents
  ) {
    throw new DomainError('El tope de la tarjeta no puede superar la línea');
  }
  const personId = row.personId?.trim() ? row.personId : null;
  if (personId && !people.some((person) => person.id === personId)) {
    throw new DomainError('La persona de la tarjeta no existe');
  }
  return {
    id: requireName(row.id, 'El id de la tarjeta'),
    name,
    paymentAccountId,
    coverFundId,
    creditLimitCents: row.creditLimitCents,
    creditLineId: row.creditLineId?.trim() ? row.creditLineId : null,
    creditLineLimitCents: row.creditLineLimitCents ?? null,
    personId,
  };
}

export async function saveCreditCard(tx: LedgerTx, input: CreditCard, isNew: boolean): Promise<CreditCard> {
  const [accounts, funds, people] = await Promise.all([tx.listAccounts(), tx.listFunds(), tx.listPeople()]);
  const row = assertCreditCard(normalizeCreditCard(input), accounts, funds, people);
  const existing = await tx.getCreditCard(row.id);
  if (isNew) {
    if (existing) throw new DomainError('Ya existe una tarjeta con ese id');
    await tx.insertCreditCard(row);
  } else {
    if (!existing) throw new DomainError('Tarjeta no encontrada');
    await tx.updateCreditCard(row);
  }
  if (row.creditLineId && row.creditLineLimitCents != null) {
    const siblings = await tx.listCreditCards();
    for (const sibling of siblings) {
      if (sibling.id === row.id) continue;
      if ((sibling.creditLineId ?? null) !== row.creditLineId) continue;
      if (sibling.creditLineLimitCents === row.creditLineLimitCents) continue;
      await tx.updateCreditCard({ ...sibling, creditLineLimitCents: row.creditLineLimitCents });
    }
  }
  return row;
}

export async function removeAccount(tx: LedgerTx, accountId: string): Promise<void> {
  const account = await tx.getAccount(accountId);
  if (!account) throw new DomainError('Cuenta no encontrada');
  const funds = await tx.listFundsByAccount(accountId);
  if (funds.length > 0) {
    throw new DomainError(
      `No se puede quitar ${account.name}: tiene fondos. Quítalos o muévelos antes. El historial POSTED no se borra.`,
    );
  }
  const splits = await tx.listSplits();
  if (splits.some((split) => split.accountId === accountId)) {
    throw new DomainError(
      `No se puede quitar ${account.name}: hay movimientos. Anúlalos desde el historial. El libro no se borra.`,
    );
  }
  const cards = await tx.listCreditCards();
  if (cards.some((card) => card.paymentAccountId === accountId)) {
    throw new DomainError(`No se puede quitar ${account.name}: hay tarjetas que pagan desde aquí.`);
  }
  const debts = await tx.listDebts();
  if (debts.some((debt) => debt.paymentAccountId === accountId)) {
    throw new DomainError(`No se puede quitar ${account.name}: hay deudas ligadas a esta cuenta.`);
  }
  await tx.deleteAccount(accountId);
}

export async function removeFund(tx: LedgerTx, fundId: string): Promise<void> {
  const fund = await tx.getFund(fundId);
  if (!fund) throw new DomainError('Fondo no encontrado');
  const splits = await tx.listSplits();
  if (splits.some((split) => split.fundId === fundId)) {
    throw new DomainError(
      `No se puede quitar ${fund.name}: hay movimientos. Anúlalos desde el historial. El libro no se borra.`,
    );
  }
  const reservations = await tx.listReservations();
  if (reservations.some((row) => row.fundId === fundId)) {
    throw new DomainError(
      `No se puede quitar ${fund.name}: hay reservas en el historial. Anula esos movimientos. El libro no se borra.`,
    );
  }
  const cards = await tx.listCreditCards();
  if (cards.some((card) => card.coverFundId === fundId)) {
    throw new DomainError(`No se puede quitar ${fund.name}: cubre una tarjeta.`);
  }
  const items = await tx.listBudgetItems();
  if (items.some((item) => item.coverFundId === fundId)) {
    throw new DomainError(`No se puede quitar ${fund.name}: cubre una partida de presupuesto.`);
  }
  const debts = await tx.listDebts();
  if (debts.some((debt) => debt.coverFundId === fundId)) {
    throw new DomainError(`No se puede quitar ${fund.name}: cubre una deuda.`);
  }
  const charges = await tx.listCardCharges();
  if (charges.some((charge) => charge.coverFundId === fundId)) {
    throw new DomainError(
      `No se puede quitar ${fund.name}: hay cargos de tarjeta cubiertos. Anúlalos desde el historial.`,
    );
  }
  await tx.deleteFund(fundId);
}

export async function removeCreditCard(tx: LedgerTx, cardId: string): Promise<void> {
  const card = await tx.getCreditCard(cardId);
  if (!card) throw new DomainError('Tarjeta no encontrada');
  const splits = await tx.listSplits();
  if (splits.some((split) => split.cardId === cardId)) {
    throw new DomainError(
      `No se puede quitar ${card.name}: hay movimientos. Anúlalos desde el historial. El libro no se borra.`,
    );
  }
  const charges = await tx.listCardCharges();
  if (charges.some((charge) => charge.cardId === cardId)) {
    throw new DomainError(
      `No se puede quitar ${card.name}: hay cargos en el historial. Anúlalos. El libro no se borra.`,
    );
  }
  await tx.deleteCreditCard(cardId);
}
