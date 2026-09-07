import { describe, expect, it } from 'vitest';
import { completeBudgetShares } from './budget';
import { buildFundSetAnalytics, oneCardSpendTotals } from './spendAnalytics';
import type { BudgetItem, CardCharge, CreditCard, SplitRow, TransactionRow } from './types';

function item(
  partial: Partial<BudgetItem> & Pick<BudgetItem, 'id' | 'budgetScope' | 'name' | 'frequency' | 'amountCents'>,
): BudgetItem {
  return completeBudgetShares({
    category: partial.category ?? partial.name,
    fortnight: partial.frequency === 'QUINCENAL' ? 'BOTH' : 'NONE',
    coverFundId: null,
    usualMedium: 'CASH',
    active: true,
    ...partial,
  });
}

function tx(id: string, occurredAt: string): TransactionRow {
  return {
    id,
    type: 'GASTO',
    occurredAt,
    period: null,
    note: '',
    createdAt: occurredAt,
    status: 'POSTED',
    reversesId: null,
  };
}

describe('KPIs de fondos y ONE', () => {
  it('marca un fondo que excede lo presupuestado y el conjunto que se gasta de más', () => {
    const items = [
      item({
        id: 'bi-super',
        budgetScope: 'HOME',
        name: 'Super',
        frequency: 'QUINCENAL',
        amountCents: 5000,
        zShareCents: 3000,
        aShareCents: 2000,
        coverFundId: 'super',
      }),
    ];
    const transactions = [tx('g1', '2026-08-10T12:00:00.000Z')];
    const splitsByTx = new Map<string, SplitRow[]>([
      [
        'g1',
        [
          {
            id: 's1',
            transactionId: 'g1',
            accountId: 'barras',
            fundId: 'super',
            personId: null,
            cardId: null,
            amountCents: -12000,
            role: 'SOURCE',
          },
          {
            id: 's2',
            transactionId: 'g1',
            accountId: null,
            fundId: null,
            personId: null,
            cardId: null,
            amountCents: 12000,
            role: 'EQUITY',
          },
        ],
      ],
    ]);
    const report = buildFundSetAnalytics({
      items,
      funds: [{ id: 'super', name: 'Super' }],
      transactions,
      splitsByTx,
      now: new Date('2026-08-20T12:00:00.000Z'),
    });
    expect(report.totalSpentCents).toBe(12000);
    expect(report.funds[0]?.overBudget).toBe(true);
    expect(report.fundSetBudgetedCents).toBe(10000);
    expect(report.fundSetSpentCents).toBe(12000);
    expect(report.fundSetVarianceCents).toBe(-2000);
    expect(report.personZ.quincenalCents).toBe(3000);
    expect(report.personA.quincenalCents).toBe(2000);
  });

  it('suma gastos por tarjeta ONE y el total de la línea; un pago no cuenta', () => {
    const cards: CreditCard[] = [
      {
        id: 'card-one',
        name: 'ONE',
        paymentAccountId: 'atlantida',
        coverFundId: null,
        creditLimitCents: 10000,
        personId: null,
      },
      {
        id: 'card-one-100',
        name: 'ONE $100',
        paymentAccountId: 'atlantida',
        coverFundId: null,
        creditLimitCents: 10000,
        personId: null,
      },
    ];
    const transactions: TransactionRow[] = [
      tx('g1', '2026-08-05T12:00:00.000Z'),
      tx('g2', '2026-08-08T12:00:00.000Z'),
      {
        id: 'pay',
        type: 'PAGO_DEUDA',
        occurredAt: '2026-08-20T12:00:00.000Z',
        period: null,
        note: '',
        createdAt: '2026-08-20T12:00:00.000Z',
        status: 'POSTED',
        reversesId: null,
      },
    ];
    const charges: CardCharge[] = [
      {
        id: 'c1',
        cardId: 'card-one',
        transactionId: 'g1',
        amountCents: 4000,
        chargeClass: 'SHARED_BUDGETED',
        coverageStatus: 'CUBIERTO_PENDIENTE_TRASPASO',
        coverFundId: 'super',
      },
      {
        id: 'c2',
        cardId: 'card-one-100',
        transactionId: 'g2',
        amountCents: 2500,
        chargeClass: 'SHARED_UNBUDGETED',
        coverageStatus: 'SIN_COBERTURA',
        coverFundId: null,
      },
    ];
    const report = oneCardSpendTotals(cards, charges, transactions, { year: 2026, month: 7 });
    expect(report.cards.find((row) => row.cardId === 'card-one')?.spentCents).toBe(4000);
    expect(report.cards.find((row) => row.cardId === 'card-one-100')?.spentCents).toBe(2500);
    expect(report.lineTotalCents).toBe(6500);
  });
});
