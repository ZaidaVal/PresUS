import { describe, expect, it } from 'vitest';
import { MemoryLedger } from './memoryLedger';
import { parseUsdToCents, formatUsd, centsToInput } from './money';
import { monthlyEquivalentCents, completeBudgetShares } from './budget';
import {
  accountBalanceFromSplits,
  cardBalanceFromSplits,
  computeAccountBalances,
  computeCardBalances,
  computeFundBalances,
  computeSafeAvailable,
  disponibleSeguroRaw,
  operatingLiquidityCents,
  onePendingReservaSummary,
  unreservedObligationsCents,
  usableWithoutSavingsCents,
} from './balances';
import {
  postAjuste,
  postAporte,
  postCardCharge,
  postCardPayment,
  postGasto,
  postIngreso,
  postLiberacion,
  postReserva,
  postTransferencia,
  setAccountBase,
  setCardOwedBase,
  voidTransaction,
  correctTransaction,
  changeReservationAmount,
} from './posting';
import { DomainError } from './ledger';
import type { BudgetItem } from './types';
import { saveAccount, saveFund, savePersonName, saveCreditCard } from './catalog';
import { DASHBOARD_PREFS_KEY, parseDashboardPrefs, serializeDashboardPrefs } from './dashboardPrefs';
import { isSavingsAccount, isSavingsLikeFund, isAtlantidaAccount, dashboardListedAccounts } from './segments';
import { redeemUnusedBudget, saveBudgetItem, spendFromBudget, retireExpenseBudgetsBeyondHorizon, executeBudgetCover, injectBudgetedFortnightReserves, emptyFundThenSpendFromLeftover } from './budgetOps';
import { cutoffDestinationAccounts } from './budgetOverrun';
import { frequencyExceedsExpenseHorizon, isWithinExpenseHorizon, visiblePostedMovements } from './horizon';
import { filterHistoryMovements } from './movement';

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
      id: 'ahorro',
      name: 'Ahorro',
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
    await tx.insertFund({
      id: 'viaje',
      accountId: 'ahorro',
      name: 'Ahorro Viaje',
      purpose: 'Viaje',
      targetAmountCents: null,
      priority: 1,
      segment: 'SAVINGS',
    });
  });
  return ledger;
}

describe('money', () => {
  it('parses and formats cents without float', () => {
    expect(parseUsdToCents('50.00')).toBe(5000);
    expect(parseUsdToCents('-5')).toBe(-500);
    expect(formatUsd(96086)).toBe('$960.86');
    expect(centsToInput(96086)).toBe('960.86');
    expect(() => parseUsdToCents('1.239')).toThrow();
  });
});

describe('budget equivalent', () => {
  it('doubles quincenal and zeroes inactive/unique', () => {
    expect(monthlyEquivalentCents('QUINCENAL', 5000, true)).toBe(10000);
    expect(monthlyEquivalentCents('MENSUAL', 37500, true)).toBe(37500);
    expect(monthlyEquivalentCents('QUINCENAL', 5000, false)).toBe(0);
    expect(monthlyEquivalentCents('UNICO', 80000, true)).toBe(0);
  });
});

describe('disponible seguro', () => {
  it('matches the reference case including uncovered card', () => {
    const raw = disponibleSeguroRaw({
      saldoCuentasPublicas: 148000,
      fondosApartados: 72000,
      obligacionesProximasNoReservadas: 23000,
      tarjetaPendienteNoCubierta: 18000,
    });
    expect(raw).toBe(35000);
  });

  it('does not subtract Casa twice when already reserved', () => {
    const reservedByFund = new Map([['casa', 37500]]);
    const items: BudgetItem[] = [
      completeBudgetShares({
        id: '1',
        budgetScope: 'HOME',
        name: 'Casa',
        category: 'Vivienda',
        frequency: 'MENSUAL',
        amountCents: 37500,
        fortnight: 'BOTH',
        coverFundId: 'casa',
        usualMedium: 'TRANSFER',
        active: true,
      }),
      completeBudgetShares({
        id: '2',
        budgetScope: 'HOME',
        name: 'Extra',
        category: 'Otros',
        frequency: 'MENSUAL',
        amountCents: 23000,
        fortnight: 'BOTH',
        coverFundId: null,
        usualMedium: 'TRANSFER',
        active: true,
      }),
    ];
    expect(unreservedObligationsCents(items, reservedByFund, 'Q1')).toBe(23000);
  });
});

