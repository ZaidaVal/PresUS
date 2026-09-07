import { describe, expect, it } from 'vitest';
import { MemoryLedger } from '../domain/memoryLedger';
import { postAjuste, postGasto, postReserva, postTransferencia } from '../domain/posting';
import { accountBalanceFromSplits, computeAccountBalances, dashboardListedAccounts } from '../domain';
import { ONE_CARD_CAP_100_CENTS, ONE_CREDIT_LINE_CENTS, ONE_CREDIT_LINE_ID } from '../domain/creditLine';
import { applyExplicitEmptyBookIfNeeded, applyFactoryEmptyIfNeeded, EXPLICIT_EMPTY_BOOK_META, FACTORY_EMPTY_META, FACTORY_EMPTY_STORAGE_KEY, IDS, markFactoryFileWipeDone, seedDemoIfRestoreMissing, seedIfNeeded, shouldWipeLegacyDatabase } from './seed';

describe('ledger fresco de fábrica', () => {
  it('solo tiene personas Z/A; no cuentas, fondos, GASTO, presupuesto, tarjetas ni deudas', async () => {
    const ledger = new MemoryLedger();
    await seedIfNeeded(ledger);
    await ledger.withTransaction(async (tx) => {
      const people = await tx.listPeople();
      expect(people.map((row) => row.code).sort()).toEqual(['A', 'Z']);
      expect(people.find((row) => row.code === 'Z')?.id).toBe(IDS.people.z);
      expect(people.find((row) => row.code === 'A')?.id).toBe(IDS.people.a);
      expect(await tx.listAccounts()).toEqual([]);
      expect(await tx.listFunds()).toEqual([]);
      expect(await tx.listTransactions()).toEqual([]);
      expect(await tx.listBudgetItems()).toEqual([]);
      expect(await tx.listCreditCards()).toEqual([]);
      expect(await tx.listDebts()).toEqual([]);
      expect(await tx.listReservations()).toEqual([]);
      expect((await tx.listTransactions()).some((row) => row.type === 'GASTO')).toBe(false);
      expect(await tx.getMeta('seeded')).toBeUndefined();
    });
  });

  it('con seeded=1 no rellena cuentas ni movimientos', async () => {
    const ledger = new MemoryLedger();
    await ledger.withTransaction(async (tx) => {
      await tx.insertPerson({ id: IDS.people.z, code: 'Z', displayName: 'Z' });
      await tx.insertPerson({ id: IDS.people.a, code: 'A', displayName: 'A' });
      await tx.setMeta('seeded', '1');
    });
    await seedIfNeeded(ledger);
    await ledger.withTransaction(async (tx) => {
      expect(await tx.listAccounts()).toEqual([]);
      expect(await tx.listTransactions()).toEqual([]);
      expect(await tx.getMeta('seeded')).toBe('1');
    });
  });
});

describe('reset de fábrica', () => {
  it('vacía cuentas y POSTED de una semilla vieja una sola vez', async () => {
    const ledger = new MemoryLedger();
    await seedIfNeeded(ledger);
    await ledger.withTransaction(async (tx) => {
      await tx.insertAccount({
        id: IDS.accounts.barras,
        name: 'Barras',
        kind: 'BANK',
        visibility: 'PUBLIC',
        ownerPersonId: null,
        countsAsLiquidity: true,
        isCardPaymentSource: false,
      });
      await postAjuste(tx, { accountId: IDS.accounts.barras, amountCents: 120000, note: 'apertura' });
      await postGasto(tx, { accountId: IDS.accounts.barras, amountCents: 500, note: 'gasto semilla' });
    });

    await applyFactoryEmptyIfNeeded(ledger);
    await ledger.withTransaction(async (tx) => {
      expect(await tx.listAccounts()).toEqual([]);
      expect(await tx.listTransactions()).toEqual([]);
      expect((await tx.listPeople()).map((row) => row.code).sort()).toEqual(['A', 'Z']);
      expect(await tx.getMeta(FACTORY_EMPTY_META)).toBe('1');
    });

    await ledger.withTransaction(async (tx) => {
      await tx.insertAccount({
        id: 'acc-nueva',
        name: 'Nueva',
        kind: 'BANK',
        visibility: 'PUBLIC',
        ownerPersonId: null,
        countsAsLiquidity: true,
        isCardPaymentSource: false,
      });
    });
    await applyFactoryEmptyIfNeeded(ledger);
    await ledger.withTransaction(async (tx) => {
      expect(await tx.listAccounts()).toHaveLength(1);
      expect((await tx.getAccount('acc-nueva'))?.name).toBe('Nueva');
    });
  });

  it('el wipe de archivo IndexedDB no se dispara en el segundo init', () => {
    const storage = {
      data: new Map<string, string>(),
      getItem(key: string) {
        return this.data.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        this.data.set(key, value);
      },
    };
    expect(shouldWipeLegacyDatabase(storage)).toBe(true);
    markFactoryFileWipeDone(storage);
    expect(storage.getItem(FACTORY_EMPTY_STORAGE_KEY)).toBe('1');
    expect(shouldWipeLegacyDatabase(storage)).toBe(false);
    expect(shouldWipeLegacyDatabase(storage)).toBe(false);
  });
});

