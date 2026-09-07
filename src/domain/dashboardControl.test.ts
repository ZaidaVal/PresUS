import { describe, expect, it } from 'vitest';
import { completeBudgetShares } from './budget';
import {
  homeZaBudgetedCents,
  monthSpendCompare,
  pendingReservaByMonth,
} from './dashboardControl';
import type { BudgetItem, CardCharge, TransactionRow } from './types';

describe('dashboardControl', () => {
  it('compara gasto del mes con el anterior', () => {
    const items: BudgetItem[] = [];
    const funds: Array<{ id: string; name: string }> = [];
    const transactions: TransactionRow[] = [];
    const splitsByTx = new Map<string, never[]>();
    const compare = monthSpendCompare({ items, funds, transactions, splitsByTx, now: new Date('2026-08-15T12:00:00Z') });
    expect(compare.current.totalSpentCents).toBe(0);
    expect(compare.previous.totalSpentCents).toBe(0);
    expect(compare.spentDeltaCents).toBe(0);
  });

  it('suma presupuesto HOME Z/A', () => {
    const items = [
      completeBudgetShares({
        id: 'b1',
        budgetScope: 'HOME',
        name: 'Super',
        category: 'casa',
        frequency: 'MENSUAL',
        amountCents: 10000,
        zShareCents: 6000,
        aShareCents: 4000,
        fortnight: 'BOTH',
        coverFundId: null,
        usualMedium: 'CASH',
        active: true,
      }),
    ];
    expect(homeZaBudgetedCents(items)).toEqual({ zCents: 6000, aCents: 4000 });
  });

  it('agrupa cargos ONE pendientes por mes', () => {
    const transactions: TransactionRow[] = [
      {
        id: 'tx-1',
        type: 'GASTO',
        occurredAt: '2026-08-10T12:00:00Z',
        period: null,
        note: '',
        createdAt: '2026-08-10T12:00:00Z',
        status: 'POSTED',
        reversesId: null,
      },
    ];
    const charges: CardCharge[] = [
      {
        id: 'ch-1',
        transactionId: 'tx-1',
        cardId: 'card-one',
        amountCents: 2500,
        chargeClass: 'SHARED_BUDGETED',
        coverageStatus: 'CUBIERTO_PENDIENTE_TRASPASO',
        coverFundId: 'fund-1',
      },
    ];
    const points = pendingReservaByMonth(transactions, charges, new Date('2026-08-15T12:00:00Z'), 4);
    const august = points.find((point) => point.yearMonth.month === 7 && point.yearMonth.year === 2026);
    expect(august?.pendingCents).toBe(2500);
  });
});
