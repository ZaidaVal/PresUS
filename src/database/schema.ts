export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY NOT NULL,
  code TEXT NOT NULL UNIQUE CHECK (code IN ('Z', 'A')),
  display_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('BANK', 'CASH', 'FUND_HOLDER', 'CREDIT')),
  visibility TEXT NOT NULL CHECK (visibility IN ('PUBLIC', 'PRIVATE')),
  owner_person_id TEXT REFERENCES people(id) ON DELETE RESTRICT,
  counts_as_liquidity INTEGER NOT NULL CHECK (counts_as_liquidity IN (0, 1)),
  is_card_payment_source INTEGER NOT NULL CHECK (is_card_payment_source IN (0, 1)),
  is_credit INTEGER NOT NULL DEFAULT 0 CHECK (is_credit IN (0, 1))
);

CREATE TABLE IF NOT EXISTS funds (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  target_amount_cents INTEGER,
  priority INTEGER,
  segment TEXT NOT NULL DEFAULT 'OPERATING' CHECK (segment IN ('OPERATING', 'SAVINGS')),
  interest_kind TEXT NOT NULL DEFAULT 'NONE' CHECK (interest_kind IN (
    'NONE','SIMPLE','COMPOUND_MONTHLY','COMPOUND_FORTNIGHTLY','COMPOUND_ANNUAL'
  )),
  annual_rate_bps INTEGER,
  due_anchor TEXT CHECK (due_anchor IN ('MONTH_START','MONTH_MID','MONTH_END') OR due_anchor IS NULL)
);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'INGRESO','GASTO','TRANSFERENCIA','APORTE','RESERVA','LIBERACION_RESERVA','AJUSTE','PAGO_DEUDA'
  )),
  occurred_at TEXT NOT NULL,
  period TEXT CHECK (period IN ('Q1', 'Q2') OR period IS NULL),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('POSTED', 'VOID')),
  reverses_id TEXT REFERENCES transactions(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS credit_cards (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  payment_account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  cover_fund_id TEXT REFERENCES funds(id) ON DELETE RESTRICT,
  credit_limit_cents INTEGER,
  credit_line_id TEXT,
  credit_line_limit_cents INTEGER,
  person_id TEXT REFERENCES people(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS card_charges (
  id TEXT PRIMARY KEY NOT NULL,
  card_id TEXT NOT NULL REFERENCES credit_cards(id) ON DELETE RESTRICT,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  charge_class TEXT NOT NULL CHECK (charge_class IN (
    'SHARED_BUDGETED','SHARED_UNBUDGETED','PERSONAL_Z','PERSONAL_A'
  )),
  coverage_status TEXT NOT NULL CHECK (coverage_status IN (
    'SIN_COBERTURA','CUBIERTO_PENDIENTE_TRASPASO','TRANSFERIDO_A_ATLANTIDA'
  )),
  cover_fund_id TEXT REFERENCES funds(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS transaction_splits (
  id TEXT PRIMARY KEY NOT NULL,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  fund_id TEXT REFERENCES funds(id) ON DELETE RESTRICT,
  person_id TEXT REFERENCES people(id) ON DELETE RESTRICT,
  card_id TEXT REFERENCES credit_cards(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('SOURCE', 'DESTINATION', 'RESERVE', 'EQUITY'))
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY NOT NULL,
  fund_id TEXT NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  source_transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED', 'CONSUMED'))
);

CREATE TABLE IF NOT EXISTS budget_items (
  id TEXT PRIMARY KEY NOT NULL,
  budget_scope TEXT NOT NULL CHECK (budget_scope IN ('Z', 'A', 'HOME')),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN (
    'QUINCENAL','MENSUAL','BIMESTRAL','TRIMESTRAL','ANUAL','UNICO'
  )),
  amount_cents INTEGER NOT NULL,
  z_share_cents INTEGER NOT NULL DEFAULT 0,
  a_share_cents INTEGER NOT NULL DEFAULT 0,
  fortnight TEXT NOT NULL CHECK (fortnight IN ('Q1', 'Q2', 'BOTH', 'NONE')),
  cover_fund_id TEXT REFERENCES funds(id) ON DELETE RESTRICT,
  usual_medium TEXT NOT NULL CHECK (usual_medium IN ('CARD', 'TRANSFER', 'CASH')),
  active INTEGER NOT NULL CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS debts (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('MORTGAGE', 'PERSONAL', 'VEHICLE', 'OTHER')),
  original_cents INTEGER NOT NULL CHECK (original_cents > 0),
  annual_rate_bps INTEGER NOT NULL CHECK (annual_rate_bps >= 0 AND annual_rate_bps <= 10000),
  term_months INTEGER NOT NULL CHECK (term_months > 0),
  installment_cents INTEGER NOT NULL CHECK (installment_cents > 0),
  started_at TEXT NOT NULL,
  payment_account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  cover_fund_id TEXT REFERENCES funds(id) ON DELETE RESTRICT,
  amortization TEXT NOT NULL CHECK (amortization IN ('FRENCH', 'INTEREST_ONLY', 'SIMPLE')),
  compounding TEXT NOT NULL CHECK (compounding IN ('MONTHLY', 'FORTNIGHTLY', 'ANNUAL')),
  extra_monthly_cents INTEGER NOT NULL DEFAULT 0 CHECK (extra_monthly_cents >= 0),
  extra_fortnight_cents INTEGER NOT NULL DEFAULT 0 CHECK (extra_fortnight_cents >= 0),
  extra_every_n_months INTEGER,
  extra_every_n_amount_cents INTEGER NOT NULL DEFAULT 0 CHECK (extra_every_n_amount_cents >= 0),
  note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS debt_payments (
  id TEXT PRIMARY KEY NOT NULL,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  principal_cents INTEGER NOT NULL CHECK (principal_cents >= 0),
  interest_cents INTEGER NOT NULL CHECK (interest_cents >= 0),
  occurred_at TEXT NOT NULL
);
`;
