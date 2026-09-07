import { describe, expect, it } from 'vitest';
import { MemoryLedger } from './memoryLedger';
import { computeAccountBalances, computeFundBalances } from './balances';
import { emptyFundToAvailable, emptyFundsToAvailable } from './budgetOps';
import { DomainError } from './ledger';
import { postAjuste, postLiberacion, postReserva, postTransferencia } from './posting';
import {
  RELEASE_DESTINATIONS_EMPTY_MESSAGE,
  RELEASE_DESTINATION_FORBIDDEN_MESSAGE,
  RELEASE_DESTINATIONS_META_KEY,
  defaultReleaseDestinationIds,
  isDefaultReleaseDestination,
  listedReleaseDestinationAccounts,
  parseReleaseDestinations,
  resolveReleaseDestinationIds,
  serializeReleaseDestinations,
} from './releaseDestinations';
import type { Account } from './types';

function account(partial: Partial<Account> & Pick<Account, 'id' | 'name'>): Account {
  return {
    kind: 'BANK',
    visibility: 'PUBLIC',
    ownerPersonId: null,
    countsAsLiquidity: true,
    isCardPaymentSource: false,
    ...partial,
  };
}

async function setup() {
  const ledger = new MemoryLedger();
  await ledger.withTransaction(async (tx) => {
    await tx.insertPerson({ id: 'z', code: 'Z', displayName: 'Z' });
    await tx.insertPerson({ id: 'a', code: 'A', displayName: 'A' });
    await tx.insertAccount(account({ id: 'barras', name: 'Barras' }));
    await tx.insertAccount(account({ id: 'ahorro', name: 'Ahorros' }));
    await tx.insertAccount(account({ id: 'ahorros-2', name: 'Ahorros 2' }));
    await tx.insertAccount(
      account({
        id: 'atlantida',
        name: 'Atlántida',
        kind: 'CREDIT',
        isCardPaymentSource: true,
      }),
    );
    await tx.insertAccount(
      account({
        id: 'priv-a',
        name: 'Cuenta A',
        visibility: 'PRIVATE',
        ownerPersonId: 'a',
        countsAsLiquidity: false,
      }),
    );
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

describe('release destinations control', () => {
  it('defaults to Barras and savings, not Atlántida or private', () => {
    const accounts = [
      account({ id: 'barras', name: 'Barras' }),
      account({ id: 'ahorro', name: 'Ahorros' }),
      account({ id: 'ahorros-2', name: 'Ahorros 2' }),
      account({ id: 'atlantida', name: 'Atlántida', isCardPaymentSource: true }),
      account({ id: 'priv-a', name: 'Cuenta A', visibility: 'PRIVATE' }),
    ];
    expect(listedReleaseDestinationAccounts(accounts).map((row) => row.id)).toEqual([
      'ahorro',
      'ahorros-2',
      'atlantida',
      'barras',
    ]);
    expect(isDefaultReleaseDestination(accounts[3]!)).toBe(false);
    expect(defaultReleaseDestinationIds(accounts).sort()).toEqual(['ahorro', 'ahorros-2', 'barras']);
    expect(resolveReleaseDestinationIds(accounts, { configured: false, accountIds: [] }).sort()).toEqual([
      'ahorro',
      'ahorros-2',
      'barras',
    ]);
    expect(resolveReleaseDestinationIds(accounts, { configured: true, accountIds: [] })).toEqual([]);
    expect(parseReleaseDestinations(null).configured).toBe(false);
    expect(parseReleaseDestinations(serializeReleaseDestinations(['barras', 'atlantida']))).toEqual({
      configured: true,
      accountIds: ['barras', 'atlantida'],
    });
  });

  it('releases to Barras by default and is not a GASTO', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 40000 });
      const reservation = (await tx.listActiveReservations())[0]!;
      await postLiberacion(tx, { reservationId: reservation.id, toAccountId: 'barras' });
      const barras = (await computeAccountBalances(tx)).find((row) => row.account.id === 'barras')!;
      expect(barras.saldoCents).toBe(100000);
      expect(barras.reservedCents).toBe(0);
      const txs = await tx.listTransactions();
      expect(txs.some((row) => row.type === 'LIBERACION_RESERVA' && row.status === 'POSTED')).toBe(true);
      expect(txs.filter((row) => row.type === 'GASTO')).toHaveLength(0);
    });
  });

  it('rejects a destination that is not allowed', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 40000 });
      const reservation = (await tx.listActiveReservations())[0]!;
      await expect(
        postLiberacion(tx, { reservationId: reservation.id, toAccountId: 'atlantida' }),
      ).rejects.toThrow(RELEASE_DESTINATION_FORBIDDEN_MESSAGE);
      await expect(
        postLiberacion(tx, { reservationId: reservation.id, toAccountId: 'priv-a' }),
      ).rejects.toThrow(/privada/);
      await expect(
        postTransferencia(tx, {
          fromAccountId: 'barras',
          toAccountId: 'atlantida',
          amountCents: 40000,
          fromFundId: 'casa',
        }),
      ).rejects.toThrow(RELEASE_DESTINATION_FORBIDDEN_MESSAGE);
      const reserved = (await computeFundBalances(tx)).find((row) => row.fund.id === 'casa')!;
      expect(reserved.reservedCents).toBe(40000);
    });
  });

  it('allows Atlántida only after the control enables it', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await tx.setMeta(RELEASE_DESTINATIONS_META_KEY, serializeReleaseDestinations(['barras', 'atlantida']));
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 40000 });
      const reservation = (await tx.listActiveReservations())[0]!;
      await postLiberacion(tx, { reservationId: reservation.id, toAccountId: 'atlantida' });
      const balances = await computeAccountBalances(tx);
      expect(balances.find((row) => row.account.id === 'barras')?.saldoCents).toBe(60000);
      expect(balances.find((row) => row.account.id === 'barras')?.reservedCents).toBe(0);
      expect(balances.find((row) => row.account.id === 'atlantida')?.saldoCents).toBe(40000);
      const txs = await tx.listTransactions();
      expect(txs.filter((row) => row.type === 'GASTO')).toHaveLength(0);
    });
  });

  it('does not release when the control list is empty', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await tx.setMeta(RELEASE_DESTINATIONS_META_KEY, serializeReleaseDestinations([]));
      await postAjuste(tx, { accountId: 'barras', amountCents: 50000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 10000 });
      const reservation = (await tx.listActiveReservations())[0]!;
      await expect(postLiberacion(tx, { reservationId: reservation.id, toAccountId: 'barras' })).rejects.toThrow(
        RELEASE_DESTINATIONS_EMPTY_MESSAGE,
      );
      await expect(emptyFundToAvailable(tx, { fundId: 'casa', toAccountId: 'barras' })).rejects.toThrow(
        DomainError,
      );
    });
  });

  it('empties a fund toward an allowed savings account', async () => {
    const ledger = await setup();
    await ledger.withTransaction(async (tx) => {
      await postAjuste(tx, { accountId: 'barras', amountCents: 80000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 25000 });
      await emptyFundToAvailable(tx, { fundId: 'casa', toAccountId: 'ahorro' });
      const balances = await computeAccountBalances(tx);
      expect(balances.find((row) => row.account.id === 'barras')?.saldoCents).toBe(55000);
      expect(balances.find((row) => row.account.id === 'barras')?.reservedCents).toBe(0);
      expect(balances.find((row) => row.account.id === 'ahorro')?.saldoCents).toBe(25000);
      const txs = await tx.listTransactions();
      expect(txs.filter((row) => row.type === 'LIBERACION_RESERVA' && row.status === 'POSTED')).toHaveLength(1);
      expect(txs.filter((row) => row.type === 'TRANSFERENCIA' && row.status === 'POSTED')).toHaveLength(1);
      expect(txs.filter((row) => row.type === 'GASTO')).toHaveLength(0);
    });
  });

  it('empties several funds with checks and rejects an empty selection', async () => {
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
      await postAjuste(tx, { accountId: 'barras', amountCents: 100000 });
      await postReserva(tx, { fundId: 'casa', amountCents: 20000 });
      await postReserva(tx, { fundId: 'super', amountCents: 15000 });
      await expect(emptyFundsToAvailable(tx, { fundIds: [], toAccountId: 'ahorro' })).rejects.toThrow(
        /al menos un fondo/i,
      );
      const ids = await emptyFundsToAvailable(tx, { fundIds: ['casa', 'super'], toAccountId: 'ahorro' });
      expect(ids.length).toBeGreaterThan(1);
      const balances = await computeAccountBalances(tx);
      expect(balances.find((row) => row.account.id === 'barras')?.reservedCents).toBe(0);
      expect(balances.find((row) => row.account.id === 'ahorro')?.saldoCents).toBe(35000);
      const txs = await tx.listTransactions();
      expect(txs.filter((row) => row.type === 'LIBERACION_RESERVA' && row.status === 'POSTED').length).toBeGreaterThan(1);
      expect(txs.filter((row) => row.type === 'GASTO')).toHaveLength(0);
    });
  });
});