describe('posting', () => {
  it('records opening only via AJUSTE', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000, note: 'apertura' });
      const balances = await computeAccountBalances(tx);
      expect(balances.find((row) => row.account.id === 'barras')?.saldoCents).toBe(100000);
      const txs = await tx.listTransactions();
      expect(txs.every((row) => row.type === 'AJUSTE')).toBe(true);
    });
  });

  it('rejects a transfer from unreserved available and names the shortfall', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'ahorro', amountCents: 85000 });
      await postReserva(tx, { fundId: 'viaje', amountCents: 85000 });
      await expect(
        postTransferencia(tx, {
          fromAccountId: 'ahorro',
          toAccountId: 'barras',
          amountCents: 5000,
        }),
      ).rejects.toThrow(DomainError);
      await expect(
        postTransferencia(tx, {
          fromAccountId: 'ahorro',
          toAccountId: 'barras',
          amountCents: 5000,
        }),
      ).rejects.toThrow('No hay disponible suficiente en Ahorro: hay $0.00 y pides $50.00');
      await expect(
        postTransferencia(tx, {
          fromAccountId: 'ahorro',
          toAccountId: 'barras',
          amountCents: 5000,
        }),
      ).rejects.toThrow('Elige un fondo origen para mover el apartado');
    });
  });

  it('moves reserved savings when the origin fund is chosen', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'ahorro', amountCents: 85000 });
      await postReserva(tx, { fundId: 'viaje', amountCents: 85000 });
      await postTransferencia(tx, {
        fromAccountId: 'ahorro',
        toAccountId: 'barras',
        amountCents: 80000,
        fromFundId: 'viaje',
      });
      const balances = await computeAccountBalances(tx);
      expect(balances.find((row) => row.account.id === 'ahorro')?.saldoCents).toBe(5000);
      expect(balances.find((row) => row.account.id === 'ahorro')?.reservedCents).toBe(5000);
      expect(balances.find((row) => row.account.id === 'ahorro')?.disponibleCents).toBe(0);
      expect(balances.find((row) => row.account.id === 'barras')?.saldoCents).toBe(80000);
      const txs = await tx.listTransactions();
      expect(txs.some((row) => row.type === 'GASTO')).toBe(false);
    });
  });

  it('treats a transfer as not an expense and keeps shared wealth', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      await postTransferencia(tx, {
        fromAccountId: 'barras',
        toAccountId: 'ahorro',
        amountCents: 10000,
      });
      const balances = await computeAccountBalances(tx);
      const barras = balances.find((row) => row.account.id === 'barras')!;
      const ahorro = balances.find((row) => row.account.id === 'ahorro')!;
      expect(barras.saldoCents + ahorro.saldoCents).toBe(100000);
      const txs = await tx.listTransactions();
      expect(txs.some((row) => row.type === 'GASTO')).toBe(false);
      expect(txs.some((row) => row.type === 'TRANSFERENCIA')).toBe(true);
    });
  });

  it('records an aporte without touching the private ledger', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAporte(tx, { personId: 'a', toAccountId: 'barras', amountCents: 25000 });
      const balances = await computeAccountBalances(tx);
      expect(balances.find((row) => row.account.id === 'barras')?.saldoCents).toBe(25000);
      expect(balances.find((row) => row.account.id === 'priv-a')?.saldoCents).toBe(0);
      const txs = await tx.listTransactions();
      expect(txs[0]?.type).toBe('APORTE');
    });
  });

  it('reduces disponible with a reservation, not the account saldo', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 40000 });
      const balances = await computeAccountBalances(tx);
      const barras = balances.find((row) => row.account.id === 'barras')!;
      expect(barras.saldoCents).toBe(100000);
      expect(barras.reservedCents).toBe(40000);
      expect(barras.disponibleCents).toBe(60000);
      expect(barras.disponibleUiCents).toBe(60000);
    });
  });

  it('rolls back when splits do not sum to zero', async () => {
    const ledger = await setup();
    await expect(
      ledger.withTransaction(async (tx) => {
        await tx.insertTransaction({
          id: 'bad',
          type: 'GASTO',
          occurredAt: new Date().toISOString(),
          period: 'Q1',
          note: '',
          createdAt: new Date().toISOString(),
          status: 'POSTED',
          reversesId: null,
        });
        await tx.insertSplit({
          id: 's1',
          transactionId: 'bad',
          accountId: 'barras',
          fundId: null,
          personId: null,
          cardId: null,
          amountCents: -5000,
          role: 'SOURCE',
        });
        throw new DomainError('Los splits de la transacción no cuadran (suma ≠ 0)');
      }),
    ).rejects.toBeInstanceOf(DomainError);

    await ledger.withTransaction(async (tx) => {
      expect(await tx.listTransactions()).toHaveLength(0);
    });
  });

  it('reconstructs account saldo from posted splits', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 80000 });
      await postGasto(tx, { accountId: 'barras', amountCents: 5000 });
      const splits = await tx.listPostedSplitsForAccount('barras');
      expect(accountBalanceFromSplits('barras', splits)).toBe(75000);
    });
  });

  it('VOID plus inverse restores the previous saldo', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 80000 });
      const gastoId = await postGasto(tx, { accountId: 'barras', amountCents: 5000 });
      await voidTransaction(tx, gastoId);
      const splits = await tx.listPostedSplitsForAccount('barras');
      expect(accountBalanceFromSplits('barras', splits)).toBe(80000);
      const original = await tx.getTransaction(gastoId);
      expect(original?.status).toBe('VOID');
      const txs = await tx.listTransactions();
      const inverse = txs.find((row) => row.reversesId === gastoId);
      expect(inverse?.status).toBe('VOID');
      const splitsByTx = new Map<string, Awaited<ReturnType<typeof tx.listSplits>>>();
      for (const split of await tx.listSplits()) {
        const list = splitsByTx.get(split.transactionId) ?? [];
        list.push(split);
        splitsByTx.set(split.transactionId, list);
      }
      expect(filterHistoryMovements(txs, splitsByTx).some((row) => row.id === gastoId)).toBe(false);
      expect(
        filterHistoryMovements(txs, splitsByTx, { filter: { includeVoided: true } }).some((row) => row.id === gastoId),
      ).toBe(true);
      expect(visiblePostedMovements(txs).some((row) => row.id === gastoId)).toBe(false);
      expect('deleteTransaction' in ledger).toBe(false);
    });
  });

  it('corrects a posted GASTO by voiding and posting the new amount', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 80000 });
      const originalId = await postGasto(tx, { accountId: 'barras', amountCents: 5000 });
      const correctionId = await correctTransaction(tx, originalId, {
        type: 'GASTO',
        accountId: 'barras',
        amountCents: 4000,
      });
      const splits = await tx.listPostedSplitsForAccount('barras');
      expect(accountBalanceFromSplits('barras', splits)).toBe(76000);
      const original = await tx.getTransaction(originalId);
      expect(original?.status).toBe('VOID');
      const correction = await tx.getTransaction(correctionId);
      expect(correction?.status).toBe('POSTED');
      expect(correction?.type).toBe('GASTO');
      const originalSplits = await tx.listSplitsForTransaction(originalId);
      const correctionSplits = await tx.listSplitsForTransaction(correctionId);
      expect(originalSplits.reduce((sum, split) => sum + split.amountCents, 0)).toBe(0);
      expect(correctionSplits.reduce((sum, split) => sum + split.amountCents, 0)).toBe(0);
      expect('deleteTransaction' in ledger).toBe(false);
    });
  });

  it('rejects voiding or correcting an already voided movement', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 80000 });
      const gastoId = await postGasto(tx, { accountId: 'barras', amountCents: 5000 });
      const inverseId = await voidTransaction(tx, gastoId);
      await expect(voidTransaction(tx, gastoId)).rejects.toThrow(/anulado/);
      await expect(voidTransaction(tx, inverseId)).rejects.toThrow(/anulación/);
      await expect(
        correctTransaction(tx, gastoId, { type: 'GASTO', accountId: 'barras', amountCents: 4000 }),
      ).rejects.toThrow(/anulado/);
    });
  });

  it('releases an active reservation without recording a GASTO', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 40000 });
      const reservation = (await tx.listActiveReservations())[0]!;
      await postLiberacion(tx, { reservationId: reservation.id });
      const balances = await computeAccountBalances(tx);
      const barras = balances.find((row) => row.account.id === 'barras')!;
      expect(barras.saldoCents).toBe(100000);
      expect(barras.reservedCents).toBe(0);
      const txs = await tx.listTransactions();
      expect(txs.some((row) => row.type === 'LIBERACION_RESERVA' && row.status === 'POSTED')).toBe(true);
      expect(txs.filter((row) => row.type === 'GASTO')).toHaveLength(0);
    });
  });

  it('changes an active reservation amount without treating it as GASTO', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 40000 });
      const reservation = (await tx.listActiveReservations())[0]!;
      await changeReservationAmount(tx, { reservationId: reservation.id, amountCents: 25000 });
      const balances = await computeAccountBalances(tx);
      const barras = balances.find((row) => row.account.id === 'barras')!;
      expect(barras.saldoCents).toBe(100000);
      expect(barras.reservedCents).toBe(25000);
      const txs = await tx.listTransactions();
      expect(txs.filter((row) => row.type === 'GASTO')).toHaveLength(0);
      expect(txs.filter((row) => row.type === 'LIBERACION_RESERVA' && row.status === 'POSTED')).toHaveLength(1);
      expect(txs.filter((row) => row.type === 'RESERVA' && row.status === 'POSTED')).toHaveLength(2);
    });
  });

  it('does not expose a delete API for posted transactions', async () => {
    const ledger = await setup();
    expect('deleteTransaction' in ledger).toBe(false);
  });

  it('computes safe available without double-counting reserved Casa', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 148000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 72000 });
      await tx.insertBudgetItem({
        id: 'casa-item',
        budgetScope: 'HOME',
        name: 'Casa',
        category: 'Vivienda',
        frequency: 'MENSUAL',
        amountCents: 72000,
        fortnight: 'BOTH',
        coverFundId: 'casa',
        usualMedium: 'TRANSFER',
        active: true,
      });
      await tx.insertBudgetItem({
        id: 'extra',
        budgetScope: 'HOME',
        name: 'Extra',
        category: 'Otros',
        frequency: 'MENSUAL',
        amountCents: 23000,
        fortnight: 'BOTH',
        coverFundId: null,
        usualMedium: 'TRANSFER',
        active: true,
      });
      const safe = await computeSafeAvailable(tx, new Date('2026-08-10T12:00:00Z'));
      expect(safe.tengoCents).toBe(148000);
      expect(safe.apartadoCents).toBe(72000);
      expect(safe.obligacionesNoReservadasCents).toBe(23000);
      expect(safe.disponibleSeguroRawCents).toBe(0);
      expect(safe.limitedCardRemainingCents).toBe(0);
      expect(safe.paymentAccountDisponibleCents).toBe(0);
    });
  });

  it('rejects spending reserved money as free cash', async () => {
    const ledger = await setup();
    await expect(
      ledger.withTransaction(async (tx) => {
        await postAjuste(tx, { accountId: 'barras', amountCents: 10000 });
        await postReserva(tx, { fundId: 'casa', amountCents: 8000 });
        await postGasto(tx, { accountId: 'barras', amountCents: 3000 });
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('rejects float cents', async () => {
    const ledger = await setup();
    await expect(
      ledger.withTransaction(async (tx) => {
        await postIngreso(tx, { accountId: 'barras', amountCents: 10.5 as never });
      }),
    ).rejects.toThrow();
  });

  it('sets opening account base via AJUSTE, not a silent saldo', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000, note: 'apertura' });
      await setAccountBase(tx, { accountId: 'barras', targetCents: 130000 });
      const splits = await tx.listPostedSplitsForAccount('barras');
      expect(accountBalanceFromSplits('barras', splits)).toBe(130000);
      const txs = await tx.listTransactions();
      expect(txs.every((row) => row.type === 'AJUSTE')).toBe(true);
      expect(txs).toHaveLength(2);
    });
  });

  it('rejects a base below reserved money', async () => {
    const ledger = await setup();
    await expect(
      ledger.withTransaction(async (tx) => {
        await postAjuste(tx, { accountId: 'barras', amountCents: 10000 });
        await postReserva(tx, { fundId: 'casa', amountCents: 8000 });
        await setAccountBase(tx, { accountId: 'barras', targetCents: 5000 });
      }),
    ).rejects.toThrow(/apartados/);
  });
});

