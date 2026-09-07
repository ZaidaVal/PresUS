import { DomainError } from './ledger';
import { assertCents, type Cents } from './money';
import { assertBps, periodInterestCents, type Bps } from './rates';
import { isAtlantidaAccount, isSavingsAccount } from './segments';
import type { Account, InterestKind } from './types';
import { projectSavingsInterest } from './savingsInterest';

export const SAVINGS_PROJECTION_META_KEY = 'savings_projections';

export type SavingsAccountProjection = {
  enabled: boolean;
  monthlyContributionCents: Cents;
  annualRateBps: Bps;
  kind: InterestKind;
  months: number;
};

export type SavingsProjectionsState = {
  byAccountId: Record<string, SavingsAccountProjection>;
};

const KINDS = new Set<InterestKind>([
  'NONE',
  'SIMPLE',
  'COMPOUND_MONTHLY',
  'COMPOUND_FORTNIGHTLY',
  'COMPOUND_ANNUAL',
]);

export function defaultSavingsProjection(): SavingsAccountProjection {
  return {
    enabled: false,
    monthlyContributionCents: 0,
    annualRateBps: 0,
    kind: 'NONE',
    months: 12,
  };
}

export function parseSavingsProjections(raw: string | undefined | null): SavingsProjectionsState {
  if (!raw) return { byAccountId: {} };
  try {
    const parsed = JSON.parse(raw) as Partial<SavingsProjectionsState>;
    if (!parsed || typeof parsed !== 'object' || !parsed.byAccountId) return { byAccountId: {} };
    const byAccountId: Record<string, SavingsAccountProjection> = {};
    for (const [id, row] of Object.entries(parsed.byAccountId)) {
      if (!id || !row || typeof row !== 'object') continue;
      const months = Number.isInteger(row.months) && row.months >= 0 ? row.months : 12;
      const kind = KINDS.has(row.kind as InterestKind) ? (row.kind as InterestKind) : 'NONE';
      const monthlyContributionCents =
        typeof row.monthlyContributionCents === 'number' && Number.isInteger(row.monthlyContributionCents)
          ? Math.max(0, row.monthlyContributionCents)
          : 0;
      const annualRateBps =
        typeof row.annualRateBps === 'number' && Number.isInteger(row.annualRateBps)
          ? Math.max(0, row.annualRateBps)
          : 0;
      byAccountId[id] = {
        enabled: Boolean(row.enabled),
        monthlyContributionCents,
        annualRateBps,
        kind,
        months,
      };
    }
    return { byAccountId };
  } catch {
    return { byAccountId: {} };
  }
}

export function serializeSavingsProjections(state: SavingsProjectionsState): string {
  return JSON.stringify(state);
}

export function assertProjectableSavingsAccount(account: Pick<Account, 'id' | 'name' | 'isCardPaymentSource'>): void {
  if (isAtlantidaAccount(account)) {
    throw new DomainError('Atlántida no se proyecta como ahorro');
  }
  if (!isSavingsAccount(account)) {
    throw new DomainError('Solo se proyectan cuentas de ahorro que elijas');
  }
}

export function projectableSavingsAccounts<T extends Pick<Account, 'id' | 'name' | 'isCardPaymentSource' | 'visibility'>>(
  accounts: T[],
): T[] {
  return accounts.filter(
    (account) => account.visibility === 'PUBLIC' && isSavingsAccount(account) && !isAtlantidaAccount(account),
  );
}

export type SavingsProjectionResult = {
  endingCents: Cents;
  interestCents: Cents;
  contributionsCents: Cents;
};

/**
 * Cada mes: aporte y luego interés del período (centavos enteros).
 * No suma fondos encima del saldo de la cuenta.
 */
export function projectSavingsBalance(input: {
  principalCents: Cents;
  monthlyContributionCents: Cents;
  annualRateBps: Bps;
  kind: InterestKind;
  months: number;
}): SavingsProjectionResult {
  assertCents(input.principalCents, 'saldo');
  assertCents(input.monthlyContributionCents, 'aporte');
  if (input.monthlyContributionCents < 0) {
    throw new DomainError('El aporte no puede ser negativo');
  }
  assertBps(input.annualRateBps);
  if (!Number.isInteger(input.months) || input.months < 0) {
    throw new DomainError('Los meses de proyección deben ser un entero ≥ 0');
  }
  let balance = input.principalCents;
  let interestCents = 0;
  const contributionsCents = input.monthlyContributionCents * input.months;
  for (let i = 0; i < input.months; i += 1) {
    balance += input.monthlyContributionCents;
    const gained = projectSavingsInterest({
      principalCents: balance,
      annualRateBps: input.annualRateBps,
      kind: input.kind,
      months: 1,
    });
    if (input.kind === 'COMPOUND_ANNUAL') {
      const monthOfYear = (i + 1) % 12;
      const yearInterest =
        monthOfYear === 0 ? periodInterestCents(balance, input.annualRateBps, 1) : 0;
      balance += yearInterest;
      interestCents += yearInterest;
    } else {
      balance += gained;
      interestCents += gained;
    }
  }
  return { endingCents: balance, interestCents, contributionsCents };
}
