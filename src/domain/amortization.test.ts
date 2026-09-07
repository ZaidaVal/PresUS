import { describe, expect, it } from 'vitest';
import { MemoryLedger } from './memoryLedger';
import { DomainError } from './ledger';
import {
  compareAmortization,
  frenchInstallmentCents,
  monthlyInterestCents,
  simulateAmortization,
  splitDebtPayment,
  simulateAmortizationSchedule,
  plannedRemainingAfterMonth,
} from './amortization';
import { remainingDebtCents, saveDebt } from './debts';
import { postAjuste, postPagoDeuda } from './posting';
import { computeSafeAvailable } from './balances';
import type { Debt } from './types';

const PRINCIPAL = 10_000_000;
const RATE_BPS = 600;
const TERM = 360;

function sampleDebt(overrides: Partial<Debt> = {}): Debt {
  const installmentCents =
    overrides.installmentCents ??
    frenchInstallmentCents(PRINCIPAL, RATE_BPS, TERM, 'MONTHLY');
  return {
    id: 'debt-1',
    name: 'Hipoteca',
    kind: 'MORTGAGE',
    originalCents: PRINCIPAL,
    annualRateBps: RATE_BPS,
    termMonths: TERM,
    installmentCents,
    startedAt: '2026-08-01T00:00:00.000Z',
    paymentAccountId: 'barras',
    coverFundId: null,
    amortization: 'FRENCH',
    compounding: 'MONTHLY',
    extraMonthlyCents: 0,
    extraFortnightCents: 0,
    extraEveryNMonths: null,
    extraEveryNAmountCents: 0,
    note: '',
    active: true,
    ...overrides,
  };
}

async function setup() {
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
      id: 'priv-a',
      name: 'Cuenta A',
      kind: 'BANK',
      visibility: 'PRIVATE',
      ownerPersonId: 'a',
      countsAsLiquidity: false,
      isCardPaymentSource: false,
    });
    await tx.insertFund({
      id: 'casa',
      accountId: 'barras',
      name: 'Casa',
      purpose: 'Vivienda',
      targetAmountCents: null,
      priority: 1,
      segment: 'OPERATING',
    });
  });
  return ledger;
}

