import { DomainError } from './ledger';
import type { Cents } from './money';
import { isSavingsAccount } from './segments';
import type { Account, Fund, FundBalance } from './types';

export type GoalKind = 'PROYECTO' | 'SUEÑO';

export function goalKindLabel(kind: GoalKind): string {
  return kind === 'SUEÑO' ? 'Sueño' : 'Proyecto';
}

export function goalPurposeOf(kind: GoalKind, rest = ''): string {
  const extra = rest.replace(/^(proyecto|sueño|sueno)\b\s*/i, '').trim();
  const label = goalKindLabel(kind);
  return extra ? `${label} ${extra}` : label;
}

export function newGoalFundId(kind: GoalKind, entropy = crypto.randomUUID()): string {
  return `${kind === 'SUEÑO' ? 'fund-sueno-' : 'fund-proy-'}${entropy}`;
}

export function goalKindOf(fund: Pick<Fund, 'id' | 'purpose' | 'name'>): GoalKind | null {
  if (/^sueño\b/i.test(fund.purpose) || /^sueno\b/i.test(fund.purpose)) return 'SUEÑO';
  if (/^proyecto\b/i.test(fund.purpose)) return 'PROYECTO';
  if (fund.id.startsWith('fund-sueno-')) return 'SUEÑO';
  if (fund.id.startsWith('fund-proy-')) return 'PROYECTO';
  return null;
}

export function assertGoalPlacement(account: Pick<Account, 'visibility' | 'id' | 'name'>): void {
  if (account.visibility === 'PRIVATE') {
    throw new DomainError('Una meta no va en una cuenta privada');
  }
  if (!isSavingsAccount(account)) {
    throw new DomainError('Proyectos y sueños van en Ahorros, no en fondos operativos');
  }
}

export function isGoalFund(fund: Pick<Fund, 'id' | 'purpose' | 'name'>): boolean {
  return goalKindOf(fund) != null;
}

export function isCacerolasFund(fund: Pick<Fund, 'id' | 'name'>): boolean {
  return fund.id === 'fund-cacerolas' || /^cacerolas$/i.test(fund.name.trim());
}

export function uniqueGoalFunds<T extends Pick<Fund, 'id' | 'purpose' | 'name'>>(funds: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const fund of funds) {
    if (!isGoalFund(fund) || isCacerolasFund(fund)) continue;
    if (seen.has(fund.id)) continue;
    seen.add(fund.id);
    out.push(fund);
  }
  return out;
}

export function duplicateGoalIds(funds: Array<Pick<Fund, 'id' | 'purpose' | 'name'>>): string[] {
  const seen = new Set<string>();
  const dup: string[] = [];
  for (const fund of funds) {
    if (!isGoalFund(fund)) continue;
    if (seen.has(fund.id)) dup.push(fund.id);
    else seen.add(fund.id);
  }
  return dup;
}

export function splitGoalFunds<T extends Pick<Fund, 'id' | 'purpose' | 'name'>>(funds: T[]): {
  proyectos: T[];
  suenos: T[];
} {
  const unique = uniqueGoalFunds(funds);
  return {
    proyectos: unique.filter((row) => goalKindOf(row) === 'PROYECTO'),
    suenos: unique.filter((row) => goalKindOf(row) === 'SUEÑO'),
  };
}

export function goalTargetCents(fund: Pick<Fund, 'targetAmountCents'>): Cents {
  return fund.targetAmountCents ?? 0;
}

export function goalMissingCents(fund: Pick<Fund, 'targetAmountCents'>, reservedCents: Cents): Cents {
  return Math.max(0, goalTargetCents(fund) - reservedCents);
}

export function fundsFromBalances(rows: FundBalance[]): Fund[] {
  return rows.map((row) => row.fund);
}
