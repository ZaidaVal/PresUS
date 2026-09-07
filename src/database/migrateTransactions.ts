import {
  tableCount,
  tableExists,
  tableSql,
  listColumnInfo,
  type ColumnInfo,
  type SqliteExecDb,
} from './sqliteMeta';

export type MigrationDb = SqliteExecDb;

const TRANSACTIONS_NEW_DDL = `
CREATE TABLE transactions_new (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'INGRESO','GASTO','TRANSFERENCIA','APORTE','RESERVA','LIBERACION_RESERVA','AJUSTE','PAGO_DEUDA'
  )),
  occurred_at TEXT NOT NULL,
  period TEXT CHECK (period IN ('Q1', 'Q2') OR period IS NULL),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('POSTED', 'VOID')),
  reverses_id TEXT
)
`.trim();

const CHILD_NAMES = ['transaction_splits', 'reservations', 'card_charges', 'debt_payments'] as const;

/** Fallback si un arranque a medias dejó `_mig_*` y SCHEMA recreó/vació la tabla. */
const FALLBACK_CHILD_DDL: Record<(typeof CHILD_NAMES)[number], string> = {
  transaction_splits: `CREATE TABLE transaction_splits (
  id TEXT PRIMARY KEY NOT NULL,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  account_id TEXT REFERENCES accounts(id) ON DELETE RESTRICT,
  fund_id TEXT REFERENCES funds(id) ON DELETE RESTRICT,
  person_id TEXT REFERENCES people(id) ON DELETE RESTRICT,
  card_id TEXT REFERENCES credit_cards(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('SOURCE', 'DESTINATION', 'RESERVE', 'EQUITY'))
)`,
  reservations: `CREATE TABLE reservations (
  id TEXT PRIMARY KEY NOT NULL,
  fund_id TEXT NOT NULL REFERENCES funds(id) ON DELETE RESTRICT,
  source_transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'RELEASED', 'CONSUMED'))
)`,
  card_charges: `CREATE TABLE card_charges (
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
)`,
  debt_payments: `CREATE TABLE debt_payments (
  id TEXT PRIMARY KEY NOT NULL,
  debt_id TEXT NOT NULL REFERENCES debts(id) ON DELETE RESTRICT,
  transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  principal_cents INTEGER NOT NULL CHECK (principal_cents >= 0),
  interest_cents INTEGER NOT NULL CHECK (interest_cents >= 0),
  occurred_at TEXT NOT NULL
)`,
};

type ChildPlan = {
  name: (typeof CHILD_NAMES)[number];
  createSql: string;
  backupCols: ColumnInfo[];
  hasMig: boolean;
  hasTable: boolean;
};

/**
 * SQLite no permite ALTER del CHECK de `transactions`. Recrear es el único camino,
 * y debe ser idempotente: un arranque a medias deja `transactions_new` y el siguiente
 * explota con «table transactions_new already exists» (jeep-sqlite lo envuelve en ExecuteSQL).
 *
 * No usa user_version: detecta PAGO_DEUDA en sqlite_master.
 */
export async function ensureTransactionsAllowPagoDeuda(db: MigrationDb): Promise<void> {
  const txSql = await tableSql(db, 'transactions');
  const newSql = await tableSql(db, 'transactions_new');
  const hasTransactions = txSql != null;
  const hasNew = newSql != null;
  const alreadyMigrated = (txSql ?? '').includes('PAGO_DEUDA');

  if (hasNew) {
    const newCount = await tableCount(db, 'transactions_new');
    const txCount = hasTransactions ? await tableCount(db, 'transactions') : 0;

    if (!hasTransactions || (txCount === 0 && newCount > 0)) {
      const dropOld = hasTransactions ? 'DROP TABLE transactions;' : '';
      await rebuildAroundTransactions(
        db,
        `${dropOld}
         ALTER TABLE transactions_new RENAME TO transactions;`,
      );
      return;
    }

    await db.execute('DROP TABLE IF EXISTS transactions_new;', false);
  }

  if (!hasTransactions || alreadyMigrated) return;

  await rebuildAroundTransactions(
    db,
    `DROP TABLE IF EXISTS transactions_new;
     ${TRANSACTIONS_NEW_DDL};
     INSERT INTO transactions_new (id, type, occurred_at, period, note, created_at, status, reverses_id)
      SELECT id, type, occurred_at, period, note, created_at, status, reverses_id FROM transactions;
     DROP TABLE transactions;
     ALTER TABLE transactions_new RENAME TO transactions;`,
  );
}