describe('cuota francesa', () => {
  it('salda $100k al 6% en 360 meses con centavos enteros', () => {
    const installment = frenchInstallmentCents(PRINCIPAL, RATE_BPS, TERM, 'MONTHLY');
    expect(Number.isInteger(installment)).toBe(true);
    expect(installment).toBeGreaterThan(monthlyInterestCents(PRINCIPAL, RATE_BPS, 'MONTHLY'));
    const sim = simulateAmortization({
      principalCents: PRINCIPAL,
      annualRateBps: RATE_BPS,
      installmentCents: installment,
      termMonths: TERM,
      amortization: 'FRENCH',
      compounding: 'MONTHLY',
    });
    expect(sim.paidOff).toBe(true);
    expect(sim.months).toBeLessThanOrEqual(TERM);
    expect(sim.totalPrincipalCents).toBe(PRINCIPAL);
    expect(Number.isInteger(sim.totalInterestCents)).toBe(true);
  });

  it('rechaza capital o tasa con float', () => {
    expect(() => frenchInstallmentCents(10000000.5, RATE_BPS, TERM)).toThrow(/entero en centavos/);
    expect(() =>
      splitDebtPayment({
        remainingCents: PRINCIPAL,
        annualRateBps: 6.5,
        compounding: 'MONTHLY',
        amortization: 'FRENCH',
        originalCents: PRINCIPAL,
        amountCents: 60000,
      }),
    ).toThrow(DomainError);
    expect(() => monthlyInterestCents(100.25, RATE_BPS)).toThrow(/entero en centavos/);
  });

  it('compuesto sobre saldo restante no es interés simple sobre el original', () => {
    const installment = frenchInstallmentCents(PRINCIPAL, RATE_BPS, TERM, 'MONTHLY');
    const french = simulateAmortization({
      principalCents: PRINCIPAL,
      annualRateBps: RATE_BPS,
      installmentCents: installment,
      termMonths: TERM,
      amortization: 'FRENCH',
      compounding: 'MONTHLY',
    });
    const simple = simulateAmortization({
      principalCents: PRINCIPAL,
      annualRateBps: RATE_BPS,
      installmentCents: installment,
      termMonths: TERM,
      amortization: 'SIMPLE',
      compounding: 'MONTHLY',
    });
    expect(simple.totalInterestCents).not.toBe(french.totalInterestCents);
    expect(simple.totalInterestCents).toBeGreaterThan(french.totalInterestCents);
  });

  it('un extra mensual reduce meses e interés total', () => {
    const installment = frenchInstallmentCents(PRINCIPAL, RATE_BPS, TERM, 'MONTHLY');
    const compared = compareAmortization(
      {
        principalCents: PRINCIPAL,
        annualRateBps: RATE_BPS,
        installmentCents: installment,
        termMonths: TERM,
        amortization: 'FRENCH',
        compounding: 'MONTHLY',
      },
      {
        principalCents: PRINCIPAL,
        annualRateBps: RATE_BPS,
        installmentCents: installment,
        termMonths: TERM,
        amortization: 'FRENCH',
        compounding: 'MONTHLY',
        extraMonthlyCents: 20000,
      },
    );
    expect(compared.monthsSaved).toBeGreaterThan(0);
    expect(compared.interestSavedCents).toBeGreaterThan(0);
  });

  it('escenarios $0 / $50 / $100 / $200 son centavos enteros y el extra acorta', () => {
    const installment = frenchInstallmentCents(PRINCIPAL, RATE_BPS, TERM, 'MONTHLY');
    const extras = [0, 5_000, 10_000, 20_000];
    const results = extras.map((extraMonthlyCents) =>
      simulateAmortization({
        principalCents: PRINCIPAL,
        annualRateBps: RATE_BPS,
        installmentCents: installment,
        termMonths: TERM,
        amortization: 'FRENCH',
        compounding: 'MONTHLY',
        extraMonthlyCents,
      }),
    );
    expect(results.every((row) => Number.isInteger(row.totalInterestCents))).toBe(true);
    expect(results[1]!.months).toBeLessThan(results[0]!.months);
    expect(results[2]!.months).toBeLessThan(results[1]!.months);
    expect(results[3]!.months).toBeLessThan(results[2]!.months);
    expect(results[3]!.totalInterestCents).toBeLessThan(results[0]!.totalInterestCents);
  });

  it('tres abonos al año ene/jul/dic de Z $200 + A $300 aplican 50000¢ esos meses', () => {
    const installment = frenchInstallmentCents(PRINCIPAL, RATE_BPS, TERM, 'MONTHLY');
    const seasonalExtraCents = 20_000 + 30_000;
    const rows = simulateAmortizationSchedule({
      principalCents: PRINCIPAL,
      annualRateBps: RATE_BPS,
      installmentCents: installment,
      termMonths: TERM,
      amortization: 'FRENCH',
      compounding: 'MONTHLY',
      startedAt: '2026-01-01T00:00:00.000Z',
      seasonalMonths: [0, 6, 11],
      seasonalExtraCents,
    });
    const seasonal = rows.filter((row) => row.extraCents === seasonalExtraCents);
    expect(seasonal.length).toBeGreaterThanOrEqual(3);
    expect(rows.filter((row) => row.monthIndex < 12 && row.extraCents === seasonalExtraCents)).toHaveLength(3);
    expect(rows[0]?.calendarMonth).toBe(0);
    expect(rows[0]?.extraCents).toBe(seasonalExtraCents);
    expect(rows[5]?.extraCents).toBe(0);
    expect(rows[6]?.extraCents).toBe(seasonalExtraCents);
    expect(rows[11]?.extraCents).toBe(seasonalExtraCents);
    const withSeasonal = simulateAmortization({
      principalCents: PRINCIPAL,
      annualRateBps: RATE_BPS,
      installmentCents: installment,
      termMonths: TERM,
      amortization: 'FRENCH',
      compounding: 'MONTHLY',
      startedAt: '2026-01-01T00:00:00.000Z',
      seasonalMonths: [0, 6, 11],
      seasonalExtraCents,
    });
    const plain = simulateAmortization({
      principalCents: PRINCIPAL,
      annualRateBps: RATE_BPS,
      installmentCents: installment,
      termMonths: TERM,
      amortization: 'FRENCH',
      compounding: 'MONTHLY',
    });
    expect(withSeasonal.months).toBeLessThan(plain.months);
    expect(Number.isInteger(withSeasonal.totalInterestCents)).toBe(true);
  });

  it('capital 0 no inventa un plan', () => {
    const rows = simulateAmortizationSchedule({
      principalCents: 0,
      annualRateBps: 0,
      installmentCents: 0,
      termMonths: 360,
      amortization: 'FRENCH',
      compounding: 'MONTHLY',
    });
    expect(rows).toEqual([]);
    expect(
      simulateAmortization({
        principalCents: 0,
        annualRateBps: 0,
        installmentCents: 0,
        termMonths: 360,
        amortization: 'FRENCH',
        compounding: 'MONTHLY',
      }).paidOff,
    ).toBe(true);
  });

  it('el check de mes usa el saldo planeado de esa fila', () => {
    const installment = frenchInstallmentCents(PRINCIPAL, RATE_BPS, TERM, 'MONTHLY');
    const rows = simulateAmortizationSchedule({
      principalCents: PRINCIPAL,
      annualRateBps: RATE_BPS,
      installmentCents: installment,
      termMonths: TERM,
      amortization: 'FRENCH',
      compounding: 'MONTHLY',
    });
    expect(plannedRemainingAfterMonth(rows, PRINCIPAL, null)).toBe(PRINCIPAL);
    expect(plannedRemainingAfterMonth(rows, PRINCIPAL, 0)).toBe(rows[0]!.remainingCents);
    expect(plannedRemainingAfterMonth(rows, PRINCIPAL, 0)).toBeLessThan(PRINCIPAL);
  });
});