describe('semilla PresUS', () => {
  it('en ledger vacío de cuentas crea Barras, Atlántida, Ahorros, Ahorros 2, ONE e hipoteca', async () => {
    const ledger = new MemoryLedger();
    await seedIfNeeded(ledger);
    await seedDemoIfRestoreMissing(ledger);
    await ledger.withTransaction(async (tx) => {
      expect((await tx.getAccount(IDS.accounts.barras))?.name).toBe('Barras');
      expect((await tx.getAccount(IDS.accounts.atlantida))?.kind).toBe('CREDIT');
      expect((await tx.getAccount(IDS.accounts.ahorro))?.name).toBe('Ahorros');
      expect((await tx.getAccount(IDS.accounts.ahorros2))?.name).toBe('Ahorros 2');
      expect((await tx.getAccount(IDS.accounts.ahorro))?.isCardPaymentSource).toBe(false);
      expect((await tx.getAccount(IDS.accounts.ahorros2))?.isCardPaymentSource).toBe(false);
      expect((await tx.getAccount(IDS.accounts.atlantida))?.isCardPaymentSource).toBe(true);
      const limited = await tx.getCreditCard(IDS.cards.limited);
      const cap100 = await tx.getCreditCard(IDS.cards.cap100);
      expect(limited).toBeTruthy();
      expect(limited?.creditLineId).toBe(ONE_CREDIT_LINE_ID);
      expect(limited?.creditLineLimitCents).toBe(ONE_CREDIT_LINE_CENTS);
      expect(limited?.paymentAccountId).toBe(IDS.accounts.atlantida);
      expect(limited?.coverFundId).toBe(IDS.funds.ahorros2);
      expect(cap100?.creditLimitCents).toBe(ONE_CARD_CAP_100_CENTS);
      expect(cap100?.creditLineLimitCents).toBe(ONE_CREDIT_LINE_CENTS);
      expect(limited?.id).not.toBe(IDS.accounts.atlantida);
      expect(await tx.getDebt(IDS.debts.hipoteca)).toBeTruthy();
      expect((await tx.getFund(IDS.funds.ahorroGeneral))?.accountId).toBe(IDS.accounts.ahorro);
      expect((await tx.getFund(IDS.funds.ahorroGeneral))?.name).toBe('Ahorros');
      expect((await tx.getFund(IDS.funds.ahorros2))?.accountId).toBe(IDS.accounts.ahorros2);
      expect((await tx.getFund(IDS.funds.pagoOne))?.accountId).toBe(IDS.accounts.atlantida);
      expect(await tx.getFund(IDS.funds.ahorroBarras)).toBeUndefined();
      expect((await tx.getBudgetItem('bi-ahorro'))?.coverFundId).toBe(IDS.funds.ahorroGeneral);
      expect((await tx.getBudgetItem('bi-ahorro'))?.name).toBe('Ahorros');
      expect(accountBalanceFromSplits(IDS.accounts.ahorro, await tx.listPostedSplitsForAccount(IDS.accounts.ahorro))).toBe(85000);
      expect(accountBalanceFromSplits(IDS.accounts.ahorros2, await tx.listPostedSplitsForAccount(IDS.accounts.ahorros2))).toBe(80000);
      const listed = dashboardListedAccounts(await computeAccountBalances(tx));
      expect(listed.map((row) => row.account.id).sort()).toEqual([IDS.accounts.atlantida, IDS.accounts.barras].sort());
      expect(listed.some((row) => /ahorro/i.test(row.account.name))).toBe(false);
      expect(listed.some((row) => row.account.visibility === 'PRIVATE')).toBe(false);
      const splits = await tx.listSplits();
      expect(splits.every((row) => Number.isInteger(row.amountCents))).toBe(true);
      expect(splits.reduce((sum, row) => sum + row.amountCents, 0)).toBe(0);
      expect(await tx.getMeta('seeded')).toBe('1');
    });
  });

  it('mueve $800 de Ahorros a Ahorros 2 si eliges el fondo origen', async () => {
    const ledger = new MemoryLedger();
    await seedIfNeeded(ledger);
    await seedDemoIfRestoreMissing(ledger);
    await ledger.withTransaction(async (tx) => {
      const before = await computeAccountBalances(tx);
      expect(before.find((row) => row.account.id === IDS.accounts.ahorro)?.disponibleCents).toBe(0);
      await expect(
        postTransferencia(tx, {
          fromAccountId: IDS.accounts.ahorro,
          toAccountId: IDS.accounts.ahorros2,
          amountCents: 80000,
        }),
      ).rejects.toThrow('No hay disponible suficiente en Ahorros');
      await postTransferencia(tx, {
        fromAccountId: IDS.accounts.ahorro,
        toAccountId: IDS.accounts.ahorros2,
        amountCents: 80000,
        fromFundId: IDS.funds.ahorroGeneral,
        toFundId: IDS.funds.ahorros2,
      });
      expect(accountBalanceFromSplits(IDS.accounts.ahorro, await tx.listPostedSplitsForAccount(IDS.accounts.ahorro))).toBe(5000);
      expect(accountBalanceFromSplits(IDS.accounts.ahorros2, await tx.listPostedSplitsForAccount(IDS.accounts.ahorros2))).toBe(160000);
      const after = await computeAccountBalances(tx);
      const ahorro = after.find((row) => row.account.id === IDS.accounts.ahorro)!;
      const ahorros2 = after.find((row) => row.account.id === IDS.accounts.ahorros2)!;
      expect(ahorro.reservedCents).toBe(5000);
      expect(ahorro.disponibleCents).toBe(0);
      expect(ahorros2.reservedCents).toBe(160000);
      expect(ahorros2.saldoCents).toBeGreaterThanOrEqual(ahorros2.reservedCents);
    });
  });

  it('el wipe explícito deja solo Z/A y no re-siembra PresUS', async () => {
    const ledger = new MemoryLedger();
    await seedIfNeeded(ledger);
    await ledger.withTransaction(async (tx) => {
      await tx.insertAccount({
        id: 'acc-sucia',
        name: 'Sucia',
        kind: 'BANK',
        visibility: 'PUBLIC',
        ownerPersonId: null,
        countsAsLiquidity: true,
        isCardPaymentSource: false,
      });
      await postAjuste(tx, { accountId: 'acc-sucia', amountCents: 999, note: 'basura' });
    });
    expect(await applyExplicitEmptyBookIfNeeded(ledger)).toBe(true);
    await seedIfNeeded(ledger);
    await seedDemoIfRestoreMissing(ledger);
    await ledger.withTransaction(async (tx) => {
      expect((await tx.listPeople()).map((row) => row.code).sort()).toEqual(['A', 'Z']);
      expect(await tx.listAccounts()).toEqual([]);
      expect(await tx.listFunds()).toEqual([]);
      expect(await tx.listTransactions()).toEqual([]);
      expect(await tx.listBudgetItems()).toEqual([]);
      expect(await tx.getAccount('acc-sucia')).toBeUndefined();
      expect(await tx.getAccount(IDS.accounts.barras)).toBeUndefined();
      expect(await tx.getAccount(IDS.accounts.ahorro)).toBeUndefined();
      expect(await tx.getMeta(EXPLICIT_EMPTY_BOOK_META)).toBe('1');
    });
    expect(await applyExplicitEmptyBookIfNeeded(ledger)).toBe(false);
    await ledger.withTransaction(async (tx) => {
      expect(await tx.listAccounts()).toEqual([]);
      expect(await tx.listTransactions()).toEqual([]);
    });
  });

  it('no pisa un libro con cuentas o txs POSTED', async () => {
    const ledger = new MemoryLedger();
    await seedIfNeeded(ledger);
    await ledger.withTransaction(async (tx) => {
      await tx.insertAccount({
        id: 'acc-propia',
        name: 'Propia',
        kind: 'BANK',
        visibility: 'PUBLIC',
        ownerPersonId: null,
        countsAsLiquidity: true,
        isCardPaymentSource: false,
      });
      await postAjuste(tx, { accountId: 'acc-propia', amountCents: 1000, note: 'apertura' });
      await postGasto(tx, { accountId: 'acc-propia', amountCents: 200, note: 'gasto real' });
    });
    await seedDemoIfRestoreMissing(ledger);
    await ledger.withTransaction(async (tx) => {
      expect(await tx.listAccounts()).toHaveLength(1);
      expect((await tx.getAccount('acc-propia'))?.name).toBe('Propia');
      const txs = await tx.listTransactions();
      expect(txs.some((row) => row.type === 'GASTO' && row.note === 'gasto real')).toBe(true);
      expect(await tx.getAccount(IDS.accounts.barras)).toBeUndefined();
    });
  });

  it('factory_empty_v1 no vuelve a cargar demo si no hay cuentas', async () => {
    const ledger = new MemoryLedger();
    await seedIfNeeded(ledger);
    await ledger.withTransaction(async (tx) => {
      await tx.setMeta(FACTORY_EMPTY_META, '1');
    });
    await seedDemoIfRestoreMissing(ledger);
    await ledger.withTransaction(async (tx) => {
      expect(await tx.listAccounts()).toEqual([]);
      expect(await tx.listTransactions()).toEqual([]);
      expect(await tx.getAccount(IDS.accounts.barras)).toBeUndefined();
      expect(await tx.getMeta(FACTORY_EMPTY_META)).toBe('1');
    });
  });

  it('separa Ahorros 2 a su cuenta sin borrar POSTED ni inventar un tercer ahorro', async () => {
    const ledger = new MemoryLedger();
    await seedIfNeeded(ledger);
    await ledger.withTransaction(async (tx) => {
      await tx.insertAccount({
        id: IDS.accounts.ahorro,
        name: 'Ahorro',
        kind: 'BANK',
        visibility: 'PUBLIC',
        ownerPersonId: null,
        countsAsLiquidity: true,
        isCardPaymentSource: false,
      });
      await tx.insertFund({
        id: IDS.funds.ahorroGeneral,
        accountId: IDS.accounts.ahorro,
        name: 'Ahorro general',
        purpose: 'Viejo',
        targetAmountCents: null,
        priority: 1,
        segment: 'SAVINGS',
      });
      await tx.insertFund({
        id: IDS.funds.ahorros2,
        accountId: IDS.accounts.ahorro,
        name: 'Ahorros 2',
        purpose: 'Cobertura',
        targetAmountCents: 80000,
        priority: 2,
        segment: 'SAVINGS',
      });
      await postAjuste(tx, {
        accountId: IDS.accounts.ahorro,
        amountCents: 165000,
        note: 'apertura combinada',
      });
      await postReserva(tx, { fundId: IDS.funds.ahorroGeneral, amountCents: 85000 });
      await postReserva(tx, { fundId: IDS.funds.ahorros2, amountCents: 80000 });
      await tx.setMeta('seeded', '1');
    });

    await seedDemoIfRestoreMissing(ledger);
    await ledger.withTransaction(async (tx) => {
      expect((await tx.getAccount(IDS.accounts.ahorro))?.name).toBe('Ahorros');
      expect((await tx.getAccount(IDS.accounts.ahorros2))?.name).toBe('Ahorros 2');
      expect((await tx.getFund(IDS.funds.ahorros2))?.accountId).toBe(IDS.accounts.ahorros2);
      expect((await tx.getFund(IDS.funds.ahorroGeneral))?.accountId).toBe(IDS.accounts.ahorro);
      expect(accountBalanceFromSplits(IDS.accounts.ahorro, await tx.listPostedSplitsForAccount(IDS.accounts.ahorro))).toBe(85000);
      expect(accountBalanceFromSplits(IDS.accounts.ahorros2, await tx.listPostedSplitsForAccount(IDS.accounts.ahorros2))).toBe(80000);
      const txs = await tx.listTransactions();
      expect(txs.some((row) => row.type === 'AJUSTE' && row.note === 'apertura combinada' && row.status === 'POSTED')).toBe(true);
      expect(txs.some((row) => row.type === 'TRANSFERENCIA' && row.status === 'POSTED')).toBe(true);
      expect(txs.filter((row) => row.status === 'POSTED').every((row) => row.type !== 'GASTO' || row.note !== 'apertura combinada')).toBe(true);
      expect((await tx.listAccounts()).filter((row) => /ahorro/i.test(row.name))).toHaveLength(2);
      const splits = await tx.listSplits();
      expect(splits.reduce((sum, row) => sum + row.amountCents, 0)).toBe(0);
    });
  });
});