describe('catalogos', () => {
  it('updates person display name and keeps Z/A codes', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await savePersonName(tx, 'z', 'Zaida');
      const person = await tx.getPerson('z');
      expect(person?.displayName).toBe('Zaida');
      expect(person?.code).toBe('Z');
    });
  });

  it('rejects a private account without owner', async () => {
    const ledger = await setup();
    await expect(
      ledger.withTransaction((tx) =>
        saveAccount(
          tx,
          {
            id: 'ghost',
            name: 'Oculta',
            kind: 'BANK',
            visibility: 'PRIVATE',
            ownerPersonId: null,
            countsAsLiquidity: true,
            isCardPaymentSource: false,
          },
          true,
        ),
      ),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('rejects marking Ahorros as card payment source', async () => {
    const ledger = await setup();
    await expect(
      ledger.withTransaction((tx) =>
        saveAccount(
          tx,
          {
            id: 'ahorro',
            name: 'Ahorros',
            kind: 'BANK',
            visibility: 'PUBLIC',
            ownerPersonId: null,
            countsAsLiquidity: true,
            isCardPaymentSource: true,
          },
          false,
        ),
      ),
    ).rejects.toThrow(/Atlántida/);
  });

  it('creates a public account and later updates its type', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await saveAccount(
        tx,
        {
          id: 'salidas',
          name: 'Salidas',
          kind: 'CASH',
          visibility: 'PUBLIC',
          ownerPersonId: null,
          countsAsLiquidity: true,
          isCardPaymentSource: false,
        },
        true,
      );
      await saveAccount(
        tx,
        {
          id: 'salidas',
          name: 'Salidas efectivo',
          kind: 'CASH',
          visibility: 'PUBLIC',
          ownerPersonId: null,
          countsAsLiquidity: true,
          isCardPaymentSource: false,
        },
        false,
      );
      const account = await tx.getAccount('salidas');
      expect(account?.name).toBe('Salidas efectivo');
      expect(account?.kind).toBe('CASH');
    });
    expect('deleteAccount' in ledger).toBe(false);
  });

  it('rejects a credit card whose payment account is Ahorros', async () => {
    const ledger = await setup();
    await expect(
      ledger.withTransaction((tx) =>
        saveCreditCard(
          tx,
          {
            id: 'card-bad',
            name: 'ONE mala',
            paymentAccountId: 'ahorro',
            coverFundId: null,
            creditLimitCents: 80000,
            personId: null,
          },
          true,
        ),
      ),
    ).rejects.toThrow(/Atlántida/);
  });

  it('rejects a fund target that is not integer cents', async () => {
    const ledger = await setup();
    await expect(
      ledger.withTransaction((tx) =>
        saveFund(
          tx,
          {
            id: 'viaje',
            accountId: 'ahorro',
            name: 'Ahorro Viaje',
            purpose: 'Viaje',
            targetAmountCents: 10.5 as never,
            priority: 1,
            segment: 'SAVINGS',
          },
          false,
        ),
      ),
    ).rejects.toThrow(/entero/);
  });

  it('does not move a reserved fund to another account', async () => {
    const ledger = await setup();
    await expect(
      ledger.withTransaction(async (tx) => {
        await postAjuste(tx, { accountId: 'barras', amountCents: 10000 });
        await postReserva(tx, { fundId: 'casa', amountCents: 4000 });
        await saveFund(
          tx,
          {
            id: 'casa',
            accountId: 'ahorro',
            name: 'Casa',
            purpose: 'Vivienda',
            targetAmountCents: null,
            priority: 1,
          },
          false,
        );
      }),
    ).rejects.toThrow(/apartado activo/);
  });

  it('excludes a public account from TENGO when it is not liquidity', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 50000 });
      const barras = await tx.getAccount('barras');
      await saveAccount(tx, { ...barras!, countsAsLiquidity: false }, false);
      const safe = await computeSafeAvailable(tx);
      expect(safe.tengoCents).toBe(0);
    });
  });

  it('updates a card cap in integer cents and rejects a float', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await tx.insertAccount({
        id: 'atlantida',
        name: 'Atlántida',
        kind: 'CREDIT',
        visibility: 'PUBLIC',
        ownerPersonId: null,
        countsAsLiquidity: true,
        isCardPaymentSource: true,
      });
      await tx.insertCreditCard({
        id: 'one',
        name: 'ONE',
        paymentAccountId: 'atlantida',
        coverFundId: null,
        creditLimitCents: 270000,
        creditLineId: 'line-one',
        creditLineLimitCents: 270000,
        personId: null,
      });
      await tx.insertCreditCard({
        id: 'one-100',
        name: 'ONE 100',
        paymentAccountId: 'atlantida',
        coverFundId: null,
        creditLimitCents: 10000,
        creditLineId: 'line-one',
        creditLineLimitCents: 270000,
        personId: null,
      });
      await saveCreditCard(
        tx,
        {
          id: 'one',
          name: 'ONE base',
          paymentAccountId: 'atlantida',
          coverFundId: 'viaje',
          creditLimitCents: 260000,
          creditLineId: 'line-one',
          creditLineLimitCents: 260000,
          personId: null,
        },
        false,
      );
      const card = await tx.getCreditCard('one');
      const sibling = await tx.getCreditCard('one-100');
      expect(card?.name).toBe('ONE base');
      expect(card?.coverFundId).toBe('viaje');
      expect(card?.creditLineLimitCents).toBe(260000);
      expect(sibling?.creditLineLimitCents).toBe(260000);
    });
    await expect(
      ledger.withTransaction((tx) =>
        saveCreditCard(
          tx,
          {
            id: 'one',
            name: 'ONE',
            paymentAccountId: 'atlantida',
            coverFundId: null,
            creditLimitCents: 10.5 as never,
            personId: null,
          },
          false,
        ),
      ),
    ).rejects.toThrow(/entero/);
  });

  it('rejects paying a card from a private account', async () => {
    const ledger = await setup();
    await expect(
      ledger.withTransaction((tx) =>
        saveCreditCard(
          tx,
          {
            id: 'ghost-card',
            name: 'Fantasma',
            paymentAccountId: 'priv-a',
            coverFundId: null,
            creditLimitCents: 10000,
            personId: null,
          },
          true,
        ),
      ),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe('dashboard prefs', () => {
  it('parses defaults and round-trips without float money', () => {
    expect(parseDashboardPrefs(undefined).showHero).toBe(true);
    expect(parseDashboardPrefs('no-json').featuredAccountIds).toEqual([]);
    expect(parseDashboardPrefs(null).extraLimitedCardId).toBeNull();
    const saved = serializeDashboardPrefs({
      ...parseDashboardPrefs(null),
      showDebo: false,
      featuredAccountIds: ['barras', 'barras'],
      movementLimit: 12,
      extraLimitedCardId: 'card-extra',
    });
    const parsed = parseDashboardPrefs(saved);
    expect(parsed.showDebo).toBe(false);
    expect(parsed.featuredAccountIds).toEqual(['barras']);
    expect(parsed.movementLimit).toBe(12);
    expect(parsed.extraLimitedCardId).toBe('card-extra');
  });
});

describe('disponible sin ahorro', () => {
  it('excluye cuentas Ahorros y Ahorros 2 del helper aunque tengan disponible', () => {
    expect(isSavingsAccount({ id: 'acc-ahorro', name: 'Ahorros' })).toBe(true);
    expect(isSavingsAccount({ id: 'acc-ahorros-2', name: 'Ahorros 2' })).toBe(true);
    expect(isSavingsAccount({ id: 'acc-ahorro', name: 'Ahorro' })).toBe(true);
    expect(isSavingsAccount({ id: 'acc-atlantida', name: 'Atlántida' })).toBe(false);
    expect(isAtlantidaAccount({ id: 'acc-atlantida', name: 'Atlántida', isCardPaymentSource: true })).toBe(true);
    expect(isAtlantidaAccount({ id: 'acc-ahorro', name: 'Ahorros', isCardPaymentSource: false })).toBe(false);
    expect(isSavingsLikeFund({ id: 'ahorros2', name: 'Ahorros 2', segment: 'OPERATING' })).toBe(true);
    expect(isSavingsLikeFund({ id: 'super', name: 'Supermercado', segment: 'OPERATING' })).toBe(false);
    expect(
      usableWithoutSavingsCents({
        paymentAccount: { id: 'acc-ahorro', name: 'Ahorros' },
        paymentAccountDisponibleCents: 99000,
        limitedRemainingCents: 80000,
        extraLimitedRemainingCents: 0,
      }),
    ).toBe(80000);
    expect(
      usableWithoutSavingsCents({
        paymentAccount: { id: 'acc-ahorros-2', name: 'Ahorros 2' },
        paymentAccountDisponibleCents: 80000,
        limitedRemainingCents: 80000,
        extraLimitedRemainingCents: 0,
      }),
    ).toBe(80000);
    expect(
      usableWithoutSavingsCents({
        paymentAccount: { id: 'acc-atlantida', name: 'Atlántida' },
        paymentAccountDisponibleCents: 15000,
        limitedRemainingCents: 80000,
        extraLimitedRemainingCents: 0,
      }),
    ).toBe(95000);
    expect(
      cutoffDestinationAccounts([
        { id: 'acc-ahorros-2', name: 'Ahorros 2', visibility: 'PUBLIC' },
        { id: 'acc-ahorro', name: 'Ahorros', visibility: 'PUBLIC' },
        { id: 'acc-barras', name: 'Barras', visibility: 'PUBLIC' },
        { id: 'acc-atlantida', name: 'Atlántida', visibility: 'PUBLIC' },
        { id: 'acc-z', name: 'Bolsillo Z', visibility: 'PRIVATE' },
      ]).map((row) => row.id),
    ).toEqual(['acc-ahorro', 'acc-ahorros-2']);
  });

  it('un fondo SAVINGS no entra en apartado operativo ni en tengo de Inicio', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await tx.insertFund({
        id: 'ahorro-barras',
        accountId: 'barras',
        name: 'Ahorro Barras',
        purpose: 'Ahorro en Barras',
        targetAmountCents: null,
        priority: 1,
        segment: 'SAVINGS',
      });
      await postAjuste(tx, { accountId: 'barras', amountCents: 50000 });
      await postAjuste(tx, { accountId: 'ahorro', amountCents: 80000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 20000 });
      await postReserva(tx, { fundId: 'ahorro-barras', amountCents: 10000 });
      await postReserva(tx, { fundId: 'viaje', amountCents: 80000 });
      const operating = operatingLiquidityCents(await computeAccountBalances(tx), await computeFundBalances(tx));
      expect(operating.tengoCents).toBe(50000);
      expect(operating.apartadoCents).toBe(20000);
    });
  });

  it('el hero es el disponible de Barras; Ahorros, Ahorros 2 y bolsillo privado no se listan', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
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
        id: 'ahorros-2',
        name: 'Ahorros 2',
        kind: 'BANK',
        visibility: 'PUBLIC',
        ownerPersonId: null,
        countsAsLiquidity: true,
        isCardPaymentSource: false,
      });
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 20000 });
      const before = await computeSafeAvailable(tx);
      expect(before.barrasAccountId).toBe('barras');
      expect(before.barrasDisponibleUiCents).toBe(80000);
      await postAjuste(tx, { accountId: 'ahorro', amountCents: 80000 });
      await postReserva(tx, { fundId: 'viaje', amountCents: 80000 });
      await postAjuste(tx, { accountId: 'ahorros-2', amountCents: 40000 });
      await postAjuste(tx, { accountId: 'priv-a', amountCents: 50000 });
      const after = await computeSafeAvailable(tx);
      expect(after.barrasDisponibleUiCents).toBe(80000);
      const listed = dashboardListedAccounts(await computeAccountBalances(tx));
      expect(listed.some((row) => row.account.id === 'barras')).toBe(true);
      expect(listed.some((row) => row.account.id === 'atlantida')).toBe(true);
      expect(listed.some((row) => /ahorro/i.test(row.account.name))).toBe(false);
      expect(listed.some((row) => row.account.visibility === 'PRIVATE')).toBe(false);
      expect(listed.some((row) => row.account.id === 'priv-a')).toBe(false);
      expect(listed).toHaveLength(2);
    });
  });

  it('Inicio puede sumar cuentas públicas extra; nunca privadas', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await tx.insertAccount({
        id: 'atlantida',
        name: 'Atlántida',
        kind: 'CREDIT',
        visibility: 'PUBLIC',
        ownerPersonId: 'z',
        countsAsLiquidity: true,
        isCardPaymentSource: true,
      });
      await postAjuste(tx, { accountId: 'barras', amountCents: 1000 });
      await postAjuste(tx, { accountId: 'ahorro', amountCents: 2000 });
      const listed = dashboardListedAccounts(await computeAccountBalances(tx), ['ahorro', 'priv-a']);
      expect(listed.some((row) => row.account.id === 'barras')).toBe(true);
      expect(listed.some((row) => row.account.id === 'atlantida')).toBe(true);
      expect(listed.some((row) => row.account.id === 'ahorro')).toBe(true);
      expect(listed.some((row) => row.account.id === 'priv-a')).toBe(false);
    });
  });

  it('un cargo ONE no baja el hero de Barras y queda como reserva por cubrir', async () => {
    const ledger = await setup();
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
      await tx.insertCreditCard({
        id: 'card-one-limit',
        name: 'ONE',
        paymentAccountId: 'atlantida',
        coverFundId: null,
        creditLimitCents: 80000,
        personId: null,
      });
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 20000 });
      const before = await computeSafeAvailable(tx);
      expect(before.barrasDisponibleUiCents).toBe(80000);
      expect(before.limitedCardRemainingCents).toBe(80000);
      await postCardCharge(tx, { cardId: 'card-one-limit', amountCents: 5000, chargeClass: 'SHARED_BUDGETED' });
      await postCardCharge(tx, { cardId: 'card-one-limit', amountCents: 3000, chargeClass: 'PERSONAL_A' });
      const after = await computeSafeAvailable(tx);
      expect(after.barrasDisponibleUiCents).toBe(80000);
      expect(after.limitedCardRemainingCents).toBe(72000);
      const reservas = onePendingReservaSummary(await tx.listCardCharges());
      expect(reservas.totalCents).toBe(8000);
      expect(reservas.presupuestoCents).toBe(5000);
      expect(reservas.bolsilloACents).toBe(3000);
      expect(reservas.bolsilloZCents).toBe(0);
    });
  });

  it('si la cuenta de pago es Ahorro, su saldo no entra en puedo usar', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await tx.insertAccount({
        id: 'atlantida',
        name: 'Atlántida',
        kind: 'CREDIT',
        visibility: 'PUBLIC',
        ownerPersonId: 'z',
        countsAsLiquidity: true,
        isCardPaymentSource: true,
      });
      await tx.insertCreditCard({
        id: 'card-one-limit',
        name: 'ONE',
        paymentAccountId: 'atlantida',
        coverFundId: 'viaje',
        creditLimitCents: 80000,
        personId: null,
      });
      await postAjuste(tx, { accountId: 'ahorro', amountCents: 50000 });
      await tx.setMeta(
        DASHBOARD_PREFS_KEY,
        serializeDashboardPrefs({
          ...parseDashboardPrefs(null),
          paymentAccountId: 'ahorro',
        }),
      );
      const safe = await computeSafeAvailable(tx);
      expect(safe.paymentAccountId).toBe('ahorro');
      expect(safe.paymentAccountDisponibleCents).toBe(50000);
      expect(safe.limitedCardRemainingCents).toBe(80000);
      expect(safe.disponibleSeguroCents).toBe(80000);
    });
  });
});

