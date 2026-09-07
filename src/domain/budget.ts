import { frequencyExceedsExpenseHorizon } from './horizon';
import { DomainError } from './ledger';
import { assertCents, type Cents } from './money';
import type {
  BudgetItem,
  BudgetItemDraft,
  BudgetScope,
  Fortnight,
  Frequency,
  Period,
  PeriodRef,
  PersonCode,
} from './types';

const Z_ONLY_NAME = /maestr[ií]a|chatgpt|chat\s*gpt|\bgpt\b|spotify|internet celular/;
const A_ONLY_NAME = /personal a|fondo personal/;

function nameHasPersonToken(name: string, person: PersonCode): boolean {
  const token = person.toLowerCase();
  const normalized = name.trim().toLowerCase();
  return new RegExp(`(?:^|[\\s\\-_/])${token}(?:$|[\\s\\-_/])`).test(normalized);
}

export function looksLikePersonBudgetName(name: string, person: PersonCode): boolean {
  const normalized = name.trim().toLowerCase();
  if (!normalized) return false;
  if (nameHasPersonToken(normalized, person)) return true;
  if (person === 'Z') return Z_ONLY_NAME.test(normalized);
  return A_ONLY_NAME.test(normalized);
}

/** 50/50 en HOME; el centavo impar va a Z. Nombres claramente de Z o A no se parten. */
export function defaultBudgetShares(
  scope: BudgetScope,
  amountCents: Cents,
  name: string,
): { zShareCents: Cents; aShareCents: Cents } {
  assertCents(amountCents, 'El monto de la partida');
  if (amountCents < 0) {
    throw new DomainError('El monto de la partida no puede ser negativo');
  }
  if (scope === 'Z') return { zShareCents: amountCents, aShareCents: 0 };
  if (scope === 'A') return { zShareCents: 0, aShareCents: amountCents };
  if (looksLikePersonBudgetName(name, 'Z') && !looksLikePersonBudgetName(name, 'A')) {
    return { zShareCents: amountCents, aShareCents: 0 };
  }
  if (looksLikePersonBudgetName(name, 'A') && !looksLikePersonBudgetName(name, 'Z')) {
    return { zShareCents: 0, aShareCents: amountCents };
  }
  const aShareCents = Math.trunc(amountCents / 2);
  return { zShareCents: amountCents - aShareCents, aShareCents };
}

export function sharesAreComplete(row: Pick<BudgetItemDraft, 'zShareCents' | 'aShareCents' | 'amountCents'>): boolean {
  return (
    Number.isInteger(row.zShareCents) &&
    Number.isInteger(row.aShareCents) &&
    (row.zShareCents as Cents) + (row.aShareCents as Cents) === row.amountCents
  );
}

export function completeBudgetShares(row: BudgetItemDraft): BudgetItem {
  if (sharesAreComplete(row)) {
    return {
      ...row,
      zShareCents: row.zShareCents as Cents,
      aShareCents: row.aShareCents as Cents,
    };
  }
  return { ...row, ...defaultBudgetShares(row.budgetScope, row.amountCents, row.name) };
}

export function assertBudgetShares(row: BudgetItemDraft): BudgetItem {
  const hasZ = row.zShareCents != null;
  const hasA = row.aShareCents != null;
  if (hasZ !== hasA) {
    throw new DomainError('Indica cuánto pone Z y cuánto pone A');
  }
  const filled =
    !hasZ && !hasA ? { ...row, ...defaultBudgetShares(row.budgetScope, row.amountCents, row.name) } : row;
  assertCents(filled.zShareCents as Cents, 'La parte de Z');
  assertCents(filled.aShareCents as Cents, 'La parte de A');
  const zShareCents = filled.zShareCents as Cents;
  const aShareCents = filled.aShareCents as Cents;
  if (zShareCents < 0 || aShareCents < 0) {
    throw new DomainError('La parte de Z o de A no puede ser negativa');
  }
  if (row.budgetScope === 'Z') {
    if (zShareCents !== row.amountCents || aShareCents !== 0) {
      throw new DomainError('Si la partida es solo de Z, Z pone el total y A pone 0');
    }
  } else if (row.budgetScope === 'A') {
    if (aShareCents !== row.amountCents || zShareCents !== 0) {
      throw new DomainError('Si la partida es solo de A, A pone el total y Z pone 0');
    }
  } else if (zShareCents + aShareCents !== row.amountCents) {
    throw new DomainError('La parte de Z más la de A debe ser el monto de la partida');
  }
  return { ...row, zShareCents, aShareCents };
}

export function personShareCents(item: Pick<BudgetItem, 'zShareCents' | 'aShareCents'>, person: PersonCode): Cents {
  return person === 'Z' ? item.zShareCents : item.aShareCents;
}

export function personMonthlyEquivalentCents(item: BudgetItem, person: PersonCode): Cents {
  return monthlyEquivalentCents(item.frequency, personShareCents(item, person), item.active);
}

export function monthlyEquivalentCents(
  frequency: Frequency,
  amountCents: Cents,
  active: boolean,
): Cents {
  if (!active) return 0;
  switch (frequency) {
    case 'QUINCENAL':
      return amountCents * 2;
    case 'MENSUAL':
      return amountCents;
    case 'BIMESTRAL':
      return Math.trunc(amountCents / 2);
    case 'TRIMESTRAL':
      return Math.trunc(amountCents / 3);
    case 'ANUAL':
      return Math.trunc(amountCents / 12);
    case 'UNICO':
      return 0;
  }
}

export function currentPeriod(now = new Date()): Period {
  return now.getUTCDate() <= 15 ? 'Q1' : 'Q2';
}

export function utcPeriodRef(now = new Date()): PeriodRef {
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth(),
    period: currentPeriod(now),
  };
}

export function periodRefKey(ref: PeriodRef): string {
  const mm = String(ref.month + 1).padStart(2, '0');
  return `${ref.year}-${mm}:${ref.period}`;
}

export function cutoffLabel(period: Period): string {
  return period === 'Q1' ? 'Corte del 14' : 'Corte del 29';
}

export function parsePeriodRefKey(key: string): PeriodRef | null {
  const match = /^(\d{4})-(\d{2}):(Q1|Q2)$/.exec(key);
  if (!match) return null;
  const month = Number(match[2]) - 1;
  if (month < 0 || month > 11) return null;
  return { year: Number(match[1]), month, period: match[3] as Period };
}

export function itemObligationInPeriod(item: BudgetItem, period: Period): Cents {
  if (!item.active) return 0;
  if (frequencyExceedsExpenseHorizon(item.frequency)) return 0;
  if (item.frequency === 'UNICO') return 0;
  if (item.fortnight === 'Q1' && period !== 'Q1') return 0;
  if (item.fortnight === 'Q2' && period !== 'Q2') return 0;
  if (item.frequency === 'QUINCENAL') return item.amountCents;
  if (item.frequency === 'MENSUAL') {
    if (item.fortnight === 'BOTH') return item.amountCents;
    return item.amountCents;
  }
  return monthlyEquivalentCents(item.frequency, item.amountCents, true);
}

export function fortnightLabel(fortnight: Fortnight): string {
  switch (fortnight) {
    case 'Q1':
      return 'Quincena 1 (≈14)';
    case 'Q2':
      return 'Quincena 2 (≈29)';
    case 'BOTH':
      return 'Ambas quincenas';
    case 'NONE':
      return 'Sin quincena';
  }
}
