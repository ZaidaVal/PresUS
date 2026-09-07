import { DomainError } from './ledger';
import { assertCents, type Cents } from './money';
import { assertBps, periodInterestCents, type Bps } from './rates';
import type { InterestKind } from './types';

export function projectSavingsInterest(input: {
  principalCents: Cents;
  annualRateBps: Bps;
  kind: InterestKind;
  months: number;
}): Cents {
  assertCents(input.principalCents, 'capital');
  assertBps(input.annualRateBps);
  if (!Number.isInteger(input.months) || input.months < 0) {
    throw new DomainError('Los meses de proyección deben ser un entero ≥ 0');
  }
  if (input.kind === 'NONE' || input.principalCents === 0 || input.annualRateBps === 0 || input.months === 0) {
    return 0;
  }
  if (input.kind === 'SIMPLE') {
    return periodInterestCents(input.principalCents, input.annualRateBps, 12) * input.months;
  }
  let balance = input.principalCents;
  if (input.kind === 'COMPOUND_MONTHLY') {
    for (let i = 0; i < input.months; i += 1) {
      balance += periodInterestCents(balance, input.annualRateBps, 12);
    }
  } else if (input.kind === 'COMPOUND_FORTNIGHTLY') {
    for (let i = 0; i < input.months * 2; i += 1) {
      balance += periodInterestCents(balance, input.annualRateBps, 24);
    }
  } else {
    const years = Math.trunc(input.months / 12);
    const leftover = input.months % 12;
    for (let i = 0; i < years; i += 1) {
      balance += periodInterestCents(balance, input.annualRateBps, 1);
    }
    balance += periodInterestCents(balance, input.annualRateBps, 12) * leftover;
  }
  return balance - input.principalCents;
}

export function nextAccrualCents(input: {
  principalCents: Cents;
  annualRateBps: Bps;
  kind: InterestKind;
}): Cents {
  if (input.kind === 'NONE') return 0;
  const months = input.kind === 'COMPOUND_ANNUAL' ? 12 : 1;
  return projectSavingsInterest({ ...input, months });
}
