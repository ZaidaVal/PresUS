import { describe, expect, it } from 'vitest';
import { MemoryLedger } from '../domain/memoryLedger';
import { EMPTY_BOOK_PENDING_PUSH_KEY, IDS, EXPLICIT_EMPTY_BOOK_META, FACTORY_EMPTY_META, seedIfNeeded } from '../database/seed';
import { applyPresusNuevoBootImports, importPresusNuevoExtrasIfNeeded, importPresusNuevoIfNeeded } from './importPresusNuevo';
import { mapOneChargeCover } from './oneCharges';
import { PRODUCT_NAME } from '../branding';
import { postAjuste } from '../domain/posting';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
}

describe('nombre PresUS', () => {
  it('el producto visible se llama PresUS', () => {
    expect(PRODUCT_NAME).toBe('PresUS');
  });
});

describe('import PresUSNuevo', () => {
  it('sin snapshot no altera el libro', async () => {
    const ledger = new MemoryLedger();
    const storage = memoryStorage({ [EMPTY_BOOK_PENDING_PUSH_KEY]: '1' });
    await seedIfNeeded(ledger);
    await ledger.withTransaction(async (tx) => {
      await tx.setMeta(FACTORY_EMPTY_META, '1');
      await tx.setMeta(EXPLICIT_EMPTY_BOOK_META, '1');
    });

    expect(await importPresusNuevoIfNeeded(ledger, storage)).toBe(false);
    expect(await applyPresusNuevoBootImports(ledger, storage)).toEqual({
      imported: false,
      extras: false,
      expenses: false,
    });
    await ledger.withTransaction(async (tx) => {
      expect(await tx.listAccounts()).toHaveLength(0);
      expect(await tx.listTransactions()).toHaveLength(0);
    });
  });

  it('no pisa un libro con cuentas o POSTED', async () => {
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
    });
    expect(await importPresusNuevoIfNeeded(ledger)).toBe(false);
    await ledger.withTransaction(async (tx) => {
      expect(await tx.getAccount(IDS.accounts.barras)).toBeUndefined();
      expect((await tx.listAccounts()).map((row) => row.id)).toEqual(['acc-propia']);
    });
    expect(await importPresusNuevoExtrasIfNeeded(ledger)).toBe(false);
  });
});

describe('mapeo ONE', () => {
  it('clasifica cobertura por nota y comentario', () => {
    expect(mapOneChargeCover({ source: 'A', note: 'x', amountCents: 100, comment: null }).chargeClass).toBe(
      'PERSONAL_A',
    );
    expect(mapOneChargeCover({ source: 'GENERAL', note: 'despensa', amountCents: 272, comment: null }).coverFundId).toBe(
      IDS.funds.super,
    );
    expect(mapOneChargeCover({ source: 'GENERAL', note: 'cena', amountCents: 525, comment: null }).barrasLeftover).toBe(
      true,
    );
  });
});