describe('presupuesto gastar y redimir', () => {
  async function withCasaBudget() {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await tx.insertBudgetItem({
        id: 'bi-casa',
        budgetScope: 'HOME',
        name: 'Casa',
        category: 'Vivienda',
        frequency: 'MENSUAL',
        amountCents: 40000,
        fortnight: 'BOTH',
        coverFundId: 'casa',
        usualMedium: 'TRANSFER',
        active: true,
      });
      await tx.insertBudgetItem({
        id: 'bi-libre',
        budgetScope: 'HOME',
        name: 'Sin fondo',
        category: 'Otros',
        frequency: 'MENSUAL',
        amountCents: 1000,
        fortnight: 'BOTH',
        coverFundId: null,
        usualMedium: 'TRANSFER',
        active: true,
      });
    });
    return ledger;
  }

  it('subtracts a budgeted spend from the reserved envelope and the account saldo', async () => {
    const ledger = await withCasaBudget();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 40000 });
      await spendFromBudget(tx, { budgetItemId: 'bi-casa', amountCents: 15000 });
      const balances = await computeAccountBalances(tx);
      const barras = balances.find((row) => row.account.id === 'barras')!;
      expect(barras.saldoCents).toBe(85000);
      expect(barras.reservedCents).toBe(25000);
      expect(barras.disponibleCents).toBe(60000);
      const txs = await tx.listTransactions();
      expect(txs.some((row) => row.type === 'GASTO')).toBe(true);
      const splits = await tx.listPostedSplits();
      const gastoSplits = splits.filter((split) =>
        txs.some((row) => row.id === split.transactionId && row.type === 'GASTO'),
      );
      expect(gastoSplits.reduce((sum, split) => sum + split.amountCents, 0)).toBe(0);
    });
  });

  it('rejects spending a budget item without a cover fund', async () => {
    const ledger = await withCasaBudget();
    await expect(
      ledger.withTransaction((tx) => spendFromBudget(tx, { budgetItemId: 'bi-libre', amountCents: 500 })),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('rejects spending more than the reserved budget', async () => {
    const ledger = await withCasaBudget();
    await expect(
      ledger.withTransaction(async (tx) => {
        await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
        await postReserva(tx, { fundId: 'casa', amountCents: 40000 });
        await spendFromBudget(tx, { budgetItemId: 'bi-casa', amountCents: 50000 });
      }),
    ).rejects.toThrow(/apartado suficiente/);
  });

  it('redeems unused budget as a transfer, not a gasto', async () => {
    const ledger = await withCasaBudget();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 40000 });
      await redeemUnusedBudget(tx, {
        budgetItemId: 'bi-casa',
        amountCents: 20000,
        toAccountId: 'ahorro',
      });
      const balances = await computeAccountBalances(tx);
      const barras = balances.find((row) => row.account.id === 'barras')!;
      const ahorro = balances.find((row) => row.account.id === 'ahorro')!;
      expect(barras.saldoCents).toBe(80000);
      expect(barras.reservedCents).toBe(20000);
      expect(ahorro.saldoCents).toBe(20000);
      const txs = await tx.listTransactions();
      expect(txs.some((row) => row.type === 'TRANSFERENCIA')).toBe(true);
      expect(txs.some((row) => row.type === 'GASTO')).toBe(false);
    });
  });

  it('rejects redeeming leftover budget into the same or a private account', async () => {
    const ledger = await withCasaBudget();
    await expect(
      ledger.withTransaction(async (tx) => {
        await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
        await postReserva(tx, { fundId: 'casa', amountCents: 40000 });
        await redeemUnusedBudget(tx, {
          budgetItemId: 'bi-casa',
          amountCents: 10000,
          toAccountId: 'barras',
        });
      }),
    ).rejects.toThrow(/otra cuenta/);
    await expect(
      ledger.withTransaction((tx) =>
        redeemUnusedBudget(tx, {
          budgetItemId: 'bi-casa',
          amountCents: 10000,
          toAccountId: 'priv-a',
        }),
      ),
    ).rejects.toThrow(/privada/);
  });
});

