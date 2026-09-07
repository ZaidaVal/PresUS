import { describe, expect, it } from 'vitest';
import { MemoryLedger } from './memoryLedger';
import { IDS, seedIfNeeded } from '../database/seed';
import { saveFund, saveGoalFund, removeFund } from './catalog';
import { postAjuste, postReserva } from './posting';
import {
  duplicateGoalIds,
  goalKindOf,
  isCacerolasFund,
  isGoalFund,
  splitGoalFunds,
  uniqueGoalFunds,
} from './projects';
import { partnerIouPendingTotal, partnerIousFromExcel } from './partnerIou';

describe('proyectos y sueños', () => {
  it('separa proyectos y sueños y no trata Cacerolas como meta', () => {
    const funds = [
      { id: 'fund-proy-ac-cuarto', name: 'AC cuarto', purpose: 'Proyecto' },
      { id: 'fund-proy-b', name: 'B', purpose: 'Proyecto' },
      { id: 'fund-sueno-europa', name: 'Viaje', purpose: 'Sueño extra' },
      { id: 'fund-cacerolas', name: 'Cacerolas', purpose: 'Cuota' },
    ];
    const { proyectos, suenos } = splitGoalFunds(funds);
    expect(proyectos).toHaveLength(2);
    expect(suenos).toHaveLength(1);
    expect(goalKindOf({ id: 'fund-proy-x', name: 'X', purpose: 'Sueño extra' })).toBe('SUEÑO');
    expect(duplicateGoalIds([...funds, funds[0]!])).toEqual(['fund-proy-ac-cuarto']);
    expect(uniqueGoalFunds([...funds, funds[0]!])).toHaveLength(3);
    expect(isCacerolasFund({ id: 'fund-cacerolas', name: 'Cacerolas' })).toBe(true);
    expect(isGoalFund({ id: 'fund-cacerolas', name: 'Cacerolas', purpose: 'Cuota' })).toBe(false);
  });

  it('A→Z del detalle no se convierte en Debt', async () => {
    const rows = partnerIousFromExcel([
      { cell: 'AD3', name: 'CASA', amountCents: 1000, sharedTotalCents: null },
    ]);
    expect(partnerIouPendingTotal(rows)).toBe(1000);
    const ledger = new MemoryLedger();
    await seedIfNeeded(ledger);
    await ledger.withTransaction(async (tx) => {
      const debts = await tx.listDebts();
      expect(debts.some((row) => row.name === 'CASA' && row.originalCents === 1000)).toBe(false);
    });
  });

  it('alta un sueño SAVINGS en Ahorros; sin historial se quita; con POSTED no', async () => {
    const ledger = new MemoryLedger();
    await ledger.withTransaction(async (tx) => {
      await tx.insertPerson({ id: 'z', code: 'Z', displayName: 'Z' });
      await tx.insertPerson({ id: 'a', code: 'A', displayName: 'A' });
      await tx.insertAccount({
        id: IDS.accounts.ahorro,
        name: 'Ahorros',
        kind: 'BANK',
        visibility: 'PUBLIC',
        ownerPersonId: null,
        countsAsLiquidity: true,
        isCardPaymentSource: false,
      });
      await tx.insertAccount({
        id: IDS.accounts.barras,
        name: 'Barras',
        kind: 'BANK',
        visibility: 'PUBLIC',
        ownerPersonId: null,
        countsAsLiquidity: true,
        isCardPaymentSource: false,
      });
      await tx.insertAccount({
        id: IDS.accounts.a,
        name: 'Cuenta A',
        kind: 'BANK',
        visibility: 'PRIVATE',
        ownerPersonId: 'a',
        countsAsLiquidity: false,
        isCardPaymentSource: false,
      });
    });

    const saved = await ledger.withTransaction((tx) =>
      saveGoalFund(
        tx,
        {
          kind: 'SUEÑO',
          name: 'Piano',
          accountId: IDS.accounts.ahorro,
          targetAmountCents: 250_00,
          priority: 3,
        },
        true,
      ),
    );
    expect(saved.segment).toBe('SAVINGS');
    expect(saved.accountId).toBe(IDS.accounts.ahorro);
    expect(saved.targetAmountCents).toBe(25000);
    expect(saved.id.startsWith('fund-sueno-')).toBe(true);
    expect(goalKindOf(saved)).toBe('SUEÑO');
    expect(isGoalFund(saved)).toBe(true);

    await ledger.withTransaction(async (tx) => {
      await expect(
        saveGoalFund(
          tx,
          {
            kind: 'PROYECTO',
            name: 'Privado',
            accountId: IDS.accounts.a,
            targetAmountCents: 100_00,
            priority: null,
          },
          true,
        ),
      ).rejects.toThrow(/privada/);
      await expect(
        saveFund(
          tx,
          {
            id: 'fund-proy-operativo',
            accountId: IDS.accounts.barras,
            name: 'Mal puesto',
            purpose: 'Proyecto mal',
            targetAmountCents: 100_00,
            priority: null,
            segment: 'OPERATING',
          },
          true,
        ),
      ).rejects.toThrow(/ahorro|Ahorros|operativ/i);
    });

    await ledger.withTransaction((tx) => removeFund(tx, saved.id));
    await ledger.withTransaction(async (tx) => {
      expect(await tx.getFund(saved.id)).toBeUndefined();
      const posted = await saveGoalFund(
        tx,
        {
          kind: 'PROYECTO',
          name: 'Techo',
          accountId: IDS.accounts.ahorro,
          targetAmountCents: 400_00,
          priority: 1,
        },
        true,
      );
      await postAjuste(tx, { accountId: IDS.accounts.ahorro, amountCents: 400_00 });
      await postReserva(tx, { fundId: posted.id, amountCents: 100_00 });
      await expect(removeFund(tx, posted.id)).rejects.toThrow(/reservas|movimientos/);
      expect(await tx.getFund(posted.id)).toBeDefined();
    });
  });
});
