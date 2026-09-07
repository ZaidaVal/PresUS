import { describe, expect, it } from 'vitest';
import { MemoryLedger } from './memoryLedger';
import { assertCents } from './money';
import { monthlyEquivalentCents, personMonthlyEquivalentCents, completeBudgetShares } from './budget';
import { executeBudgetCover, spendFromBudget } from './budgetOps';
import { postAjuste, postCardCharge, postCardPayment, postGasto, postReserva, postTransferencia, voidTransaction } from './posting';
import type { BudgetItem } from './types';
import {
  buildMonthlySpendReport,
  itemMonthlyEquivalentCents,
  utcYearMonthFromDate,
} from './monthlySpend';

const NOW = new Date('2026-08-20T15:00:00.000Z');
const THIS_MONTH = '2026-08-10T12:00:00.000Z';
const LAST_MONTH = '2026-07-20T12:00:00.000Z';

function item(partial: Partial<BudgetItem> & Pick<BudgetItem, 'id' | 'budgetScope' | 'name' | 'category' | 'frequency' | 'amountCents'>): BudgetItem {
  return completeBudgetShares({
    fortnight: partial.frequency === 'QUINCENAL' ? 'BOTH' : 'NONE',
    coverFundId: null,
    usualMedium: 'TRANSFER',
    active: true,
    ...partial,
  });
}

async function ledgerWithSuper() {
  const ledger = new MemoryLedger();
  await ledger.withTransaction(async (tx) => {
    await tx.insertPerson({ id: 'z', code: 'Z', displayName: 'Z' });
    await tx.insertPerson({ id: 'a', code: 'A', displayName: 'A' });
    await tx.insertAccount({
      id: 'barras',
      name: 'Barras',
      kind: 'BANK',
      visibility: 'PUBLIC',
      ownerPersonId: null,
      countsAsLiquidity: true,
      isCardPaymentSource: false,
    });
    await tx.insertAccount({
      id: 'atlantida',
      name: 'Atlántida',
      kind: 'CREDIT',
      visibility: 'PUBLIC',
      ownerPersonId: 'z',
      countsAsLiquidity: true,
      isCardPaymentSource: true,
    });
    await tx.insertAccount({
      id: 'ahorro',
      name: 'Ahorro',
      kind: 'BANK',
      visibility: 'PUBLIC',
      ownerPersonId: null,
      countsAsLiquidity: true,
      isCardPaymentSource: false,
    });
    await tx.insertFund({
      id: 'super',
      accountId: 'barras',
      name: 'Super',
      purpose: 'Despensa',
      targetAmountCents: null,
      priority: 1,
      segment: 'OPERATING',
    });
    await tx.insertFund({
      id: 'personal-a',
      accountId: 'barras',
      name: 'Fondo Personal A',
      purpose: 'Personal A, no el libre de A',
      targetAmountCents: null,
      priority: 2,
      segment: 'OPERATING',
    });
    await tx.insertFund({
      id: 'libre-a',
      accountId: 'barras',
      name: 'Libre A',
      purpose: 'Libre de A',
      targetAmountCents: null,
      priority: 3,
      segment: 'OPERATING',
    });
    await tx.insertCreditCard({
      id: 'one',
      name: 'ONE',
      paymentAccountId: 'atlantida',
      coverFundId: null,
      creditLimitCents: null,
      personId: null,
    });
    await tx.insertBudgetItem(
      item({
        id: 'bi-super',
        budgetScope: 'HOME',
        name: 'Super',
        category: 'Supermercado',
        frequency: 'QUINCENAL',
        amountCents: 6500,
        coverFundId: 'super',
        usualMedium: 'CARD',
      }),
    );
    await tx.insertBudgetItem(
      item({
        id: 'bi-z-q',
        budgetScope: 'Z',
        name: 'Comida Z',
        category: 'Alimentos',
        frequency: 'QUINCENAL',
        amountCents: 10000,
      }),
    );
    await tx.insertBudgetItem(
      item({
        id: 'bi-z-m',
        budgetScope: 'Z',
        name: 'Renta Z',
        category: 'Vivienda',
        frequency: 'MENSUAL',
        amountCents: 5000,
      }),
    );
    await tx.insertBudgetItem(
      item({
        id: 'bi-a-personal',
        budgetScope: 'A',
        name: 'Personal A',
        category: 'Personal A',
        frequency: 'QUINCENAL',
        amountCents: 3000,
        coverFundId: 'personal-a',
      }),
    );
    await tx.insertBudgetItem(
      item({
        id: 'bi-a-libre',
        budgetScope: 'A',
        name: 'Libre A',
        category: 'Libre A',
        frequency: 'MENSUAL',
        amountCents: 2000,
        coverFundId: 'libre-a',
      }),
    );
    await postAjuste(tx, { accountId: 'barras', amountCents: 200000, occurredAt: THIS_MONTH });
    await postAjuste(tx, { accountId: 'atlantida', amountCents: 50000, occurredAt: THIS_MONTH });
    await postReserva(tx, { fundId: 'super', amountCents: 13000, occurredAt: THIS_MONTH });
    await postReserva(tx, { fundId: 'personal-a', amountCents: 8000, occurredAt: THIS_MONTH });
    await postReserva(tx, { fundId: 'libre-a', amountCents: 4000, occurredAt: THIS_MONTH });
  });
  return ledger;
}