describe('horizonte de 3 meses para gastos', () => {
  const now = new Date('2026-08-20T21:00:00.000Z');

  it('keeps trimestral expenses and rejects annual operating expenses', async () => {
    expect(frequencyExceedsExpenseHorizon('TRIMESTRAL')).toBe(false);
    expect(frequencyExceedsExpenseHorizon('ANUAL')).toBe(true);
    const ledger = await setup();
    await expect(
      ledger.withTransaction((tx) =>
        saveBudgetItem(
          tx,
          {
            id: 'bi-seguro',
            budgetScope: 'HOME',
            name: 'Seguro anual',
            category: 'Servicios',
            frequency: 'ANUAL',
            amountCents: 120000,
            fortnight: 'NONE',
            coverFundId: 'casa',
            usualMedium: 'TRANSFER',
            active: true,
          },
          true,
        ),
      ),
    ).rejects.toThrow(/3 meses/);
    await expect(
      ledger.withTransaction((tx) =>
        saveBudgetItem(
          tx,
          {
            id: 'bi-trim',
            budgetScope: 'HOME',
            name: 'Agua',
            category: 'Servicios',
            frequency: 'TRIMESTRAL',
            amountCents: 3000,
            fortnight: 'NONE',
            coverFundId: 'casa',
            usualMedium: 'TRANSFER',
            active: true,
          },
          true,
        ),
      ),
    ).resolves.toMatchObject({ frequency: 'TRIMESTRAL' });
  });

  it('allows annual frequency only for savings', async () => {
    const ledger = await setup();
    const saved = await ledger.withTransaction((tx) =>
      saveBudgetItem(
        tx,
        {
          id: 'bi-viaje',
          budgetScope: 'HOME',
          name: 'Ahorro viaje',
          category: 'Ahorro',
          frequency: 'ANUAL',
          amountCents: 120000,
          fortnight: 'NONE',
          coverFundId: 'viaje',
          usualMedium: 'TRANSFER',
          active: true,
        },
        true,
      ),
    );
    expect(saved.frequency).toBe('ANUAL');
    expect(saved.active).toBe(true);
  });

  it('retires existing annual operating items without deleting posted history', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await tx.insertBudgetItem({
        id: 'bi-anual',
        budgetScope: 'HOME',
        name: 'Seguro',
        category: 'Servicios',
        frequency: 'ANUAL',
        amountCents: 120000,
        fortnight: 'NONE',
        coverFundId: 'casa',
        usualMedium: 'TRANSFER',
        active: true,
      });
      const retired = await retireExpenseBudgetsBeyondHorizon(tx);
      expect(retired).toBe(1);
      const item = await tx.getBudgetItem('bi-anual');
      expect(item?.active).toBe(false);
    });
  });

  it('rejects spending a retired annual expense but still allows redeeming leftover', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await tx.insertBudgetItem({
        id: 'bi-anual',
        budgetScope: 'HOME',
        name: 'Seguro',
        category: 'Servicios',
        frequency: 'ANUAL',
        amountCents: 120000,
        fortnight: 'NONE',
        coverFundId: 'casa',
        usualMedium: 'TRANSFER',
        active: false,
      });
      await postAjuste(tx, { accountId: 'barras', amountCents: 200000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 120000 });
      await expect(spendFromBudget(tx, { budgetItemId: 'bi-anual', amountCents: 10000 })).rejects.toThrow(
        /3 meses/,
      );
      await redeemUnusedBudget(tx, {
        budgetItemId: 'bi-anual',
        amountCents: 120000,
        toAccountId: 'ahorro',
      });
      const txs = await tx.listTransactions();
      expect(txs.some((row) => row.type === 'TRANSFERENCIA')).toBe(true);
      expect(txs.filter((row) => row.type === 'GASTO')).toHaveLength(0);
    });
  });

  it('hides GASTO older than 3 months without deleting or voiding the posted row', async () => {
    expect(isWithinExpenseHorizon('2026-05-20T00:00:00.000Z', now)).toBe(true);
    expect(isWithinExpenseHorizon('2026-05-19T00:00:00.000Z', now)).toBe(false);
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000, occurredAt: '2026-01-01T00:00:00.000Z' });
      const gastoId = await postGasto(tx, {
        accountId: 'barras',
        amountCents: 4000,
        occurredAt: '2026-04-01T00:00:00.000Z',
      });
      await postGasto(tx, {
        accountId: 'barras',
        amountCents: 2000,
        occurredAt: '2026-07-01T00:00:00.000Z',
      });
      const all = await tx.listTransactions();
      const visible = visiblePostedMovements(all, now);
      expect(visible.some((row) => row.id === gastoId)).toBe(false);
      const original = await tx.getTransaction(gastoId);
      expect(original?.status).toBe('POSTED');
      const splits = await tx.listPostedSplitsForAccount('barras');
      expect(accountBalanceFromSplits('barras', splits)).toBe(94000);
    });
  });
});

