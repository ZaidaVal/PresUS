import type { Account, CreditCard } from './types';

export const DASHBOARD_PREFS_KEY = 'dashboard_prefs';

/** Máximo 3 fuentes de «puedo usar»: cuenta Atlántida + línea ONE + slot extra. */
export const MAX_USABLE_SOURCES = 3;

export interface DashboardPrefs {
  showHero: boolean;
  showTengo: boolean;
  showApartado: boolean;
  showDebo: boolean;
  showObligaciones: boolean;
  showCuentas: boolean;
  showMovimientos: boolean;
  showFondos: boolean;
  showDrive: boolean;
  featuredAccountIds: string[];
  movementLimit: number;
  /** Slot 1: línea ONE (tope de la línea, no la suma de tarjetas). `null` = `card-one-limit`. */
  limitedCardId: string | null;
  /**
   * Slot 2: cuenta Atlántida (`acc-atlantida`) cuyo disponible = saldo − apartado
   * (fondos para pagar ONE, p.ej. Pago ONE). No es el cupo de la tarjeta.
   */
  paymentAccountId: string | null;
  /** Slot 3: otra línea/cuenta con límite, más adelante. `null` = vacío. No es la de $100. */
  extraLimitedCardId: string | null;
}

export const DEFAULT_DASHBOARD_PREFS: DashboardPrefs = {
  showHero: true,
  showTengo: true,
  showApartado: true,
  showDebo: true,
  showObligaciones: true,
  showCuentas: true,
  showMovimientos: true,
  showFondos: true,
  showDrive: true,
  featuredAccountIds: [],
  movementLimit: 8,
  limitedCardId: null,
  paymentAccountId: null,
  extraLimitedCardId: null,
};

const BOOL_KEYS = [
  'showHero',
  'showTengo',
  'showApartado',
  'showDebo',
  'showObligaciones',
  'showCuentas',
  'showMovimientos',
  'showFondos',
  'showDrive',
] as const;

const LIMITS = new Set([5, 8, 12, 20]);

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function parseDashboardPrefs(raw: string | undefined | null): DashboardPrefs {
  if (!raw) return { ...DEFAULT_DASHBOARD_PREFS, featuredAccountIds: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<DashboardPrefs>;
    if (!parsed || typeof parsed !== 'object') {
      return { ...DEFAULT_DASHBOARD_PREFS, featuredAccountIds: [] };
    }
    const featuredAccountIds = Array.isArray(parsed.featuredAccountIds)
      ? parsed.featuredAccountIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
    const movementLimit = LIMITS.has(parsed.movementLimit as number)
      ? (parsed.movementLimit as number)
      : DEFAULT_DASHBOARD_PREFS.movementLimit;
    const prefs: DashboardPrefs = {
      ...DEFAULT_DASHBOARD_PREFS,
      featuredAccountIds,
      movementLimit,
      limitedCardId: asId(parsed.limitedCardId),
      paymentAccountId: asId(parsed.paymentAccountId) ?? asId((parsed as { openCashAccountId?: unknown }).openCashAccountId),
      extraLimitedCardId: asId(parsed.extraLimitedCardId),
    };
    for (const key of BOOL_KEYS) {
      prefs[key] = asBoolean(parsed[key], DEFAULT_DASHBOARD_PREFS[key]);
    }
    return prefs;
  } catch {
    return { ...DEFAULT_DASHBOARD_PREFS, featuredAccountIds: [] };
  }
}

export function serializeDashboardPrefs(prefs: DashboardPrefs): string {
  return JSON.stringify({
    ...prefs,
    featuredAccountIds: [...new Set(prefs.featuredAccountIds)],
    movementLimit: LIMITS.has(prefs.movementLimit) ? prefs.movementLimit : DEFAULT_DASHBOARD_PREFS.movementLimit,
    limitedCardId: prefs.limitedCardId,
    paymentAccountId: prefs.paymentAccountId,
    extraLimitedCardId: prefs.extraLimitedCardId,
  });
}

function cardsWithLimit(cards: CreditCard[]): CreditCard[] {
  return cards.filter((card) => card.creditLimitCents != null);
}

/** Slot 1: tarjeta base de la línea ONE. No usa el tope de $100 como fuente extra. */
export function resolveLimitedCard(cards: CreditCard[], prefs: DashboardPrefs): CreditCard | null {
  const withLimit = cardsWithLimit(cards);
  if (prefs.limitedCardId) {
    return withLimit.find((card) => card.id === prefs.limitedCardId) ?? null;
  }
  return withLimit.find((card) => card.id === 'card-one-limit') ?? withLimit[0] ?? null;
}

/**
 * Slot 2: cuenta Atlántida (banco/efectivo para pagar ONE).
 * `kind: CREDIT` en la cuenta no la convierte en la tarjeta.
 */
export function resolvePaymentAccount(accounts: Account[], prefs: DashboardPrefs): Account | null {
  if (prefs.paymentAccountId) {
    return accounts.find((row) => row.id === prefs.paymentAccountId) ?? null;
  }
  const byId = accounts.find((row) => row.id === 'acc-atlantida');
  if (byId) return byId;
  const byName = accounts.find((row) => row.name === 'Atlántida');
  if (byName) return byName;
  return accounts.find((row) => row.isCardPaymentSource) ?? null;
}

/** Slot 3: otra línea con límite. Vacío si es la misma línea ONE (tope $100 no se suma). */
export function resolveExtraLimitedCard(
  cards: CreditCard[],
  prefs: DashboardPrefs,
  limitedCardId: string | null,
): CreditCard | null {
  if (!prefs.extraLimitedCardId) return null;
  if (prefs.extraLimitedCardId === limitedCardId) return null;
  const extra = cardsWithLimit(cards).find((card) => card.id === prefs.extraLimitedCardId) ?? null;
  if (!extra) return null;
  const limited = limitedCardId ? cards.find((card) => card.id === limitedCardId) : null;
  if (limited?.creditLineId && extra.creditLineId === limited.creditLineId) return null;
  return extra;
}

/**
 * Disponible de tarjeta con límite, en centavos: `max(0, limite − gastado)`.
 * Gastado = debe POSTED (`cardBalanceFromSplits`). Un cargo no baja el efectivo de Atlántida.
 */
export function limitedCardRemainingCents(limitCents: number | null, owedCents: number): number {
  if (limitCents == null) return 0;
  const remaining = limitCents - owedCents;
  return remaining > 0 ? remaining : 0;
}
