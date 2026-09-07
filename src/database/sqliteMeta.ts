/** Adaptador mínimo: Capacitor SQLite o sql.js en tests. */
export type SqliteExecDb = {
  execute(sql: string, transaction?: boolean): Promise<unknown>;
  query(sql: string): Promise<{ values?: Array<Record<string, unknown> | unknown[]> }>;
};

export async function tableSql(db: SqliteExecDb, name: string): Promise<string | null> {
  const result = await db.query(
    `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${name}'`,
  );
  const sql = cell(result.values?.[0], 'sql');
  if (sql == null || sql === '') return null;
  return String(sql);
}

export async function tableExists(db: SqliteExecDb, name: string): Promise<boolean> {
  return (await tableSql(db, name)) != null;
}

export async function tableCount(db: SqliteExecDb, name: string): Promise<number> {
  const result = await db.query(`SELECT COUNT(*) AS n FROM "${name}"`);
  return Number(cell(result.values?.[0], 'n') ?? 0);
}

export type ColumnInfo = {
  name: string;
  type: string;
  notnull: number;
  dflt: unknown;
};

export async function listColumnInfo(db: SqliteExecDb, table: string): Promise<ColumnInfo[]> {
  const result = await db.query(`PRAGMA table_info("${table}")`);
  return (result.values ?? []).map((row) => {
    if (Array.isArray(row)) {
      return {
        name: String(row[1] ?? ''),
        type: String(row[2] ?? ''),
        notnull: Number(row[3] ?? 0),
        dflt: row[4],
      };
    }
    return {
      name: String(row.name ?? row.NAME ?? ''),
      type: String(row.type ?? row.TYPE ?? ''),
      notnull: Number(row.notnull ?? row.NOTNULL ?? 0),
      dflt: row.dflt_value ?? row.DFLT_VALUE,
    };
  }).filter((col) => col.name.length > 0);
}

export async function listColumns(db: SqliteExecDb, table: string): Promise<string[]> {
  return (await listColumnInfo(db, table)).map((col) => col.name);
}

export async function hasColumn(db: SqliteExecDb, table: string, column: string): Promise<boolean> {
  const cols = await listColumns(db, table);
  const wanted = column.toLowerCase();
  return cols.some((name) => name.toLowerCase() === wanted);
}

export function cell(row: Record<string, unknown> | unknown[] | undefined, key: string): unknown {
  if (row == null) return undefined;
  if (Array.isArray(row)) return row[0];
  return row[key] ?? row[key.toLowerCase()] ?? row[key.toUpperCase()];
}