describe('Atlántida crédito y dos tarjetas', () => {
  async function setupCards() {
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
        name: 'Supermercado',
        purpose: 'Despensa',
        targetAmountCents: null,
        priority: 1,
        segment: 'OPERATING',
      });
      await tx.insertFund({
        id: 'ahorros2',
        accountId: 'ahorro',
        name: 'Ahorros 2',
        purpose: 'Cubre ONE con límite',
        targetAmountCents: 80000,
        priority: 1,
        segment: 'SAVINGS',
      });
      await tx.insertFund({
        id: 'pago-one',
        accountId: 'atlantida',
        name: 'Pago ONE',
        purpose: 'ONE sin límite',
        targetAmountCents: null,
        priority: 1,
        segment: 'OPERATING',
      });
      await tx.insertCreditCard({
        id: 'card-limit',
        name: 'ONE con límite',
        paymentAccountId: 'atlantida',
        coverFundId: 'ahorros2',
        creditLimitCents: 80000,
        personId: null,
      });
      await tx.insertCreditCard({
        id: 'card-open',
        name: 'ONE sin límite',
        paymentAccountId: 'atlantida',
        coverFundId: 'pago-one',
        creditLimitCents: null,
        personId: null,
      });
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      await postAjuste(tx, { accountId: 'ahorro', amountCents: 80000 });
      await postAjuste(tx, { accountId: 'atlantida', amountCents: 20000 });
      await postReserva(tx, { fundId: 'super', amountCents: 20000 });
      await postReserva(tx, { fundId: 'ahorros2', amountCents: 80000 });
      await postReserva(tx, { fundId: 'pago-one', amountCents: 20000 });
    });
    return ledger;
  }

  it('covers a limited-card charge from Ahorros 2 without touching Barras cash', async () => {
    const ledger = await setupCards();
    await ledger.withTransaction(async (tx) => {
      const barrasBefore = accountBalanceFromSplits('barras', await tx.listPostedSplitsForAccount('barras'));
      await postCardCharge(tx, { cardId: 'card-limit', amountCents: 5000, note: 'Cargo límite' });
      const barrasAfter = accountBalanceFromSplits('barras', await tx.listPostedSplitsForAccount('barras'));
      expect(barrasAfter).toBe(barrasBefore);
      expect(barrasAfter).toBe(100000);
      const splits = await tx.listPostedSplits();
      expect(cardBalanceFromSplits('card-limit', splits)).toBe(5000);
      const chargeSplits = splits.filter((split) => split.cardId === 'card-limit' || split.role === 'EQUITY');
      const gasto = (await tx.listTransactions()).find((row) => row.type === 'GASTO')!;
      const ofGasto = splits.filter((split) => split.transactionId === gasto.id);
      expect(ofGasto.reduce((sum, split) => sum + split.amountCents, 0)).toBe(0);
      expect(chargeSplits.some((split) => split.accountId === 'barras')).toBe(false);
      const charges = await tx.listCardCharges();
      expect(charges).toHaveLength(1);
      expect(charges[0]?.coverFundId).toBe('ahorros2');
      expect(charges[0]?.coverageStatus).toBe('CUBIERTO_PENDIENTE_TRASPASO');
      const reservedAhorros2 = (await tx.listActiveReservations())
        .filter((row) => row.fundId === 'ahorros2')
        .reduce((sum, row) => sum + row.amountCents, 0);
      expect(reservedAhorros2).toBe(80000);
      const reconstructed = -ofGasto
        .filter((split) => split.cardId === 'card-limit')
        .reduce((sum, split) => sum + split.amountCents, 0);
      expect(reconstructed).toBe(5000);
    });
  });

  it('cargo 5000 con límite 80000 deja 75000 en ONE y no toca efectivo de Atlántida', async () => {
    const ledger = await setupCards();
    await ledger.withTransaction(async (tx) => {
      const atlantidaBefore = accountBalanceFromSplits(
        'atlantida',
        await tx.listPostedSplitsForAccount('atlantida'),
      );
      expect(atlantidaBefore).toBe(20000);
      await postCardCharge(tx, { cardId: 'card-limit', amountCents: 5000 });
      expect(accountBalanceFromSplits('atlantida', await tx.listPostedSplitsForAccount('atlantida'))).toBe(
        atlantidaBefore,
      );
      expect(accountBalanceFromSplits('barras', await tx.listPostedSplitsForAccount('barras'))).toBe(100000);
      const splits = await tx.listPostedSplits();
      expect(splits.some((row) => row.cardId === 'card-limit' && row.accountId === 'atlantida')).toBe(false);
      expect(cardBalanceFromSplits('card-limit', splits)).toBe(5000);
      const cards = await computeCardBalances(tx);
      const limited = cards.find((row) => row.card.id === 'card-limit')!;
      expect(limited.disponibleTarjetaCents).toBe(75000);
      const safe = await computeSafeAvailable(tx);
      expect(safe.limitedCardRemainingCents).toBe(75000);
      expect(safe.limitedCardId).toBe('card-limit');
      expect(safe.paymentAccountId).toBe('atlantida');
      expect(safe.paymentAccountDisponibleCents).toBe(0);
      expect(safe.disponibleSeguroCents).toBe(75000);
      expect(safe.barrasDisponibleUiCents).toBe(80000);
    });
  });

  it('pago desde Atlántida baja el efectivo de la cuenta y el debe de ONE', async () => {
    const ledger = await setupCards();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'atlantida', amountCents: 5000, note: 'disponible para pagar' });
      await postCardCharge(tx, { cardId: 'card-limit', amountCents: 5000 });
      expect(accountBalanceFromSplits('atlantida', await tx.listPostedSplitsForAccount('atlantida'))).toBe(25000);
      await postCardPayment(tx, { cardId: 'card-limit', fromAccountId: 'atlantida', amountCents: 5000 });
      expect(accountBalanceFromSplits('atlantida', await tx.listPostedSplitsForAccount('atlantida'))).toBe(20000);
      expect(cardBalanceFromSplits('card-limit', await tx.listPostedSplits())).toBe(0);
      const limited = (await computeCardBalances(tx)).find((row) => row.card.id === 'card-limit')!;
      expect(limited.disponibleTarjetaCents).toBe(80000);
    });
  });

  it('rejects paying ONE from Ahorros 2', async () => {
    const ledger = await setupCards();
    await expect(
      ledger.withTransaction(async (tx) => {
        await postCardCharge(tx, { cardId: 'card-limit', amountCents: 5000 });
        await postCardPayment(tx, { cardId: 'card-limit', fromAccountId: 'ahorro', amountCents: 5000 });
      }),
    ).rejects.toThrow(/Atlántida/);
  });

  it('rechaza un cargo que descuente Barras o Atlántida al instante', async () => {
    const ledger = await setupCards();
    await ledger.withTransaction(async (tx) => {
      await postCardCharge(tx, { cardId: 'card-limit', amountCents: 5000 });
      const splits = (await tx.listPostedSplits()).filter((row) => row.cardId === 'card-limit');
      expect(splits.some((row) => row.accountId === 'barras')).toBe(false);
      expect(splits.some((row) => row.accountId === 'atlantida')).toBe(false);
    });
  });

  it('rejects mixing a limited-card charge with Barras', async () => {
    const ledger = await setupCards();
    await expect(
      ledger.withTransaction((tx) =>
        postCardCharge(tx, { cardId: 'card-limit', amountCents: 5000, coverFundId: 'super' }),
      ),
    ).rejects.toThrow(/Barras|Ahorros 2/);
    await ledger.withTransaction(async (tx) => {
      expect(await tx.listCardCharges()).toHaveLength(0);
      expect(accountBalanceFromSplits('barras', await tx.listPostedSplitsForAccount('barras'))).toBe(100000);
    });
  });

  it('rejects a limited-card charge without Ahorros 2 coverage', async () => {
    const ledger = await setupCards();
    await expect(
      ledger.withTransaction(async (tx) => {
        const reservations = await tx.listActiveReservations();
        for (const row of reservations.filter((item) => item.fundId === 'ahorros2')) {
          await tx.updateReservationStatus(row.id, 'RELEASED');
        }
        await postCardCharge(tx, { cardId: 'card-limit', amountCents: 5000 });
      }),
    ).rejects.toThrow(/cobertura/);
  });

  it('voids a limited-card charge without inflating debe or touching Barras', async () => {
    const ledger = await setupCards();
    await ledger.withTransaction(async (tx) => {
      const barrasBefore = accountBalanceFromSplits('barras', await tx.listPostedSplitsForAccount('barras'));
      const chargeId = await postCardCharge(tx, { cardId: 'card-limit', amountCents: 5000 });
      expect(cardBalanceFromSplits('card-limit', await tx.listPostedSplits())).toBe(5000);
      await voidTransaction(tx, chargeId);
      expect(cardBalanceFromSplits('card-limit', await tx.listPostedSplits())).toBe(0);
      const barrasAfter = accountBalanceFromSplits('barras', await tx.listPostedSplitsForAccount('barras'));
      expect(barrasAfter).toBe(barrasBefore);
      expect(barrasAfter).toBe(100000);
      const cards = await computeCardBalances(tx);
      const limited = cards.find((row) => row.card.id === 'card-limit')!;
      expect(limited.saldoCents).toBe(0);
      expect(limited.cubiertoCents).toBe(0);
      expect(limited.coberturaDisponibleCents).toBe(80000);
    });
  });
});

