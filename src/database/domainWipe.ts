/**
 * Hijos con FK ON DELETE RESTRICT antes que padres.
 * Vaciar el libro (factory empty / restore) — no es borrar historial POSTED diario.
 */
export const DOMAIN_DELETE_ORDER = [
  'debt_payments',
  'card_charges',
  'transaction_splits',
  'reservations',
  'budget_items',
  'credit_cards',
  'transactions',
  'debts',
  'funds',
  'accounts',
  'people',
  'meta',
] as const;
