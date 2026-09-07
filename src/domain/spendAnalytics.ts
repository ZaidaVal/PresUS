import { completeBudgetShares, personMonthlyEquivalentCents } from './budget';
import { assertCents, type Cents } from './money';
import {
  coverFundIdForGasto,
  gastoAmountCents,
  itemMonthlyEquivalentCents,
  postedGastosInMonth,
  utcYearMonthFromDate,
  type MonthlySpendInput,
  type UtcYearMonth,
} from './monthlySpend';
import type { BudgetItem, CardCharge, CreditCard, TransactionRow } from './types';

export type FundSpendRow = {
  fundId: string;
  fundName: string;
  spentCents: Cents;
  budgetedMonthlyCents: Cents;
  varianceCents: Cents;
  overBudget: boolean;
};

export type PersonFundInvestRow = {
  person: 'Z' | 'A';
  quincenalCents: Cents;
  mensualCents: Cents;
  spentCents: Cents;
};

export type FundSetAnalytics = {
  yearMonth: UtcYearMonth;
  totalSpentCents: Cents;
  funds: FundSpendRow[];
  fundSetBudgetedCents: Cents;
  fundSetSpentCents: Cents;
  /** Presupuestado del conjunto − gastado. >0 sobra; <0 se gasta de más. */
  fundSetVarianceCents: Cents;
  personZ: PersonFundInvestRow;
  personA: PersonFundInvestRow;
};

function addCents(left: Cents, right: Cents): Cents {
  assertCents(left);
  assertCents(right);
  return left + right;
}

function emptyPerson(person: 'Z' | 'A'): PersonFundInvestRow {
  return { person, quincenalCents: 0, mensualCents: 0, spentCents: 0 };
}

function personShareOfCoveredFund(items: BudgetItem[], fundId: string | null, person: 'Z' | 'A'): Cents {
  if (!fundId) return 0;
  let sum: Cents = 0;
  for (const item of items) {
    if (item.coverFundId !== fundId) continue;
    sum = addCents(sum, personMonthlyEquivalentCents(item, person));
  }
  return sum;
}