describe('cubrir gasto de cuenta con presupuesto', () => {
  async function withSuperBudget() {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await tx.insertFund({
        id: 'super',
        accountId: 'barras',
        name: 'Super',
        purpose: 'Despensa',
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
        amountCents: 6500,
        fortnight: 'BOTH',
        coverFundId: 'super',
        usualMedium: 'CASH',
        active: true,
      });
    });
    return ledger;
  }

  it('auto-covers Super 5000 by reserving then spending when Super has 0 reserved', async () => {
    const ledger = await withSuperBudget();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      const result = await executeBudgetCover(tx, {
        budgetItemId: 'bi-super',
        accountId: 'barras',
        amountCents: 5000,
        mode: 'AUTO',
      });
      expect(result.reservaTransactionId).toBeTruthy();
      expect(result.gastoTransactionId).toBeTruthy();

      const balances = await computeAccountBalances(tx);
      const barras = balances.find((row) => row.account.id === 'barras')!;
      expect(barras.saldoCents).toBe(95000);
      const funds = await computeFundBalances(tx);
      expect(funds.find((row) => row.fund.id === 'super')?.reservedCents).toBe(0);

      const txs = await tx.listTransactions();
      const posted = txs.filter((row) => row.status === 'POSTED');
      expect(posted.filter((row) => row.type === 'RESERVA')).toHaveLength(1);
      expect(posted.filter((row) => row.type === 'GASTO')).toHaveLength(1);
      expect(posted.some((row) => row.type === 'TRANSFERENCIA')).toBe(false);
      expect(posted.some((row) => row.type === 'GASTO' && /transfer/i.test(row.note))).toBe(false);

      for (const row of posted.filter((item) => item.type === 'RESERVA' || item.type === 'GASTO')) {
        const splits = await tx.listSplitsForTransaction(row.id);
        expect(splits.reduce((sum, split) => sum + split.amountCents, 0)).toBe(0);
      }
      const reconstructed = accountBalanceFromSplits('barras', await tx.listPostedSplitsForAccount('barras'));
      expect(reconstructed).toBe(95000);
    });
  });

  it('spends from existing Super reserve without an extra RESERVA', async () => {
    const ledger = await withSuperBudget();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      await postReserva(tx, { fundId: 'super', amountCents: 8000 });
      const result = await executeBudgetCover(tx, {
        budgetItemId: 'bi-super',
        accountId: 'barras',
        amountCents: 5000,
        mode: 'AUTO',
      });
      expect(result.reservaTransactionId).toBeNull();
      expect(result.gastoTransactionId).toBeTruthy();

      const balances = await computeAccountBalances(tx);
      const barras = balances.find((row) => row.account.id === 'barras')!;
      expect(barras.saldoCents).toBe(95000);
      const funds = await computeFundBalances(tx);
      expect(funds.find((row) => row.fund.id === 'super')?.reservedCents).toBe(3000);

      const txs = await tx.listTransactions();
      expect(txs.filter((row) => row.type === 'RESERVA' && row.status === 'POSTED')).toHaveLength(1);
      expect(txs.filter((row) => row.type === 'GASTO' && row.status === 'POSTED')).toHaveLength(1);
      const gastoSplits = await tx.listSplitsForTransaction(result.gastoTransactionId!);
      expect(gastoSplits.reduce((sum, split) => sum + split.amountCents, 0)).toBe(0);
    });
  });

  it('reserve-only retains Super without posting a GASTO', async () => {
    const ledger = await withSuperBudget();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      const result = await executeBudgetCover(tx, {
        budgetItemId: 'bi-super',
        accountId: 'barras',
        amountCents: 5000,
        mode: 'RESERVE_ONLY',
      });
      expect(result.reservaTransactionId).toBeTruthy();
      expect(result.gastoTransactionId).toBeNull();

      const balances = await computeAccountBalances(tx);
      const barras = balances.find((row) => row.account.id === 'barras')!;
      expect(barras.saldoCents).toBe(100000);
      expect(barras.reservedCents).toBe(5000);
      const funds = await computeFundBalances(tx);
      expect(funds.find((row) => row.fund.id === 'super')?.reservedCents).toBe(5000);

      const txs = await tx.listTransactions();
      expect(txs.some((row) => row.type === 'GASTO')).toBe(false);
      expect(txs.filter((row) => row.type === 'RESERVA' && row.status === 'POSTED')).toHaveLength(1);
      const reservaSplits = await tx.listSplitsForTransaction(result.reservaTransactionId!);
      expect(reservaSplits.reduce((sum, split) => sum + split.amountCents, 0)).toBe(0);
    });
  });

  it('rejects auto-spend when available and reserved are 0', async () => {
    const ledger = await withSuperBudget();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 100000 });
    });
    await expect(
      ledger.withTransaction((tx) =>
        executeBudgetCover(tx, {
          budgetItemId: 'bi-super',
          accountId: 'barras',
          amountCents: 5000,
          mode: 'AUTO',
        }),
      ),
    ).rejects.toThrow(/No hay apartado en Super ni disponible en Barras/);
    await ledger.withTransaction(async (tx) => {
      const funds = await computeFundBalances(tx);
      expect(funds.find((row) => row.fund.id === 'super')?.reservedCents).toBe(0);
      expect(funds.find((row) => row.fund.id === 'casa')?.reservedCents).toBe(100000);
      const txs = await tx.listTransactions();
      expect(txs.filter((row) => row.type === 'GASTO')).toHaveLength(0);
    });
  });

  it('rejects covering an account A expense with a fund that lives on account B', async () => {
    const ledger = await withSuperBudget();
    await expect(
      ledger.withTransaction((tx) =>
        executeBudgetCover(tx, {
          budgetItemId: 'bi-super',
          accountId: 'ahorro',
          amountCents: 5000,
          mode: 'AUTO',
        }),
      ),
    ).rejects.toThrow(/pertenece a Barras, no a Ahorro/);
  });

  it('rejects a float amount', async () => {
    const ledger = await withSuperBudget();
    await expect(
      ledger.withTransaction((tx) =>
        executeBudgetCover(tx, {
          budgetItemId: 'bi-super',
          accountId: 'barras',
          amountCents: 50.5,
          mode: 'AUTO',
        }),
      ),
    ).rejects.toThrow(/entero/);
  });

  it('links a posted GASTO to Super on correction without deleting history', async () => {
    const ledger = await withSuperBudget();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      const originalId = await postGasto(tx, { accountId: 'barras', amountCents: 5000 });
      await voidTransaction(tx, originalId);
      await executeBudgetCover(tx, {
        budgetItemId: 'bi-super',
        accountId: 'barras',
        amountCents: 5000,
        mode: 'AUTO',
      });
      const original = await tx.getTransaction(originalId);
      expect(original?.status).toBe('VOID');
      expect('deleteTransaction' in ledger).toBe(false);
      const balances = await computeAccountBalances(tx);
      expect(balances.find((row) => row.account.id === 'barras')?.saldoCents).toBe(95000);
      const funds = await computeFundBalances(tx);
      expect(funds.find((row) => row.fund.id === 'super')?.reservedCents).toBe(0);
    });
  });
});

