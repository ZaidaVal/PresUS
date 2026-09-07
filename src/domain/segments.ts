import type { Account, AccountBalance, BudgetItem, Fund, FundBalance, FundSegment } from './types';

export function normalizeFundSegment(value: unknown): FundSegment {
  return value === 'SAVINGS' ? 'SAVINGS' : 'OPERATING';
}

export function isSavingsFund(fund: Pick<Fund, 'segment'>): boolean {
  return fund.segment === 'SAVINGS';
}

/** Mini-fondos operativos (Casa, Luz, Super…): recarga quincenal, no meta ni prioridad de Inicio. */
export function isBudgetedOperatingFund(fund: Pick<Fund, 'segment'>): boolean {
  return fund.segment === 'OPERATING';
}

export function looksLikeSavingsFund(fund: Pick<Fund, 'id' | 'name'>): boolean {
  return /ahorro/i.test(fund.name) || /ahorro/i.test(fund.id);
}

/** Cuentas Ahorros / Ahorros 2: no se listan ni suman en Inicio; no pagan ONE. */
export function isSavingsAccount(account: Pick<Account, 'id' | 'name'>): boolean {
  return /ahorro/i.test(account.name) || /ahorro/i.test(account.id);
}

/** Barras es cuenta de efectivo compartido, no la tarjeta. */
export function isBarrasAccount(account: Pick<Account, 'id' | 'name' | 'kind'>): boolean {
  if (account.kind === 'CREDIT') return false;
  const id = account.id.trim().toLowerCase();
  const name = account.name.trim().toLowerCase();
  return name === 'barras' || id === 'barras' || id === 'acc-barras';
}

/** Atlántida: único sitio del apartado a pagar de ONE. No es ahorro. */
export function isAtlantidaAccount(
  account: Pick<Account, 'id' | 'name' | 'isCardPaymentSource'>,
): boolean {
  if (account.isCardPaymentSource) return true;
  const id = account.id.trim().toLowerCase();
  const name = account.name.trim().toLowerCase();
  return name === 'atlántida' || name === 'atlantida' || id === 'acc-atlantida' || id === 'atlantida';
}

export function isPrivateAccount(account: Pick<Account, 'visibility'>): boolean {
  return account.visibility === 'PRIVATE';
}

/**
 * Inicio: Barras y Atlántida siempre, más las públicas marcadas en Ajustes.
 * Nunca bolsillo privado. Ahorros solo si el usuario las marca.
 */
export function dashboardListedAccounts(
  balances: AccountBalance[],
  featuredAccountIds: string[] = [],
): AccountBalance[] {
  const publicRows = balances.filter(
    (row) => row.account.visibility === 'PUBLIC' && !isPrivateAccount(row.account),
  );
  const defaults = publicRows.filter(
    (row) => isBarrasAccount(row.account) || isAtlantidaAccount(row.account),
  );
  if (featuredAccountIds.length === 0) return defaults;
  const wanted = new Set(featuredAccountIds);
  const extras = publicRows.filter(
    (row) =>
      wanted.has(row.account.id) &&
      !isBarrasAccount(row.account) &&
      !isAtlantidaAccount(row.account),
  );
  return [...defaults, ...extras];
}

/** Cuentas que Ajustes puede mostrar en Inicio: públicas. Nunca privadas. */
export function dashboardFeaturedCandidates<T extends Pick<Account, 'id' | 'name' | 'visibility'>>(
  accounts: T[],
): T[] {
  return accounts
    .filter((row) => row.visibility === 'PUBLIC' && !isPrivateAccount(row))
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, 'es'));
}

export function isDefaultDashboardAccount(account: Pick<Account, 'id' | 'name' | 'kind' | 'isCardPaymentSource'>): boolean {
  return isBarrasAccount(account) || isAtlantidaAccount(account);
}

export function isSavingsLikeFund(fund: Pick<Fund, 'id' | 'name' | 'segment'>): boolean {
  return isSavingsFund(fund) || looksLikeSavingsFund(fund);
}

export function isSavingsBudgetItem(item: BudgetItem, funds: Array<Fund | FundBalance>): boolean {
  if (item.category.trim().toLowerCase() === 'ahorro') return true;
  if (!item.coverFundId) return false;
  const fund = funds
    .map((row) => ('fund' in row ? row.fund : row))
    .find((row) => row.id === item.coverFundId);
  return fund ? isSavingsFund(fund) : false;
}