export function buildFundSetAnalytics(input: MonthlySpendInput): FundSetAnalytics {
  const yearMonth = input.yearMonth ?? utcYearMonthFromDate(input.now ?? new Date());
  const cardCharges = input.cardCharges ?? [];
  const items = input.items.map((row) => completeBudgetShares(row));
  const fundIds = new Set(input.funds.map((row) => row.id));
  const spentByFund = new Map<string, Cents>();
  const budgetedByFund = new Map<string, Cents>();
  const personZ = emptyPerson('Z');
  const personA = emptyPerson('A');

  for (const item of items) {
    const monthly = itemMonthlyEquivalentCents(item);
    if (!item.coverFundId || !fundIds.has(item.coverFundId)) continue;
    budgetedByFund.set(item.coverFundId, addCents(budgetedByFund.get(item.coverFundId) ?? 0, monthly));
    if (item.active && item.frequency === 'QUINCENAL') {
      personZ.quincenalCents = addCents(personZ.quincenalCents, item.zShareCents);
      personA.quincenalCents = addCents(personA.quincenalCents, item.aShareCents);
    }
    if (item.active && item.frequency === 'MENSUAL') {
      personZ.mensualCents = addCents(personZ.mensualCents, item.zShareCents);
      personA.mensualCents = addCents(personA.mensualCents, item.aShareCents);
    }
  }

  let totalSpentCents: Cents = 0;
  let fundSetSpentCents: Cents = 0;
  for (const row of postedGastosInMonth(input.transactions, yearMonth)) {
    const splits = input.splitsByTx.get(row.id) ?? [];
    const amount = gastoAmountCents(splits);
    totalSpentCents = addCents(totalSpentCents, amount);
    const fundId = coverFundIdForGasto(row, splits, cardCharges);
    if (fundId && fundIds.has(fundId)) {
      spentByFund.set(fundId, addCents(spentByFund.get(fundId) ?? 0, amount));
      fundSetSpentCents = addCents(fundSetSpentCents, amount);
    }
    const charge = cardCharges.find((item) => item.transactionId === row.id);
    if (charge?.chargeClass === 'PERSONAL_Z') {
      personZ.spentCents = addCents(personZ.spentCents, amount);
      continue;
    }
    if (charge?.chargeClass === 'PERSONAL_A') {
      personA.spentCents = addCents(personA.spentCents, amount);
      continue;
    }
    const zPart = personShareOfCoveredFund(items, fundId, 'Z');
    const aPart = personShareOfCoveredFund(items, fundId, 'A');
    const shareTotal = zPart + aPart;
    if (shareTotal <= 0) continue;
    const zSlice = Math.trunc((amount * zPart) / shareTotal);
    personZ.spentCents = addCents(personZ.spentCents, zSlice);
    personA.spentCents = addCents(personA.spentCents, amount - zSlice);
  }

  const funds: FundSpendRow[] = input.funds
    .map((fund) => {
      const spentCents = spentByFund.get(fund.id) ?? 0;
      const budgetedMonthlyCents = budgetedByFund.get(fund.id) ?? 0;
      const varianceCents = budgetedMonthlyCents - spentCents;
      return {
        fundId: fund.id,
        fundName: fund.name,
        spentCents,
        budgetedMonthlyCents,
        varianceCents,
        overBudget: spentCents > budgetedMonthlyCents && budgetedMonthlyCents > 0,
      };
    })
    .filter((row) => row.spentCents > 0 || row.budgetedMonthlyCents > 0)
    .sort((left, right) => {
      if (left.overBudget !== right.overBudget) return left.overBudget ? -1 : 1;
      const bySpent = right.spentCents - left.spentCents;
      if (bySpent !== 0) return bySpent;
      return left.fundName.localeCompare(right.fundName, 'es');
    });

  const fundSetBudgetedCents = [...budgetedByFund.values()].reduce((sum, cents) => addCents(sum, cents), 0);

  return {
    yearMonth,
    totalSpentCents,
    funds,
    fundSetBudgetedCents,
    fundSetSpentCents,
    fundSetVarianceCents: fundSetBudgetedCents - fundSetSpentCents,
    personZ,
    personA,
  };
}

export type OneCardSpendRow = {
  cardId: string;
  cardName: string;
  spentCents: Cents;
};

export type OneCardSpendReport = {
  cards: OneCardSpendRow[];
  lineTotalCents: Cents;
};

/** Gastos totales por tarjeta ONE (cargos POSTED). Pagar la tarjeta no cuenta. */
export function oneCardSpendTotals(
  cards: CreditCard[],
  charges: CardCharge[],
  transactions: TransactionRow[],
  yearMonth?: UtcYearMonth,
): OneCardSpendReport {
  const txById = new Map(transactions.map((row) => [row.id, row]));
  const spentByCard = new Map<string, Cents>();
  for (const charge of charges) {
    const row = txById.get(charge.transactionId);
    if (!row || row.status !== 'POSTED' || row.type !== 'GASTO') continue;
    if (yearMonth) {
      const occurred = new Date(row.occurredAt);
      if (occurred.getUTCFullYear() !== yearMonth.year || occurred.getUTCMonth() !== yearMonth.month) continue;
    }
    assertCents(charge.amountCents);
    spentByCard.set(charge.cardId, addCents(spentByCard.get(charge.cardId) ?? 0, charge.amountCents));
  }
  const cardRows: OneCardSpendRow[] = cards.map((card) => ({
    cardId: card.id,
    cardName: card.name,
    spentCents: spentByCard.get(card.id) ?? 0,
  }));
  const lineTotalCents = [...spentByCard.values()].reduce((sum, cents) => addCents(sum, cents), 0);
  assertCents(lineTotalCents);
  return { cards: cardRows, lineTotalCents };
}