describe('partes Z/A del presupuesto', () => {
  it('acepta HOME 10000 ¢ con Z 6000 + A 4000 y rechaza 6001+4000 y 50.5', async () => {
    const ledger = await setup();
    const saved = await ledger.withTransaction((tx) =>
      saveBudgetItem(
        tx,
        {
          id: 'bi-luz',
          budgetScope: 'HOME',
          name: 'Luz',
          category: 'Servicios',
          frequency: 'MENSUAL',
          amountCents: 10000,
          zShareCents: 6000,
          aShareCents: 4000,
          fortnight: 'NONE',
          coverFundId: null,
          usualMedium: 'TRANSFER',
          active: true,
        },
        true,
      ),
    );
    expect(saved.zShareCents).toBe(6000);
    expect(saved.aShareCents).toBe(4000);
    expect(monthlyEquivalentCents('MENSUAL', saved.zShareCents, true)).toBe(6000);
    expect(monthlyEquivalentCents('MENSUAL', saved.aShareCents, true)).toBe(4000);
    await expect(
      ledger.withTransaction((tx) =>
        saveBudgetItem(
          tx,
          {
            ...saved,
            zShareCents: 6001,
            aShareCents: 4000,
          },
          false,
        ),
      ),
    ).rejects.toThrow(/Z más la de A/);
    await expect(
      ledger.withTransaction((tx) =>
        saveBudgetItem(
          tx,
          {
            ...saved,
            zShareCents: 50.5,
            aShareCents: 9949.5,
          },
          false,
        ),
      ),
    ).rejects.toThrow(/entero en centavos/);
  });
});

describe('cuadre de tarjetas Atlántida', () => {
  async function setupAtlantidaCards() {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await tx.insertAccount({
        id: 'atlantida',
        name: 'Atlántida',
        kind: 'CREDIT',
        visibility: 'PUBLIC',
        ownerPersonId: 'z',
        countsAsLiquidity: true,
        isCardPaymentSource: true,
      });
      await tx.insertCreditCard({
        id: 'card-open',
        name: 'ONE sin límite',
        paymentAccountId: 'atlantida',
        coverFundId: null,
        creditLimitCents: null,
        personId: null,
      });
    });
    return ledger;
  }

  it('informar debe 50000 cuando la app tiene 0 crea AJUSTE de 50000 y reconstruye el saldo', async () => {
    const ledger = await setupAtlantidaCards();
    await ledger.withTransaction(async (tx) => {
      const id = await setCardOwedBase(tx, { cardId: 'card-open', targetCents: 50000 });
      const row = await tx.getTransaction(id);
      expect(row?.type).toBe('AJUSTE');
      expect(row?.status).toBe('POSTED');
      const splits = await tx.listSplitsForTransaction(id);
      expect(splits.reduce((sum, split) => sum + split.amountCents, 0)).toBe(0);
      expect(cardBalanceFromSplits('card-open', await tx.listPostedSplits())).toBe(50000);
      const barras = accountBalanceFromSplits('barras', await tx.listPostedSplitsForAccount('barras'));
      expect(barras).toBe(0);
      expect(await tx.listCardCharges()).toHaveLength(0);
    });
  });

  it('informar el mismo monto rechaza porque ya cuadra', async () => {
    const ledger = await setupAtlantidaCards();
    await ledger.withTransaction(async (tx) => {
      await setCardOwedBase(tx, { cardId: 'card-open', targetCents: 50000 });
      await expect(setCardOwedBase(tx, { cardId: 'card-open', targetCents: 50000 })).rejects.toThrow(/ya cuadra/i);
      expect(cardBalanceFromSplits('card-open', await tx.listPostedSplits())).toBe(50000);
      const ajustes = (await tx.listTransactions()).filter((row) => row.type === 'AJUSTE');
      expect(ajustes).toHaveLength(1);
    });
  });
});

describe('fondos: recarga quincenal y vaciar a sobrante', () => {
  it('la recarga quincenal es RESERVA y no aparece en el filtro de gastos', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await tx.insertBudgetItem({
        id: 'bi-casa',
        budgetScope: 'HOME',
        name: 'Casa',
        category: 'Vivienda',
        frequency: 'QUINCENAL',
        amountCents: 4000,
        fortnight: 'BOTH',
        coverFundId: 'casa',
        usualMedium: 'CASH',
        active: true,
        zShareCents: 2000,
        aShareCents: 2000,
      });
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      const ids = await injectBudgetedFortnightReserves(tx);
      expect(ids).toHaveLength(1);
      const txs = await tx.listTransactions();
      expect(txs.filter((row) => row.type === 'RESERVA' && /Ingreso de fondo presupuestado/i.test(row.note))).toHaveLength(
        1,
      );
      const splitsByTx = new Map<string, Awaited<ReturnType<typeof tx.listSplits>>>();
      for (const split of await tx.listSplits()) {
        const list = splitsByTx.get(split.transactionId) ?? [];
        list.push(split);
        splitsByTx.set(split.transactionId, list);
      }
      const gastos = filterHistoryMovements(txs, splitsByTx, { filter: { type: 'GASTO' } });
      expect(gastos).toHaveLength(0);
      const funds = await computeFundBalances(tx);
      expect(funds.find((row) => row.fund.id === 'casa')?.reservedCents).toBe(4000);
    });
  });

  it('vaciar el fondo y cubrir con sobrante no duplica liquidez', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 20000 });
      const before = (await computeAccountBalances(tx)).find((row) => row.account.id === 'barras')!;
      expect(before.saldoCents).toBe(100000);
      expect(before.reservedCents).toBe(20000);
      expect(before.disponibleCents).toBe(80000);
      await emptyFundThenSpendFromLeftover(tx, {
        fundId: 'casa',
        accountId: 'barras',
        amountCents: 5000,
        note: 'cubre con sobrante',
      });
      const after = (await computeAccountBalances(tx)).find((row) => row.account.id === 'barras')!;
      expect(after.saldoCents).toBe(95000);
      expect(after.reservedCents).toBe(0);
      expect(after.disponibleCents).toBe(95000);
      const txs = await tx.listTransactions();
      expect(txs.filter((row) => row.type === 'LIBERACION_RESERVA' && row.status === 'POSTED')).toHaveLength(1);
      expect(txs.filter((row) => row.type === 'GASTO' && row.status === 'POSTED')).toHaveLength(1);
    });
  });
});

describe('cargo ONE cubierto con fondo de Barras', () => {
  it('no baja el efectivo de Barras', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await tx.insertAccount({
        id: 'atlantida',
        name: 'Atlántida',
        kind: 'CREDIT',
        visibility: 'PUBLIC',
        ownerPersonId: 'z',
        countsAsLiquidity: true,
        isCardPaymentSource: true,
      });
      await tx.insertCreditCard({
        id: 'card-one',
        name: 'ONE',
        paymentAccountId: 'atlantida',
        coverFundId: null,
        creditLimitCents: 270000,
        personId: null,
      });
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 20000 });
      const barrasBefore = accountBalanceFromSplits('barras', await tx.listPostedSplitsForAccount('barras'));
      await postCardCharge(tx, {
        cardId: 'card-one',
        amountCents: 5000,
        coverFundId: 'casa',
        note: 'Super ONE',
      });
      expect(accountBalanceFromSplits('barras', await tx.listPostedSplitsForAccount('barras'))).toBe(barrasBefore);
      const charge = (await tx.listCardCharges())[0];
      expect(charge?.coverFundId).toBe('casa');
      expect(charge?.coverageStatus).toBe('CUBIERTO_PENDIENTE_TRASPASO');
      expect(cardBalanceFromSplits('card-one', await tx.listPostedSplits())).toBe(5000);
    });
  });
});

