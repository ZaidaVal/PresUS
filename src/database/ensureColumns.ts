import { hasColumn, tableExists, type SqliteExecDb } from './sqliteMeta';

/** Columnas que instalaciones viejas no tienen; SCHEMA IF NOT EXISTS no las añade. */
export const LEGACY_COLUMNS: Array<{ table: string; column: string; ddl: string }> = [
  { table: 'funds', column: 'segment', ddl: "TEXT NOT NULL DEFAULT 'OPERATING'" },
  { table: 'accounts', column: 'is_credit', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'transaction_splits', column: 'card_id', ddl: 'TEXT' },
  { table: 'budget_items', column: 'z_share_cents', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'budget_items', column: 'a_share_cents', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'funds', column: 'interest_kind', ddl: "TEXT NOT NULL DEFAULT 'NONE'" },
  { table: 'funds', column: 'annual_rate_bps', ddl: 'INTEGER' },
  { table: 'credit_cards', column: 'credit_line_id', ddl: 'TEXT' },
  { table: 'credit_cards', column: 'credit_line_limit_cents', ddl: 'INTEGER' },
  { table: 'funds', column: 'due_anchor', ddl: 'TEXT' },
];

/**
 * ALTER solo si la columna no existe. jeep-sqlite envuelve execute() en BEGIN/COMMIT;
 * un ADD COLUMN duplicado aborta esa transacción y deja el arranque en mal estado.
 */
export async function ensureLegacyColumns(db: SqliteExecDb): Promise<void> {
  for (const col of LEGACY_COLUMNS) {
    if (!(await tableExists(db, col.table))) continue;
    if (await hasColumn(db, col.table, col.column)) continue;
    await db.execute(`ALTER TABLE ${col.table} ADD COLUMN ${col.column} ${col.ddl};`, false);
  }
}
