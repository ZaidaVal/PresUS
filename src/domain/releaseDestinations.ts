import { DomainError, type LedgerTx } from './ledger';
import { isAtlantidaAccount, isBarrasAccount, isPrivateAccount, isSavingsAccount } from './segments';
import type { Account } from './types';

export const RELEASE_DESTINATIONS_META_KEY = 'release_destination_account_ids';

export const RELEASE_DESTINATIONS_EMPTY_MESSAGE =
  'No hay cuentas destino de liberación. Configúralas en Ajustes → Control.';

export const RELEASE_DESTINATION_FORBIDDEN_MESSAGE =
  'Esa cuenta no está permitida para desembolso al liberar';

export type ReleaseDestinationsConfig = {
  /** `false` = nunca se guardó: aplicar defaults Barras / Ahorros. */
  configured: boolean;
  accountIds: string[];
};

type PublicAccount = Pick<Account, 'id' | 'name' | 'kind' | 'visibility' | 'isCardPaymentSource'>;

/** Cuentas que el control puede mostrar: públicas. No se listan bolsillos Z/A. */
export function listedReleaseDestinationAccounts<T extends PublicAccount>(accounts: T[]): T[] {
  return accounts
    .filter((row) => row.visibility === 'PUBLIC' && !isPrivateAccount(row))
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, 'es'));
}

/** Defaults: Barras (disponible) y cuentas de ahorro. Atlántida no es caja general. */
export function isDefaultReleaseDestination(account: PublicAccount): boolean {
  if (account.visibility !== 'PUBLIC' || isPrivateAccount(account)) return false;
  if (isAtlantidaAccount(account)) return false;
  return isBarrasAccount(account) || isSavingsAccount(account);
}

export function defaultReleaseDestinationIds(accounts: PublicAccount[]): string[] {
  return listedReleaseDestinationAccounts(accounts)
    .filter(isDefaultReleaseDestination)
    .map((row) => row.id);
}

export function parseReleaseDestinations(raw: string | undefined | null): ReleaseDestinationsConfig {
  if (raw == null || raw.trim() === '') {
    return { configured: false, accountIds: [] };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return { configured: false, accountIds: [] };
    }
    const accountIds = [
      ...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)),
    ];
    return { configured: true, accountIds };
  } catch {
    return { configured: false, accountIds: [] };
  }
}

export function serializeReleaseDestinations(accountIds: string[]): string {
  return JSON.stringify([...new Set(accountIds.filter((id) => id.trim().length > 0))]);
}

/** IDs permitidos ahora: defaults si no hay control guardado; si hay, las públicas de esa lista. */
export function resolveReleaseDestinationIds(
  accounts: PublicAccount[],
  config: ReleaseDestinationsConfig,
): string[] {
  const listed = listedReleaseDestinationAccounts(accounts);
  const listedIds = new Set(listed.map((row) => row.id));
  if (!config.configured) {
    return listed.filter(isDefaultReleaseDestination).map((row) => row.id);
  }
  return config.accountIds.filter((id) => listedIds.has(id));
}

export function allowedReleaseDestinationAccounts<T extends PublicAccount>(
  accounts: T[],
  config: ReleaseDestinationsConfig,
): T[] {
  const allowed = new Set(resolveReleaseDestinationIds(accounts, config));
  return listedReleaseDestinationAccounts(accounts).filter((row) => allowed.has(row.id));
}

export async function loadReleaseDestinationsConfig(tx: LedgerTx): Promise<ReleaseDestinationsConfig> {
  return parseReleaseDestinations(await tx.getMeta(RELEASE_DESTINATIONS_META_KEY));
}

export async function assertAllowedReleaseDestination(
  tx: LedgerTx,
  accountId: string,
  options: { accounts?: Account[] } = {},
): Promise<Account> {
  const accounts = options.accounts ?? (await tx.listAccounts());
  const account = accounts.find((row) => row.id === accountId);
  if (!account) throw new DomainError('Cuenta destino no encontrada');
  if (account.visibility === 'PRIVATE' || isPrivateAccount(account)) {
    throw new DomainError('El desembolso al liberar no va a una cuenta privada');
  }
  const config = await loadReleaseDestinationsConfig(tx);
  const allowed = resolveReleaseDestinationIds(accounts, config);
  if (allowed.length === 0) {
    throw new DomainError(RELEASE_DESTINATIONS_EMPTY_MESSAGE);
  }
  if (!allowed.includes(account.id)) {
    throw new DomainError(RELEASE_DESTINATION_FORBIDDEN_MESSAGE);
  }
  return account;
}
