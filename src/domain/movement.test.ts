import { describe, expect, it } from 'vitest';
import { MemoryLedger } from './memoryLedger';
import { filterHistoryMovements, describeVoidEffect, movementPlaceLabel } from './movement';
import { postAjuste, postGasto, postGastoX, postReserva, postTransferencia, voidTransaction } from './posting';

describe('filtro de movimientos', () => {
  it('un GASTO del fondo Super aparece; una TRANSFERENCIA no si filtras tipo GASTO', async () => {
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
      await postAjuste(tx, { accountId: 'barras', amountCents: 20000 });
      await postReserva(tx, { fundId: 'super', amountCents: 5000 });
      const gastoId = await postGasto(tx, {
        accountId: 'barras',
        fundId: 'super',
        amountCents: 2000,
        note: 'Super',
      });
      await postTransferencia(tx, {
        fromAccountId: 'barras',
        toAccountId: 'ahorro',
        amountCents: 3000,
        note: 'A Ahorro',
      });

      const rows = await tx.listTransactions();
      const splits = await tx.listSplits();
      const splitsByTx = new Map<string, typeof splits>();
      for (const split of splits) {
        const list = splitsByTx.get(split.transactionId) ?? [];
        list.push(split);
        splitsByTx.set(split.transactionId, list);
      }
      const items = await tx.listBudgetItems();

      const byFund = filterHistoryMovements(rows, splitsByTx, {
        budgetItems: items,
        filter: { type: 'GASTO', fundId: 'super' },
      });
      expect(byFund.map((row) => row.id)).toEqual([gastoId]);

      const onlyGasto = filterHistoryMovements(rows, splitsByTx, { filter: { type: 'GASTO' } });
      expect(onlyGasto.every((row) => row.type === 'GASTO')).toBe(true);
      expect(onlyGasto.some((row) => row.type === 'TRANSFERENCIA')).toBe(false);
      expect(onlyGasto.some((row) => row.note === 'A Ahorro')).toBe(false);
    });
  });

  it('el carril Casa no mezcla Gastos X; hay que pedirlos explícito', async () => {
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
        id: 'caja',
        name: 'Caja',
        kind: 'CASH',
        visibility: 'PUBLIC',
        ownerPersonId: null,
        countsAsLiquidity: true,
        isCardPaymentSource: false,
      });
      await postAjuste(tx, { accountId: 'barras', amountCents: 20000 });
      await postAjuste(tx, { accountId: 'caja', amountCents: 20000 });
      const casaId = await postGasto(tx, { accountId: 'barras', amountCents: 2000, note: 'Pan' });
      const xId = await postGastoX(tx, { accountId: 'caja', amountCents: 1500, note: 'X cine' });

      const rows = await tx.listTransactions();
      const splits = await tx.listSplits();
      const accounts = await tx.listAccounts();
      const splitsByTx = new Map<string, typeof splits>();
      for (const split of splits) {
        const list = splitsByTx.get(split.transactionId) ?? [];
        list.push(split);
        splitsByTx.set(split.transactionId, list);
      }

      const casa = filterHistoryMovements(rows, splitsByTx, {
        accounts,
        filter: { type: 'GASTO', spendLane: 'CASA' },
      });
      expect(casa.map((row) => row.id)).toEqual([casaId]);
      expect(casa.some((row) => row.id === xId)).toBe(false);

      const x = filterHistoryMovements(rows, splitsByTx, {
        accounts,
        filter: { type: 'GASTO', spendLane: 'GASTO_X' },
      });
      expect(x.map((row) => row.id)).toEqual([xId]);

      const ambos = filterHistoryMovements(rows, splitsByTx, {
        accounts,
        filter: { type: 'GASTO', spendLane: '' },
      });
      expect(ambos.map((row) => row.id).sort()).toEqual([casaId, xId].sort());
    });
  });

  it('oculta un GASTO VOID de la lista viva y lo muestra si pides anulados', async () => {
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
      await postAjuste(tx, { accountId: 'barras', amountCents: 20000 });
      const gastoId = await postGasto(tx, { accountId: 'barras', amountCents: 2000, note: 'Pan' });
      await voidTransaction(tx, gastoId);
      const rows = await tx.listTransactions();
      const splits = await tx.listSplits();
      const splitsByTx = new Map<string, typeof splits>();
      for (const split of splits) {
        const list = splitsByTx.get(split.transactionId) ?? [];
        list.push(split);
        splitsByTx.set(split.transactionId, list);
      }
      const live = filterHistoryMovements(rows, splitsByTx);
      expect(live.some((row) => row.id === gastoId)).toBe(false);
      const withVoid = filterHistoryMovements(rows, splitsByTx, { filter: { includeVoided: true } });
      expect(withVoid.some((row) => row.id === gastoId && row.status === 'VOID')).toBe(true);
      expect(withVoid.some((row) => row.reversesId === gastoId)).toBe(false);
      const original = rows.find((row) => row.id === gastoId)!;
      expect(describeVoidEffect(original, splitsByTx.get(gastoId) ?? [])).toMatch(/anulado/);
    });
  });
});

describe('movementPlaceLabel', () => {
  const names = {
    accountName: (id: string) => ({ barras: 'Barras', atlantida: 'Atlántida' }[id] ?? ''),
    fundName: (id: string) => ({ super: 'Super' }[id] ?? ''),
  };

  it('separa cuenta y fondo; transferencia usa flecha', () => {
    expect(
      movementPlaceLabel(
        {
          type: 'GASTO',
          amountCents: 5000,
          note: '',
          occurredAt: '',
          accountId: 'barras',
          fromAccountId: 'barras',
          toAccountId: '',
          fundId: 'super',
          toFundId: '',
          personId: '',
          cardId: '',
          reservationId: '',
        },
        names,
      ),
    ).toBe('Barras · Super');
    expect(
      movementPlaceLabel(
        {
          type: 'TRANSFERENCIA',
          amountCents: 10000,
          note: '',
          occurredAt: '',
          accountId: 'barras',
          fromAccountId: 'barras',
          toAccountId: 'atlantida',
          fundId: '',
          toFundId: '',
          personId: '',
          cardId: '',
          reservationId: '',
        },
        names,
      ),
    ).toBe('Barras → Atlántida');
  });
});