async function reportFrom(ledger: MemoryLedger) {
  return ledger.withTransaction(async (tx) => {
    const items = await tx.listBudgetItems();
    const funds = await tx.listFunds();
    const transactions = await tx.listTransactions();
    const cardCharges = await tx.listCardCharges();
    const splitsByTx = new Map<string, Awaited<ReturnType<typeof tx.listSplitsForTransaction>>>();
    for (const row of transactions) {
      splitsByTx.set(row.id, await tx.listSplitsForTransaction(row.id));
    }
    return buildMonthlySpendReport({
      items,
      funds,
      transactions,
      splitsByTx,
      cardCharges,
      now: NOW,
    });
  });
}

describe('gasto mensual por área', () => {
  it('equivalente Z quincenal 10000 ¢ + mensual 5000 ¢ = 25000 ¢ sin doble conteo', () => {
    const items = [
      item({
        id: 'q',
        budgetScope: 'Z',
        name: 'Q',
        category: 'Alimentos',
        frequency: 'QUINCENAL',
        amountCents: 10000,
      }),
      item({
        id: 'm',
        budgetScope: 'Z',
        name: 'M',
        category: 'Vivienda',
        frequency: 'MENSUAL',
        amountCents: 5000,
      }),
    ];
    const report = buildMonthlySpendReport({
      items,
      funds: [],
      transactions: [],
      splitsByTx: new Map(),
      now: NOW,
    });
    expect(itemMonthlyEquivalentCents(items[0]!)).toBe(20000);
    expect(itemMonthlyEquivalentCents(items[1]!)).toBe(5000);
    expect(monthlyEquivalentCents('QUINCENAL', 10000, true) + monthlyEquivalentCents('MENSUAL', 5000, true)).toBe(
      25000,
    );
    expect(report.personZ.quincenalCents).toBe(10000);
    expect(report.personZ.mensualCents).toBe(5000);
    expect(report.personZ.budgetedMonthlyCents).toBe(25000);
    expect(report.personZ.quincenalCents + report.personZ.mensualCents).not.toBe(25000);
  });

  it('cuenta GASTO POSTED 4000 ¢ en Super este mes; VOID y TRANSFERENCIA no', async () => {
    const ledger = await ledgerWithSuper();
    await ledger.withTransaction(async (tx) => {
      await spendFromBudget(tx, { budgetItemId: 'bi-super', amountCents: 4000, occurredAt: THIS_MONTH });
      const voided = await spendFromBudget(tx, {
        budgetItemId: 'bi-super',
        amountCents: 1500,
        occurredAt: THIS_MONTH,
      });
      await voidTransaction(tx, voided);
      await postTransferencia(tx, {
        fromAccountId: 'barras',
        toAccountId: 'ahorro',
        amountCents: 2000,
        occurredAt: THIS_MONTH,
      });
      await spendFromBudget(tx, { budgetItemId: 'bi-super', amountCents: 800, occurredAt: LAST_MONTH });
    });

    const report = await reportFrom(ledger);
    const superArea = report.areas.find((row) => row.area === 'Supermercado');
    expect(superArea?.spentCents).toBe(4000);
    expect(report.totalSpentCents).toBe(4000);
    expect(report.yearMonth).toEqual(utcYearMonthFromDate(NOW));
  });

  it('el total conjunto es la suma de las áreas', async () => {
    const ledger = await ledgerWithSuper();
    await ledger.withTransaction(async (tx) => {
      await spendFromBudget(tx, { budgetItemId: 'bi-super', amountCents: 4000, occurredAt: THIS_MONTH });
      await spendFromBudget(tx, { budgetItemId: 'bi-a-personal', amountCents: 1200, occurredAt: THIS_MONTH });
      await spendFromBudget(tx, { budgetItemId: 'bi-a-libre', amountCents: 700, occurredAt: THIS_MONTH });
    });
    const report = await reportFrom(ledger);
    const sumAreas = report.areas.reduce((sum, row) => sum + row.spentCents, 0);
    expect(sumAreas).toBe(5900);
    expect(report.totalSpentCents).toBe(sumAreas);
    const personal = report.areas.find((row) => row.area === 'Personal A');
    const libre = report.areas.find((row) => row.area === 'Libre A');
    expect(personal?.spentCents).toBe(1200);
    expect(libre?.spentCents).toBe(700);
    expect(personal?.area).not.toBe(libre?.area);
  });

  it('un cargo de tarjeta cuenta una vez; el pago posterior no', async () => {
    const ledger = await ledgerWithSuper();
    await ledger.withTransaction(async (tx) => {
      await postCardCharge(tx, {
        cardId: 'one',
        amountCents: 2200,
        occurredAt: THIS_MONTH,
        note: 'Cargo Super',
      });
      await postCardPayment(tx, {
        cardId: 'one',
        fromAccountId: 'atlantida',
        amountCents: 2200,
        occurredAt: THIS_MONTH,
      });
    });
    const report = await reportFrom(ledger);
    expect(report.totalSpentCents).toBe(2200);
    expect(report.areas.find((row) => row.area === 'Cargo Super')?.spentCents).toBe(2200);
  });

  it('rechaza float en centavos y divide con trunc', () => {
    expect(() => assertCents(4000.5, 'gasto')).toThrow(/entero en centavos/);
    expect(monthlyEquivalentCents('BIMESTRAL', 10001, true)).toBe(5000);
    expect(monthlyEquivalentCents('TRIMESTRAL', 10000, true)).toBe(3333);
    expect(Number.isInteger(monthlyEquivalentCents('ANUAL', 100, true))).toBe(true);
    expect(monthlyEquivalentCents('UNICO', 80000, true)).toBe(0);
    expect(monthlyEquivalentCents('QUINCENAL', 10000, false)).toBe(0);
  });

  it('HOME no es persona: el conjunto suma cada partida una vez; Z/A usan sus shares', () => {
    const items = [
      item({
        id: 'h',
        budgetScope: 'HOME',
        name: 'Luz',
        category: 'Servicios',
        frequency: 'MENSUAL',
        amountCents: 4000,
        zShareCents: 2000,
        aShareCents: 2000,
      }),
      item({
        id: 'zq',
        budgetScope: 'Z',
        name: 'Q',
        category: 'Alimentos',
        frequency: 'QUINCENAL',
        amountCents: 10000,
      }),
      item({
        id: 'zm',
        budgetScope: 'Z',
        name: 'M',
        category: 'Vivienda',
        frequency: 'MENSUAL',
        amountCents: 5000,
      }),
      item({
        id: 'a',
        budgetScope: 'A',
        name: 'Libre',
        category: 'Libre A',
        frequency: 'MENSUAL',
        amountCents: 2000,
      }),
    ];
    const report = buildMonthlySpendReport({
      items,
      funds: [],
      transactions: [],
      splitsByTx: new Map(),
      now: NOW,
    });
    expect(report.home.budgetedMonthlyCents).toBe(4000);
    expect(report.personZ.budgetedMonthlyCents).toBe(27000);
    expect(report.personA.budgetedMonthlyCents).toBe(4000);
    expect(report.totalBudgetedMonthlyCents).toBe(31000);
    expect(report.home.scope).toBe('HOME');
  });

  it('un gasto cubierto por presupuesto cuenta; la reserva previa no', async () => {
    const ledger = await ledgerWithSuper();
    await ledger.withTransaction(async (tx) => {
      await executeBudgetCover(tx, {
        budgetItemId: 'bi-super',
        accountId: 'barras',
        amountCents: 2500,
        mode: 'AUTO',
        occurredAt: THIS_MONTH,
      });
    });
    const report = await reportFrom(ledger);
    expect(report.areas.find((row) => row.area === 'Supermercado')?.spentCents).toBe(2500);
    expect(report.totalSpentCents).toBe(2500);
  });

  it('un gasto de efectivo sin fondo usa la nota como área', async () => {
    const ledger = await ledgerWithSuper();
    await ledger.withTransaction(async (tx) => {
      await postGasto(tx, {
        accountId: 'barras',
        amountCents: 350,
        note: 'Taxi',
        occurredAt: THIS_MONTH,
      });
    });
    const report = await reportFrom(ledger);
    expect(report.areas.find((row) => row.area === 'Taxi')?.spentCents).toBe(350);
    expect(report.totalSpentCents).toBe(350);
  });
});