describe('pago de hipoteca', () => {
  it('crear la deuda no mueve efectivo', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 148000 });
      await saveDebt(tx, sampleDebt(), true);
      const splits = await tx.listPostedSplitsForAccount('barras');
      const saldo = splits
        .filter((row) => row.accountId === 'barras')
        .reduce((sum, row) => sum + row.amountCents, 0);
      expect(saldo).toBe(148000);
      expect((await tx.listTransactions()).every((row) => row.type === 'AJUSTE')).toBe(true);
    });
  });

  it('el capital hipotecario no entra a debo; la obligación próxima es la cuota', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 148000 });
      const debt = await saveDebt(tx, sampleDebt(), true);
      const safe = await computeSafeAvailable(tx);
      const firstInterest = monthlyInterestCents(PRINCIPAL, RATE_BPS, 'MONTHLY');
      expect(safe.deboCents).toBe(0);
      expect(safe.obligacionesNoReservadasCents).toBe(debt.installmentCents);
      expect(safe.obligacionesNoReservadasCents).toBeLessThan(PRINCIPAL);
      expect(safe.disponibleSeguroCents).toBe(0);
      expect(firstInterest).toBe(50000);
    });
  });

  it('un pago POSTED reduce el principal reconstruido y los splits suman 0', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 200000 });
      const debt = await saveDebt(tx, sampleDebt(), true);
      const split = splitDebtPayment({
        remainingCents: PRINCIPAL,
        annualRateBps: RATE_BPS,
        compounding: 'MONTHLY',
        amortization: 'FRENCH',
        originalCents: PRINCIPAL,
        amountCents: debt.installmentCents,
      });
      const id = await postPagoDeuda(tx, {
        debtId: debt.id,
        amountCents: debt.installmentCents,
        accountId: 'barras',
      });
      const row = await tx.getTransaction(id);
      expect(row?.type).toBe('PAGO_DEUDA');
      expect(row?.status).toBe('POSTED');
      const splits = await tx.listSplitsForTransaction(id);
      expect(splits.reduce((sum, item) => sum + item.amountCents, 0)).toBe(0);
      expect(splits.some((item) => item.role === 'SOURCE' && item.amountCents === -debt.installmentCents)).toBe(
        true,
      );
      expect(splits.some((item) => item.role === 'EQUITY' && item.amountCents === debt.installmentCents)).toBe(
        true,
      );
      const payments = await tx.listDebtPaymentsByDebt(debt.id);
      expect(payments).toHaveLength(1);
      expect(payments[0]?.principalCents).toBe(split.principalCents);
      expect(payments[0]?.interestCents).toBe(split.interestCents);
      expect(payments[0]?.principalCents + payments[0]?.interestCents).toBe(debt.installmentCents);
      const remaining = remainingDebtCents(debt.originalCents, payments, await tx.listTransactions());
      expect(remaining).toBe(PRINCIPAL - split.principalCents);
      expect(remaining).toBeLessThan(PRINCIPAL);
    });
  });

  it('rechaza pagar desde una cuenta privada', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 200000 });
      const debt = await saveDebt(tx, sampleDebt(), true);
      await expect(
        postPagoDeuda(tx, { debtId: debt.id, amountCents: debt.installmentCents, accountId: 'priv-a' }),
      ).rejects.toThrow(/no puede ser privada/);
    });
  });
});
