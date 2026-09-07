import { DomainError } from './ledger';
import { assertCents, type Cents } from './money';
import type { CreditCard } from './types';

/** Línea ONE compartida, en centavos. No es 2700+100. */
export const ONE_CREDIT_LINE_CENTS = 270_000;
/** Tope propio de la segunda tarjeta, en centavos. */
export const ONE_CARD_CAP_100_CENTS = 10_000;
export const ONE_CREDIT_LINE_ID = 'line-one-atlantida';

export function lineAvailableCents(lineLimitCents: Cents, lineSpentCents: Cents): Cents {
  assertCents(lineLimitCents, 'Límite de línea');
  assertCents(lineSpentCents, 'Gastado de línea');
  const left = lineLimitCents - lineSpentCents;
  return left > 0 ? left : 0;
}

/**
 * Disponible de una tarjeta sobre una línea compartida.
 * Base (sin tope propio menor): `max(0, linea − gastadoTotal)`.
 * Tarjeta con tope: `max(0, min(tope − gastadoEnTarjeta, linea − gastadoTotal))`.
 */
export function cardAvailableOnLineCents(input: {
  cardCapCents: Cents | null;
  cardOwedCents: Cents;
  lineLimitCents: Cents;
  lineSpentCents: Cents;
}): Cents {
  assertCents(input.cardOwedCents, 'Debe de tarjeta');
  const lineLeft = lineAvailableCents(input.lineLimitCents, input.lineSpentCents);
  if (input.cardCapCents == null) return lineLeft;
  assertCents(input.cardCapCents, 'Tope de tarjeta');
  const cardLeft = input.cardCapCents - input.cardOwedCents;
  const capped = cardLeft > 0 ? cardLeft : 0;
  return capped < lineLeft ? capped : lineLeft;
}

export function normalizeCreditCard(card: CreditCard): CreditCard {
  return {
    ...card,
    creditLineId: card.creditLineId ?? null,
    creditLineLimitCents: card.creditLineLimitCents ?? null,
  };
}

export function cardOwnCapCents(card: CreditCard): Cents | null {
  return card.creditLimitCents ?? null;
}

export function cardDisponibleCents(
  card: CreditCard,
  all: CreditCard[],
  owedByCardId: Map<string, Cents>,
): Cents | null {
  const owed = owedByCardId.get(card.id) ?? 0;
  const lineLimit = card.creditLineLimitCents ?? null;
  if (lineLimit != null) {
    const spent = lineSpentFromOwed(cardsOnSameLine(card, all), owedByCardId);
    return cardAvailableOnLineCents({
      cardCapCents: card.creditLimitCents ?? null,
      cardOwedCents: owed,
      lineLimitCents: lineLimit,
      lineSpentCents: spent,
    });
  }
  if (card.creditLimitCents == null) return null;
  const left = card.creditLimitCents - owed;
  return left > 0 ? left : 0;
}

export function cardsOnSameLine(card: CreditCard, all: CreditCard[]): CreditCard[] {
  const lineId = card.creditLineId ?? null;
  if (!lineId) return [card];
  return all.filter((row) => (row.creditLineId ?? null) === lineId);
}

export function lineSpentFromOwed(cards: CreditCard[], owedByCardId: Map<string, Cents>): Cents {
  let total = 0;
  for (const card of cards) {
    const owed = owedByCardId.get(card.id) ?? 0;
    assertCents(owed, 'Debe');
    total += owed;
  }
  return total;
}

export function assertChargeFitsCardAndLine(input: {
  amountCents: Cents;
  cardOwedCents: Cents;
  cardCapCents: Cents | null;
  lineLimitCents: Cents | null;
  lineSpentCents: Cents;
}): void {
  assertCents(input.amountCents);
  assertCents(input.cardOwedCents);
  assertCents(input.lineSpentCents);
  if (input.amountCents <= 0) {
    throw new DomainError('El cargo debe ser mayor que cero');
  }
  if (input.cardCapCents != null && input.cardOwedCents + input.amountCents > input.cardCapCents) {
    throw new DomainError('El cargo supera el tope de esta tarjeta');
  }
  if (input.lineLimitCents != null && input.lineSpentCents + input.amountCents > input.lineLimitCents) {
    throw new DomainError('El cargo supera la línea de crédito');
  }
}