describe('partes Z/A de cada partida', () => {
  it('HOME 10000 ¢ con Z 6000 + A 4000 da equivalentes coherentes por persona', () => {
    const monthly = item({
      id: 'home-m',
      budgetScope: 'HOME',
      name: 'Luz',
      category: 'Servicios',
      frequency: 'MENSUAL',
      amountCents: 10000,
      zShareCents: 6000,
      aShareCents: 4000,
    });
    const quincenal = item({
      id: 'home-q',
      budgetScope: 'HOME',
      name: 'Super',
      category: 'Supermercado',
      frequency: 'QUINCENAL',
      amountCents: 10000,
      zShareCents: 6000,
      aShareCents: 4000,
    });
    expect(personMonthlyEquivalentCents(monthly, 'Z')).toBe(6000);
    expect(personMonthlyEquivalentCents(monthly, 'A')).toBe(4000);
    expect(personMonthlyEquivalentCents(quincenal, 'Z')).toBe(12000);
    expect(personMonthlyEquivalentCents(quincenal, 'A')).toBe(8000);
    const report = buildMonthlySpendReport({
      items: [monthly],
      funds: [],
      transactions: [],
      splitsByTx: new Map(),
      now: NOW,
    });
    expect(report.home.budgetedMonthlyCents).toBe(10000);
    expect(report.personZ.budgetedMonthlyCents).toBe(6000);
    expect(report.personA.budgetedMonthlyCents).toBe(4000);
    expect(report.totalBudgetedMonthlyCents).toBe(10000);
  });
});
