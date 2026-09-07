import { describe, expect, it } from 'vitest';
import { MemoryLedger } from './memoryLedger';
import { accountBalanceFromSplits, computeAccountBalances, computeFundBalances } from './balances';
import {
  assignGastoToBudgetItem,
  executeBudgetCutoff,
  itemOverrunCents,
  buildBudgetOverrunReport,
  parseBudgetCutoffs,
  planCutoffTransferFromTx,
  cutoffDestinationAccounts,
  planReserveCover,
  utcPeriodRef,
} from './index';
import { postAjuste, postReserva } from './posting';

const Q2 = '2026-08-20T15:00:00.000Z';
const CUTOFF_AT = new Date('2026-08-20T18:00:00.000Z');

async function setupSuper() {
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
      id: 'luz',
      accountId: 'barras',
      name: 'Luz',
      purpose: 'Servicios',
      targetAmountCents: null,
      priority: 2,
      segment: 'OPERATING',
    });
    await tx.insertBudgetItem({
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
    });
    await tx.insertBudgetItem({
      id: 'bi-luz',
      budgetScope: 'HOME',
      name: 'Luz',
      category: 'Servicios',
      frequency: 'QUINCENAL',
      amountCents: 4000,
      fortnight: 'BOTH',
      coverFundId: 'luz',
      usualMedium: 'CASH',
      active: true,
    });
    await postAjuste(tx, { accountId: 'barras', amountCents: 100000, occurredAt: Q2 });
    await postAjuste(tx, { accountId: 'ahorro', amountCents: 80000, occurredAt: Q2 });
  });
  return ledger;
}

describe('planReserveCover', () => {
  it('clamps consumed to min(gasto, apartado, indicado)', () => {
    const plan = planReserveCover({
      amountCents: 8000,
      reservedCents: 5000,
      availableCents: 95000,
      coverFromReserveCents: 8000,
      fundName: 'Super',
      accountName: 'Barras',
    });
    expect(plan.consumedCents).toBe(5000);
    expect(plan.fromAvailableCents).toBe(3000);
    expect(plan.leftoverReserveCents).toBe(0);
    expect(plan.feasible).toBe(true);
  });

  it('rejects a float cover amount', () => {
    expect(() =>
      planReserveCover({
        amountCents: 8000,
        reservedCents: 5000,
        availableCents: 95000,
        coverFromReserveCents: 50.5,
        fundName: 'Super',
        accountName: 'Barras',
      }),
    ).toThrow(/entero/);
  });
});