/**
 * jeep-sqlite: execute() default = BEGIN/COMMIT, y autosave vuelve a PRAGMA foreign_keys=ON
 * después de cada execute. PRAGMA OFF va en el MISMO execute(..., false) que el DROP.
 *
 * Orden: copiar hijos → DROP hijos → DROP padre → RENAME → restaurar hijos.
 * Copia el historial POSTED; no lo borra.
 */
async function rebuildAroundTransactions(db: MigrationDb, bodySql: string): Promise<void> {
  const plans = await collectChildPlans(db);
  const parkSql = plans
    .map((plan) => {
      const mig = migName(plan.name);
      const parts: string[] = [];
      if (!plan.hasMig && plan.hasTable) {
        parts.push(`CREATE TABLE "${mig}" AS SELECT * FROM "${plan.name}";`);
      }
      parts.push(`DROP TABLE IF EXISTS "${plan.name}";`);
      return parts.join('\n');
    })
    .join('\n');

  const restoreSql = plans.map((plan) => restoreChildSql(plan)).join('\n');

  await db.execute(
    `PRAGMA foreign_keys = OFF;
     ${parkSql}
     ${bodySql}
     ${restoreSql}
     PRAGMA foreign_keys = ON;`,
    false,
  );
}

function restoreChildSql(plan: ChildPlan): string {
  const mig = migName(plan.name);
  const extras = plan.backupCols.filter((col) => !createSqlHasColumn(plan.createSql, col.name));
  const alters = extras
    .map((col) => `ALTER TABLE "${plan.name}" ADD COLUMN ${alterColumnDdl(col)};`)
    .join('\n');
  const cols = plan.backupCols.map((col) => `"${col.name}"`).join(', ');
  const insert =
    plan.backupCols.length > 0
      ? `INSERT INTO "${plan.name}" (${cols}) SELECT ${cols} FROM "${mig}";`
      : '';
  return `${plan.createSql};
${alters}
${insert}
DROP TABLE IF EXISTS "${mig}";`;
}

async function collectChildPlans(db: MigrationDb): Promise<ChildPlan[]> {
  const plans: ChildPlan[] = [];
  for (const name of CHILD_NAMES) {
    const hasMig = await tableExists(db, migName(name));
    const hasTable = await tableExists(db, name);
    if (!hasMig && !hasTable) continue;
    const createSql =
      (hasTable ? await tableSql(db, name) : null) ?? FALLBACK_CHILD_DDL[name];
    const backupCols = hasMig
      ? await listColumnInfo(db, migName(name))
      : await listColumnInfo(db, name);
    plans.push({ name, createSql, backupCols, hasMig, hasTable });
  }
  return plans;
}

function createSqlHasColumn(createSql: string, column: string): boolean {
  const flat = createSql.replace(/\s+/g, ' ');
  const re = new RegExp(`[(,]\\s*["']?${escapeRegExp(column)}["']?\\s+`, 'i');
  return re.test(flat);
}

function alterColumnDdl(col: ColumnInfo): string {
  const type = col.type.trim() || 'TEXT';
  if (col.dflt != null && col.dflt !== '') {
    return `"${col.name}" ${type} DEFAULT ${formatSqlLiteral(col.dflt)}`;
  }
  return `"${col.name}" ${type}`;
}

function formatSqlLiteral(value: unknown): string {
  if (value == null) return 'NULL';
  if (typeof value === 'number') return String(value);
  const text = String(value);
  if (/^'.*'$/.test(text) || /^-?\d+(\.\d+)?$/.test(text)) return text;
  return `'${text.replace(/'/g, "''")}'`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function migName(table: string): string {
  return `_mig_${table}`;
}
