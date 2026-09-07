import { describe, expect, it } from 'vitest';
import { saveFund, saveGoalFund } from './catalog';
import {
  daysUntilFundDue,
  dueDateInUtcMonth,
  isFundDuePriority,
  lastUtcDayOfMonth,
  nextFundDueDate,
  priorityFundsDueSoon,
} from './fundDue';
import { MemoryLedger } from './memoryLedger';
import type { Fund } from './types';

function fund(partial: Partial<Fund> & Pick<Fund, 'id' | 'name'>): Fund {
  return {
    accountId: 'barras',
    purpose: '',
    targetAmountCents: null,
    priority: null,
    segment: 'OPERATING',
    dueAnchor: null,
    ...partial,
  };
}

describe('fecha de pago del fondo', () => {
  it('fin de mes usa 28, 30 o 31 según el mes', () => {
    expect(lastUtcDayOfMonth(2026, 1)).toBe(28);
    expect(lastUtcDayOfMonth(2024, 1)).toBe(29);
    expect(lastUtcDayOfMonth(2026, 3)).toBe(30);
    expect(lastUtcDayOfMonth(2026, 7)).toBe(31);
    expect(dueDateInUtcMonth('MONTH_END', 2026, 7).getUTCDate()).toBe(31);
    expect(dueDateInUtcMonth('MONTH_MID', 2026, 7).getUTCDate()).toBe(14);
    expect(dueDateInUtcMonth('MONTH_START', 2026, 7).getUTCDate()).toBe(1);
  });

  it('un fondo operativo a ≤ 3 días no entra en prioridad de Inicio', () => {
    const now = new Date('2026-08-12T12:00:00.000Z');
    expect(daysUntilFundDue('MONTH_MID', now)).toBe(2);
    expect(isFundDuePriority('MONTH_MID', now)).toBe(true);
    const rows = priorityFundsDueSoon(
      [
        {
          fund: fund({ id: 'super', name: 'Super', dueAnchor: 'MONTH_MID', segment: 'OPERATING' }),
          reservedCents: 5000,
        },
        {
          fund: fund({
            id: 'viaje',
            name: 'Viaje Europa',
            purpose: 'Sueño',
            dueAnchor: 'MONTH_MID',
            segment: 'SAVINGS',
            targetAmountCents: 500000,
          }),
          reservedCents: 1000,
        },
      ],
      now,
    );
    expect(rows.map((row) => row.fund.id)).toEqual(['viaje']);
    expect(rows[0]?.daysUntil).toBe(2);
  });

  it('a 3 días o menos es prioridad en Inicio; a 4 no', () => {
    const now = new Date('2026-08-11T15:00:00.000Z');
    expect(daysUntilFundDue('MONTH_MID', now)).toBe(3);
    expect(isFundDuePriority('MONTH_MID', now)).toBe(true);
    expect(isFundDuePriority('MONTH_MID', new Date('2026-08-10T12:00:00.000Z'))).toBe(false);
    expect(isFundDuePriority(null, now)).toBe(false);
    expect(isFundDuePriority(undefined, now)).toBe(false);
  });

  it('fin de mes a ≤ 3 días prioriza ahorro; un operativo no', () => {
    const now = new Date('2026-08-28T12:00:00.000Z');
    expect(daysUntilFundDue('MONTH_END', now)).toBe(3);
    expect(isFundDuePriority('MONTH_END', now)).toBe(true);
    const rows = priorityFundsDueSoon(
      [
        { fund: fund({ id: 'super', name: 'Super', dueAnchor: 'MONTH_END' }), reservedCents: 5000 },
        { fund: fund({ id: 'casa', name: 'Casa', dueAnchor: null }), reservedCents: 8000 },
        {
          fund: fund({
            id: 'viaje',
            name: 'Viaje',
            purpose: 'Sueño',
            dueAnchor: 'MONTH_END',
            segment: 'SAVINGS',
            targetAmountCents: 500000,
          }),
          reservedCents: 2000,
        },
        { fund: fund({ id: 'luz', name: 'Luz', dueAnchor: 'MONTH_START' }), reservedCents: 2000 },
      ],
      now,
    );
    expect(rows.map((row) => row.fund.id)).toEqual(['viaje']);
    expect(rows[0]?.daysUntil).toBe(3);
  });

  it('si el ancla de este mes ya pasó, usa el mes inmediato', () => {
    const now = new Date('2026-08-30T12:00:00.000Z');
    const next = nextFundDueDate('MONTH_START', now);
    expect(next?.toISOString().slice(0, 10)).toBe('2026-09-01');
    expect(daysUntilFundDue('MONTH_START', now)).toBe(2);
    expect(isFundDuePriority('MONTH_START', now)).toBe(true);
    expect(isFundDuePriority('MONTH_START', new Date('2026-08-28T12:00:00.000Z'))).toBe(false);
  });

  it('persiste el ancla en el fondo sin tocar centavos', async () => {
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
      await tx.insertFund({
        id: 'super',
        accountId: 'barras',
        name: 'Super',
        purpose: 'Despensa',
        targetAmountCents: 13000,
        priority: 1,
        segment: 'OPERATING',
      });
      const saved = await saveFund(
        tx,
        {
          id: 'super',
          accountId: 'barras',
          name: 'Super',
          purpose: 'Despensa',
          targetAmountCents: 13000,
          priority: 1,
          segment: 'OPERATING',
          dueAnchor: 'MONTH_MID',
        },
        false,
      );
      expect(saved.dueAnchor).toBe('MONTH_MID');
      expect(saved.targetAmountCents).toBeNull();
      expect((await tx.getFund('super'))?.dueAnchor).toBe('MONTH_MID');
    });
  });

  it('un sueño puede tener meta; un operativo no la conserva al guardar', async () => {
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
        name: 'Ahorros',
        kind: 'BANK',
        visibility: 'PUBLIC',
        ownerPersonId: null,
        countsAsLiquidity: true,
        isCardPaymentSource: false,
      });
      const dream = await saveGoalFund(
        tx,
        {
          kind: 'SUEÑO',
          name: 'Viaje Europa',
          accountId: 'ahorro',
          targetAmountCents: 500000,
          priority: 1,
        },
        true,
      );
      expect(dream.segment).toBe('SAVINGS');
      expect(dream.targetAmountCents).toBe(500000);
      const operating = await saveFund(
        tx,
        {
          id: 'luz',
          accountId: 'barras',
          name: 'Luz',
          purpose: 'Energía',
          targetAmountCents: 25000,
          priority: null,
          segment: 'OPERATING',
        },
        true,
      );
      expect(operating.targetAmountCents).toBeNull();
    });
  });
});
