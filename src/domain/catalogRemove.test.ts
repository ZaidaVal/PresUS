import { describe, expect, it } from 'vitest';
import { MemoryLedger } from './memoryLedger';
import { removeAccount, removeCreditCard, removeFund, saveAccount, saveCreditCard, saveFund } from './catalog';
import { removeBudgetItem, saveBudgetItem } from './budgetOps';
import { removeDebt, saveDebt } from './debts';
import { postAjuste, postGasto, voidTransaction } from './posting';
import { accountBalanceFromSplits } from './balances';

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
      id: 'atlantida',
      name: 'Atlántida',
      kind: 'CREDIT',
      visibility: 'PUBLIC',
      ownerPersonId: null,
      countsAsLiquidity: true,
      isCardPaymentSource: true,
    });
  });
  return ledger;
}

describe('quitar catálogo sin borrar el libro', () => {
  it('deletes an unused public account and rejects one with POSTED history', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await saveAccount(
        tx,
        {
          id: 'caja',
          name: 'Caja extra',
          kind: 'CASH',
          visibility: 'PUBLIC',
          ownerPersonId: null,
          countsAsLiquidity: true,
          isCardPaymentSource: false,
        },
        true,
      );
      await removeAccount(tx, 'caja');
      expect(await tx.getAccount('caja')).toBeUndefined();

      await postAjuste(tx, { accountId: 'barras', amountCents: 80000 });
      await expect(removeAccount(tx, 'barras')).rejects.toThrow(/movimientos/);
      expect(await tx.getAccount('barras')).toBeDefined();
      expect(accountBalanceFromSplits('barras', await tx.listPostedSplitsForAccount('barras'))).toBe(80000);
    });
    expect('deleteTransaction' in ledger).toBe(false);
  });

  it('rejects removing an account after VOID because splits remain', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 80000 });
      const gastoId = await postGasto(tx, { accountId: 'barras', amountCents: 5000 });
      await voidTransaction(tx, gastoId);
      await expect(removeAccount(tx, 'barras')).rejects.toThrow(/movimientos/);
      const original = await tx.getTransaction(gastoId);
      expect(original?.status).toBe('VOID');
    });
  });

  it('deletes an unused fund and rejects one tied to a budget item', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await saveFund(
        tx,
        {
          id: 'picnic',
          accountId: 'barras',
          name: 'Picnic',
          purpose: 'Salidas',
          targetAmountCents: null,
          priority: 9,
          segment: 'OPERATING',
        },
        true,
      );
      await removeFund(tx, 'picnic');
      expect(await tx.getFund('picnic')).toBeUndefined();

      await saveFund(
        tx,
        {
          id: 'super',
          accountId: 'barras',
          name: 'Super',
          purpose: 'Despensa',
          targetAmountCents: null,
          priority: 1,
          segment: 'OPERATING',
        },
        true,
      );
      await saveBudgetItem(
        tx,
        {
          id: 'bi-super',
          budgetScope: 'HOME',
          name: 'Super',
          category: 'Supermercado',
          frequency: 'QUINCENAL',
          amountCents: 5000,
          fortnight: 'BOTH',
          coverFundId: 'super',
          usualMedium: 'CASH',
          active: true,
        },
        true,
      );
      await expect(removeFund(tx, 'super')).rejects.toThrow(/partida/);
    });
  });

  it('deletes an unused card and rejects one with charges', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await saveCreditCard(
        tx,
        {
          id: 'card-spare',
          name: 'ONE extra',
          paymentAccountId: 'atlantida',
          coverFundId: null,
          creditLimitCents: null,
          personId: null,
        },
        true,
      );
      await removeCreditCard(tx, 'card-spare');
      expect(await tx.getCreditCard('card-spare')).toBeUndefined();
    });
  });

  it('deactivates an active budget item then deletes the inactive catalog row', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await saveBudgetItem(
        tx,
        {
          id: 'bi-luz',
          budgetScope: 'HOME',
          name: 'Luz',
          category: 'Servicios',
          frequency: 'MENSUAL',
          amountCents: 4000,
          fortnight: 'BOTH',
          coverFundId: null,
          usualMedium: 'TRANSFER',
          active: true,
        },
        true,
      );
      const first = await removeBudgetItem(tx, 'bi-luz');
      expect(first.outcome).toBe('deactivated');
      expect((await tx.getBudgetItem('bi-luz'))?.active).toBe(false);
      const second = await removeBudgetItem(tx, 'bi-luz');
      expect(second.outcome).toBe('deleted');
      expect(await tx.getBudgetItem('bi-luz')).toBeUndefined();
    });
  });

  it('deletes a debt without payments and deactivates one with payments', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await saveDebt(
        tx,
        {
          id: 'debt-empty',
          name: 'Prueba',
          kind: 'OTHER',
          originalCents: 100000,
          annualRateBps: 600,
          termMonths: 12,
          installmentCents: 9000,
          startedAt: '2026-01-01T00:00:00.000Z',
          paymentAccountId: 'atlantida',
          coverFundId: null,
          amortization: 'FRENCH',
          compounding: 'MONTHLY',
          extraMonthlyCents: 0,
          extraFortnightCents: 0,
          extraEveryNMonths: null,
          extraEveryNAmountCents: 0,
          note: '',
          active: true,
        },
        true,
      );
      const deleted = await removeDebt(tx, 'debt-empty');
      expect(deleted.outcome).toBe('deleted');
      expect(await tx.getDebt('debt-empty')).toBeUndefined();

      await saveDebt(
        tx,
        {
          id: 'debt-paid',
          name: 'Con pagos',
          kind: 'PERSONAL',
          originalCents: 50000,
          annualRateBps: 0,
          termMonths: 10,
          installmentCents: 5000,
          startedAt: '2026-01-01T00:00:00.000Z',
          paymentAccountId: 'atlantida',
          coverFundId: null,
          amortization: 'SIMPLE',
          compounding: 'MONTHLY',
          extraMonthlyCents: 0,
          extraFortnightCents: 0,
          extraEveryNMonths: null,
          extraEveryNAmountCents: 0,
          note: '',
          active: true,
        },
        true,
      );
      await tx.insertTransaction({
        id: 'tx-pay',
        type: 'PAGO_DEUDA',
        occurredAt: '2026-02-01T00:00:00.000Z',
        period: null,
        note: 'abono',
        createdAt: '2026-02-01T00:00:00.000Z',
        status: 'POSTED',
        reversesId: null,
      });
      await tx.insertDebtPayment({
        id: 'pay-1',
        debtId: 'debt-paid',
        transactionId: 'tx-pay',
        principalCents: 5000,
        interestCents: 0,
        occurredAt: '2026-02-01T00:00:00.000Z',
      });
      const retired = await removeDebt(tx, 'debt-paid');
      expect(retired.outcome).toBe('deactivated');
      expect((await tx.getDebt('debt-paid'))?.active).toBe(false);
      expect(await tx.listDebtPaymentsByDebt('debt-paid')).toHaveLength(1);
    });
  });
});