describe('assignGastoToBudgetItem', () => {
  it('consumes Super 5000 of an 8000 gasto and records 3000 overrun from available', async () => {
    const ledger = await setupSuper();
    await ledger.withTransaction(async (tx) => {
      await postReserva(tx, { fundId: 'super', amountCents: 5000, occurredAt: Q2 });
      await postReserva(tx, { fundId: 'luz', amountCents: 4000, occurredAt: Q2 });
      const before = (await computeAccountBalances(tx)).find((row) => row.account.id === 'barras')!;
      expect(before.disponibleCents).toBe(91000);

      const result = await assignGastoToBudgetItem(tx, {
        budgetItemId: 'bi-super',
        accountId: 'barras',
        amountCents: 8000,
        coverFromReserveCents: 8000,
        occurredAt: Q2,
      });
      expect(result.consumedCents).toBe(5000);
      expect(result.fromAvailableCents).toBe(3000);
      expect(result.leftoverReserveCents).toBe(0);

      const barras = (await computeAccountBalances(tx)).find((row) => row.account.id === 'barras')!;
      expect(barras.saldoCents).toBe(92000);
      expect(barras.disponibleCents).toBe(88000);
      expect(before.disponibleCents - barras.disponibleCents).toBe(3000);

      const funds = await computeFundBalances(tx);
      expect(funds.find((row) => row.fund.id === 'super')?.reservedCents).toBe(0);
      expect(funds.find((row) => row.fund.id === 'luz')?.reservedCents).toBe(4000);

      const gasto = await tx.getTransaction(result.gastoTransactionId);
      expect(gasto?.type).toBe('GASTO');
      expect(gasto?.status).toBe('POSTED');
      const splits = await tx.listSplitsForTransaction(result.gastoTransactionId);
      expect(splits.reduce((sum, split) => sum + split.amountCents, 0)).toBe(0);
      expect(accountBalanceFromSplits('barras', await tx.listPostedSplitsForAccount('barras'))).toBe(92000);
    });
    await ledger.withTransaction(async (tx) => {
      const transactions = await tx.listTransactions();
      const splits = await tx.listSplits();
      const splitsByTx = new Map<string, typeof splits>();
      for (const split of splits) {
        const list = splitsByTx.get(split.transactionId) ?? [];
        list.push(split);
        splitsByTx.set(split.transactionId, list);
      }
      const report = buildBudgetOverrunReport({
        items: await tx.listBudgetItems(),
        funds: await tx.listFunds(),
        transactions,
        splitsByTx,
        period: utcPeriodRef(CUTOFF_AT),
      });
      const superRow = report.rows.find((row) => row.budgetItemId === 'bi-super')!;
      expect(superRow.budgetedCents).toBe(5000);
      expect(superRow.spentCents).toBe(8000);
      expect(superRow.overrunCents).toBe(3000);
      expect(itemOverrunCents(8000, 5000)).toBe(3000);
      expect(report.overRows.some((row) => row.budgetItemId === 'bi-super')).toBe(true);
    });
  });

  it('consumes 2000 of Super 5000 and leaves 3000 reserved with no overrun', async () => {
    const ledger = await setupSuper();
    await ledger.withTransaction(async (tx) => {
      await postReserva(tx, { fundId: 'super', amountCents: 5000, occurredAt: Q2 });
      const result = await assignGastoToBudgetItem(tx, {
        budgetItemId: 'bi-super',
        accountId: 'barras',
        amountCents: 2000,
        coverFromReserveCents: 2000,
        occurredAt: Q2,
      });
      expect(result.consumedCents).toBe(2000);
      expect(result.fromAvailableCents).toBe(0);
      expect(result.leftoverReserveCents).toBe(3000);

      const barras = (await computeAccountBalances(tx)).find((row) => row.account.id === 'barras')!;
      expect(barras.saldoCents).toBe(98000);
      expect(barras.reservedCents).toBe(3000);
      expect(barras.disponibleCents).toBe(95000);

      const funds = await computeFundBalances(tx);
      expect(funds.find((row) => row.fund.id === 'super')?.reservedCents).toBe(3000);

      const splits = await tx.listSplitsForTransaction(result.gastoTransactionId);
      expect(splits.reduce((sum, split) => sum + split.amountCents, 0)).toBe(0);

      const transactions = await tx.listTransactions();
      const allSplits = await tx.listSplits();
      const splitsByTx = new Map<string, typeof allSplits>();
      for (const split of allSplits) {
        const list = splitsByTx.get(split.transactionId) ?? [];
        list.push(split);
        splitsByTx.set(split.transactionId, list);
      }
      const report = buildBudgetOverrunReport({
        items: await tx.listBudgetItems(),
        funds: await tx.listFunds(),
        transactions,
        splitsByTx,
        period: utcPeriodRef(CUTOFF_AT),
      });
      expect(report.rows.find((row) => row.budgetItemId === 'bi-super')?.overrunCents).toBe(0);
    });
  });

  it('writes a manual cutoff and rejects a second close of the same period', async () => {
    const ledger = await setupSuper();
    await ledger.withTransaction(async (tx) => {
      await postReserva(tx, { fundId: 'super', amountCents: 5000, occurredAt: Q2 });
      await assignGastoToBudgetItem(tx, {
        budgetItemId: 'bi-super',
        accountId: 'barras',
        amountCents: 8000,
        coverFromReserveCents: 5000,
        occurredAt: Q2,
      });
      const first = await executeBudgetCutoff(tx, { now: CUTOFF_AT });
      expect(first.key).toBe('2026-08:Q2');
      expect(first.label).toBe('Corte del 29');
      expect(first.totalOverrunCents).toBe(3000);
      expect(first.rows.find((row) => row.budgetItemId === 'bi-super')?.overrunCents).toBe(3000);
      expect(await tx.getMeta('last_cutoff_at')).toBe(first.closedAt);
      const stored = parseBudgetCutoffs(await tx.getMeta('budget_cutoffs'));
      expect(stored).toHaveLength(1);
      expect(stored[0]?.key).toBe('2026-08:Q2');

      const funds = await computeFundBalances(tx);
      expect(funds.find((row) => row.fund.id === 'super')?.reservedCents).toBe(0);
      const txs = await tx.listTransactions();
      expect(txs.filter((row) => row.type === 'GASTO' && row.status === 'POSTED')).toHaveLength(1);
    });
    await expect(
      ledger.withTransaction((tx) => executeBudgetCutoff(tx, { now: CUTOFF_AT })),
    ).rejects.toThrow(/ya está cortado/);
  });

  it('mueve excedente 5000 a Ahorro: origen -5000 apartado, destino +5000, no es GASTO', async () => {
    const ledger = await setupSuper();
    await ledger.withTransaction(async (tx) => {
      await postReserva(tx, { fundId: 'super', amountCents: 5000, occurredAt: Q2 });
      const plan = await planCutoffTransferFromTx(tx, { now: CUTOFF_AT, toAccountId: 'ahorro' });
      expect(plan.feasible).toBe(true);
      expect(plan.totalLeftoverCents).toBe(5000);
      expect(plan.totalTransferredCents).toBe(5000);
      expect(plan.destinationSaldoAfterCents).toBe(plan.destinationSaldoBeforeCents + 5000);
      expect(plan.lines.find((row) => row.budgetItemId === 'bi-super')?.leftoverCents).toBe(5000);
      expect(plan.lines.find((row) => row.budgetItemId === 'bi-super')?.overrunCents).toBe(0);

      const record = await executeBudgetCutoff(tx, { now: CUTOFF_AT, toAccountId: 'ahorro' });
      expect(record.leftoverMovedCents).toBe(5000);
      expect(record.destinationAccountId).toBe('ahorro');
      const funds = await computeFundBalances(tx);
      expect(funds.find((row) => row.fund.id === 'super')?.reservedCents).toBe(0);
      expect(accountBalanceFromSplits('barras', await tx.listPostedSplitsForAccount('barras'))).toBe(95000);
      expect(accountBalanceFromSplits('ahorro', await tx.listPostedSplitsForAccount('ahorro'))).toBe(85000);
      const txs = await tx.listTransactions();
      const moved = txs.filter((row) => row.note.includes('Corte') && row.status === 'POSTED');
      expect(moved.every((row) => row.type === 'TRANSFERENCIA')).toBe(true);
      expect(moved.some((row) => row.type === 'GASTO')).toBe(false);
      for (const row of moved) {
        const splits = await tx.listSplitsForTransaction(row.id);
        expect(splits.reduce((sum, split) => sum + split.amountCents, 0)).toBe(0);
      }
    });
    await expect(
      ledger.withTransaction((tx) => executeBudgetCutoff(tx, { now: CUTOFF_AT, toAccountId: 'ahorro' })),
    ).rejects.toThrow(/ya está cortado/);
  });

  it('sin destino elegido no corta ni mueve el excedente', async () => {
    const ledger = await setupSuper();
    await ledger.withTransaction(async (tx) => {
      await postReserva(tx, { fundId: 'super', amountCents: 5000, occurredAt: Q2 });
      const plan = await planCutoffTransferFromTx(tx, { now: CUTOFF_AT });
      expect(plan.feasible).toBe(false);
      expect(plan.rejection).toMatch(/Elige la cuenta destino/);
      expect(plan.toAccountId).toBe('');
      expect(plan.totalLeftoverCents).toBe(5000);
      expect(plan.totalTransferredCents).toBe(0);
    });
    await expect(
      ledger.withTransaction((tx) => executeBudgetCutoff(tx, { now: CUTOFF_AT })),
    ).rejects.toThrow(/Elige la cuenta destino/);
    await ledger.withTransaction(async (tx) => {
      expect(parseBudgetCutoffs(await tx.getMeta('budget_cutoffs'))).toEqual([]);
      expect(await tx.getMeta('last_cutoff_at')).toBeUndefined();
      const funds = await computeFundBalances(tx);
      expect(funds.find((row) => row.fund.id === 'super')?.reservedCents).toBe(5000);
      expect(accountBalanceFromSplits('barras', await tx.listPostedSplitsForAccount('barras'))).toBe(100000);
      expect(accountBalanceFromSplits('ahorro', await tx.listPostedSplitsForAccount('ahorro'))).toBe(80000);
    });
  });

  it('con destino Ahorros 2 mueve leftover, no el sobrecosto', async () => {
    const ledger = await setupSuper();
    await ledger.withTransaction(async (tx) => {
      await tx.insertAccount({
        id: 'ahorros-2',
        name: 'Ahorros 2',
        kind: 'BANK',
        visibility: 'PUBLIC',
        ownerPersonId: null,
        countsAsLiquidity: true,
        isCardPaymentSource: false,
      });
      await postAjuste(tx, { accountId: 'ahorros-2', amountCents: 10000, occurredAt: Q2 });
      await postReserva(tx, { fundId: 'super', amountCents: 5000, occurredAt: Q2 });
      await postReserva(tx, { fundId: 'luz', amountCents: 4000, occurredAt: Q2 });
      await assignGastoToBudgetItem(tx, {
        budgetItemId: 'bi-super',
        accountId: 'barras',
        amountCents: 2000,
        coverFromReserveCents: 2000,
        occurredAt: Q2,
      });
      await assignGastoToBudgetItem(tx, {
        budgetItemId: 'bi-luz',
        accountId: 'barras',
        amountCents: 6000,
        coverFromReserveCents: 4000,
        occurredAt: Q2,
      });

      const destinations = cutoffDestinationAccounts(await tx.listAccounts());
      expect(destinations.map((row) => row.id).sort()).toEqual(['ahorro', 'ahorros-2']);

      const plan = await planCutoffTransferFromTx(tx, { now: CUTOFF_AT, toAccountId: 'ahorros-2' });
      expect(plan.feasible).toBe(true);
      expect(plan.toAccountId).toBe('ahorros-2');
      expect(plan.totalLeftoverCents).toBe(3000);
      expect(plan.totalTransferredCents).toBe(3000);
      expect(plan.totalOverrunCents).toBe(2000);
      expect(plan.lines.find((row) => row.budgetItemId === 'bi-super')?.leftoverCents).toBe(3000);
      expect(plan.lines.find((row) => row.budgetItemId === 'bi-super')?.overrunCents).toBe(0);
      expect(plan.lines.find((row) => row.budgetItemId === 'bi-luz')?.leftoverCents).toBe(0);
      expect(plan.lines.find((row) => row.budgetItemId === 'bi-luz')?.overrunCents).toBe(2000);

      const record = await executeBudgetCutoff(tx, { now: CUTOFF_AT, toAccountId: 'ahorros-2' });
      expect(record.leftoverMovedCents).toBe(3000);
      expect(record.totalOverrunCents).toBe(2000);
      expect(record.destinationAccountId).toBe('ahorros-2');

      const funds = await computeFundBalances(tx);
      expect(funds.find((row) => row.fund.id === 'super')?.reservedCents).toBe(0);
      expect(funds.find((row) => row.fund.id === 'luz')?.reservedCents).toBe(0);
      expect(accountBalanceFromSplits('barras', await tx.listPostedSplitsForAccount('barras'))).toBe(89000);
      expect(accountBalanceFromSplits('ahorro', await tx.listPostedSplitsForAccount('ahorro'))).toBe(80000);
      expect(accountBalanceFromSplits('ahorros-2', await tx.listPostedSplitsForAccount('ahorros-2'))).toBe(13000);

      const txs = await tx.listTransactions();
      const moved = txs.filter((row) => row.note.includes('Corte') && row.status === 'POSTED');
      expect(moved).toHaveLength(1);
      expect(moved[0]?.type).toBe('TRANSFERENCIA');
      expect(moved[0]?.note).toMatch(/Super/);
      expect(moved.some((row) => row.note.includes('Luz'))).toBe(false);
    });
  });

  it('rechaza Barras y Atlántida como destino del excedente', async () => {
    const ledger = await setupSuper();
    await ledger.withTransaction(async (tx) => {
      await tx.insertAccount({
        id: 'atlantida',
        name: 'Atlántida',
        kind: 'BANK',
        visibility: 'PUBLIC',
        ownerPersonId: null,
        countsAsLiquidity: true,
        isCardPaymentSource: true,
      });
      await postAjuste(tx, { accountId: 'atlantida', amountCents: 20000, occurredAt: Q2 });
      await postReserva(tx, { fundId: 'super', amountCents: 5000, occurredAt: Q2 });
    });
    await expect(
      ledger.withTransaction((tx) => executeBudgetCutoff(tx, { now: CUTOFF_AT, toAccountId: 'barras' })),
    ).rejects.toThrow(/cuenta de ahorro/);
    await expect(
      ledger.withTransaction((tx) => executeBudgetCutoff(tx, { now: CUTOFF_AT, toAccountId: 'atlantida' })),
    ).rejects.toThrow(/cuenta de ahorro/);
    await ledger.withTransaction(async (tx) => {
      expect(parseBudgetCutoffs(await tx.getMeta('budget_cutoffs'))).toEqual([]);
      const funds = await computeFundBalances(tx);
      expect(funds.find((row) => row.fund.id === 'super')?.reservedCents).toBe(5000);
      expect(accountBalanceFromSplits('barras', await tx.listPostedSplitsForAccount('barras'))).toBe(100000);
      expect(accountBalanceFromSplits('atlantida', await tx.listPostedSplitsForAccount('atlantida'))).toBe(20000);
    });
  });

  it('rejects covering an Ahorro expense with Super of Barras', async () => {
    const ledger = await setupSuper();
    await expect(
      ledger.withTransaction((tx) =>
        assignGastoToBudgetItem(tx, {
          budgetItemId: 'bi-super',
          accountId: 'ahorro',
          amountCents: 2000,
          coverFromReserveCents: 2000,
          occurredAt: Q2,
        }),
      ),
    ).rejects.toThrow(/pertenece a Barras, no a Ahorro/);
  });

  it('rejects a float amount', async () => {
    const ledger = await setupSuper();
    await expect(
      ledger.withTransaction((tx) =>
        assignGastoToBudgetItem(tx, {
          budgetItemId: 'bi-super',
          accountId: 'barras',
          amountCents: 50.5,
          coverFromReserveCents: 50,
          occurredAt: Q2,
        }),
      ),
    ).rejects.toThrow(/entero/);
  });

  it('does not consume Luz when the gasto is assigned to Super', async () => {
    const ledger = await setupSuper();
    await ledger.withTransaction(async (tx) => {
      await postReserva(tx, { fundId: 'super', amountCents: 5000, occurredAt: Q2 });
      await postReserva(tx, { fundId: 'luz', amountCents: 4000, occurredAt: Q2 });
      await assignGastoToBudgetItem(tx, {
        budgetItemId: 'bi-super',
        accountId: 'barras',
        amountCents: 2000,
        coverFromReserveCents: 2000,
        occurredAt: Q2,
      });
      const funds = await computeFundBalances(tx);
      expect(funds.find((row) => row.fund.id === 'luz')?.reservedCents).toBe(4000);
      expect(funds.find((row) => row.fund.id === 'super')?.reservedCents).toBe(3000);
    });
  });
});

describe('itemOverrunCents', () => {
  it('never goes negative', () => {
    expect(itemOverrunCents(2000, 5000)).toBe(0);
    expect(itemOverrunCents(5000, 5000)).toBe(0);
    expect(itemOverrunCents(8000, 5000)).toBe(3000);
  });

  it('rejects float', () => {
    expect(() => itemOverrunCents(50.5, 100)).toThrow(/entero/);
  });
});
