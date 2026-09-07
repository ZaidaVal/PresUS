import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ensureTransactionsAllowPagoDeuda,
  type MigrationDb,
} from './migrateTransactions';
import { ensureLegacyColumns, LEGACY_COLUMNS } from './ensureColumns';
import { DOMAIN_DELETE_ORDER } from './domainWipe';
import { hasColumn, tableExists as dbTableExists } from './sqliteMeta';
import { SCHEMA_SQL } from './schema';

type SqlJsDb = {
  exec(sql: string): Array<{ columns: string[]; values: unknown[][] }>;
  close(): void;
};

type SqlJsStatic = {
  Database: new () => SqlJsDb;
};

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js') as (config: { wasmBinary: Buffer }) => Promise<SqlJsStatic>;
const wasmBinary = readFileSync(join(dirname(require.resolve('sql.js')), 'sql-wasm.wasm'));

let SQL: SqlJsStatic | undefined;

async function sqlEngine(): Promise<SqlJsStatic> {
  if (!SQL) {
    SQL = await initSqlJs({ wasmBinary });
  }
  return SQL;
}

/**
 * jeep-sqlite: execute() abre BEGIN/COMMIT salvo transaction=false,
 * y autosave (saveToStore) vuelve a PRAGMA foreign_keys=ON después de cada execute.
 */
function asJeepMigrationDb(db: SqlJsDb): MigrationDb {
  return {
    async execute(sql: string, transaction = true) {
      try {
        if (transaction) {
          db.exec('BEGIN TRANSACTION');
          try {
            db.exec(sql);
            db.exec('COMMIT TRANSACTION');
          } catch (err) {
            try {
              db.exec('ROLLBACK TRANSACTION');
            } catch {
              /* ignore */
            }
            throw err;
          }
        } else {
          db.exec(sql);
        }
      } finally {
        db.exec('PRAGMA foreign_keys = ON;');
      }
    },
    async query(sql: string) {
      const result = db.exec(sql);
      if (result.length === 0) return { values: [] };
      const { columns, values } = result[0];
      return {
        values: values.map((vals) => {
          const row: Record<string, unknown> = {};
          columns.forEach((col, i) => {
            row[col] = vals[i];
          });
          return row;
        }),
      };
    },
  };
}

const OLD_TRANSACTIONS_DDL = `
CREATE TABLE transactions (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'INGRESO','GASTO','TRANSFERENCIA','APORTE','RESERVA','LIBERACION_RESERVA','AJUSTE'
  )),
  occurred_at TEXT NOT NULL,
  period TEXT CHECK (period IN ('Q1', 'Q2') OR period IS NULL),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('POSTED', 'VOID')),
  reverses_id TEXT
)
`;

function seedOldPosted(db: SqlJsDb) {
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(OLD_TRANSACTIONS_DDL);
  db.exec(`
    CREATE TABLE transaction_splits (
      id TEXT PRIMARY KEY NOT NULL,
      transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
      amount_cents INTEGER NOT NULL
    );
    CREATE TABLE reservations (
      id TEXT PRIMARY KEY NOT NULL,
      fund_id TEXT NOT NULL,
      source_transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
      amount_cents INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE card_charges (
      id TEXT PRIMARY KEY NOT NULL,
      card_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
      amount_cents INTEGER NOT NULL
    );
    CREATE TABLE debt_payments (
      id TEXT PRIMARY KEY NOT NULL,
      debt_id TEXT NOT NULL,
      transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
      principal_cents INTEGER NOT NULL,
      interest_cents INTEGER NOT NULL,
      occurred_at TEXT NOT NULL
    );
  `);
  db.exec(`
    INSERT INTO transactions (id, type, occurred_at, period, note, created_at, status, reverses_id)
    VALUES ('tx-posted', 'GASTO', '2026-08-01T00:00:00.000Z', 'Q1', 'super', '2026-08-01T00:00:00.000Z', 'POSTED', NULL);
    INSERT INTO transaction_splits (id, transaction_id, amount_cents)
    VALUES ('split-1', 'tx-posted', -500);
    INSERT INTO reservations (id, fund_id, source_transaction_id, amount_cents, status)
    VALUES ('res-1', 'fund-super', 'tx-posted', 500, 'ACTIVE');
    INSERT INTO card_charges (id, card_id, transaction_id, amount_cents)
    VALUES ('chg-1', 'card-one', 'tx-posted', 500);
    INSERT INTO debt_payments (id, debt_id, transaction_id, principal_cents, interest_cents, occurred_at)
    VALUES ('pay-1', 'debt-1', 'tx-posted', 400, 100, '2026-08-01T00:00:00.000Z');
  `);
}

function tableSql(db: SqlJsDb, name: string): string {
  const rows = db.exec(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${name}'`);
  return String(rows[0]?.values[0]?.[0] ?? '');
}

function tableExists(db: SqlJsDb, name: string): boolean {
  const rows = db.exec(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '${name}'`,
  );
  return rows.length > 0;
}

describe('ensureTransactionsAllowPagoDeuda', () => {
  it('recrea el CHECK con PAGO_DEUDA y conserva POSTED e hijos FK (wrapper jeep)', async () => {
    const SQL = await sqlEngine();
    const db = new SQL.Database();
    seedOldPosted(db);

    expect(() =>
      db.exec(`INSERT INTO transactions (id, type, occurred_at, period, note, created_at, status)
               VALUES ('tx-pago', 'PAGO_DEUDA', '2026-08-02T00:00:00.000Z', NULL, '', '2026-08-02T00:00:00.000Z', 'POSTED')`),
    ).toThrow();

    await ensureTransactionsAllowPagoDeuda(asJeepMigrationDb(db));

    expect(tableSql(db, 'transactions')).toContain('PAGO_DEUDA');
    expect(tableExists(db, 'transactions_new')).toBe(false);
    expect(tableExists(db, '_mig_transaction_splits')).toBe(false);
    const posted = db.exec(`SELECT id, type, status FROM transactions WHERE id = 'tx-posted'`);
    expect(posted[0].values[0]).toEqual(['tx-posted', 'GASTO', 'POSTED']);
    expect(db.exec(`SELECT id FROM transaction_splits WHERE transaction_id = 'tx-posted'`)[0].values[0][0]).toBe(
      'split-1',
    );
    expect(db.exec(`SELECT id FROM reservations`)[0].values[0][0]).toBe('res-1');
    expect(db.exec(`SELECT id FROM card_charges`)[0].values[0][0]).toBe('chg-1');
    expect(db.exec(`SELECT id FROM debt_payments`)[0].values[0][0]).toBe('pay-1');

    db.exec(`INSERT INTO transactions (id, type, occurred_at, period, note, created_at, status)
             VALUES ('tx-pago', 'PAGO_DEUDA', '2026-08-02T00:00:00.000Z', NULL, '', '2026-08-02T00:00:00.000Z', 'POSTED')`);
    expect(db.exec(`SELECT type FROM transactions WHERE id = 'tx-pago'`)[0].values[0][0]).toBe(
      'PAGO_DEUDA',
    );
    db.close();
  });

  it('sobrevive a transactions_new huérfana y no borra el historial', async () => {
    const SQL = await sqlEngine();
    const db = new SQL.Database();
    seedOldPosted(db);
    db.exec(`
      CREATE TABLE transactions_new (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        period TEXT,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        reverses_id TEXT
      );
    `);

    const jeep = asJeepMigrationDb(db);
    await ensureTransactionsAllowPagoDeuda(jeep);
    await ensureTransactionsAllowPagoDeuda(jeep);

    expect(tableSql(db, 'transactions')).toContain('PAGO_DEUDA');
    expect(tableExists(db, 'transactions_new')).toBe(false);
    expect(db.exec(`SELECT COUNT(*) FROM transactions WHERE id = 'tx-posted'`)[0].values[0][0]).toBe(
      1,
    );
    expect(db.exec(`SELECT COUNT(*) FROM transaction_splits`)[0].values[0][0]).toBe(1);
    db.close();
  });

  it('completa el rename si SCHEMA dejó transactions vacía y los POSTED están en transactions_new', async () => {
    const SQL = await sqlEngine();
    const db = new SQL.Database();
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE transactions (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL CHECK (type IN (
          'INGRESO','GASTO','TRANSFERENCIA','APORTE','RESERVA','LIBERACION_RESERVA','AJUSTE','PAGO_DEUDA'
        )),
        occurred_at TEXT NOT NULL,
        period TEXT,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('POSTED', 'VOID')),
        reverses_id TEXT
      );
      CREATE TABLE transactions_new (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        period TEXT,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        reverses_id TEXT
      );
      CREATE TABLE transaction_splits (
        id TEXT PRIMARY KEY NOT NULL,
        transaction_id TEXT NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
        amount_cents INTEGER NOT NULL
      );
      INSERT INTO transactions_new (id, type, occurred_at, period, note, created_at, status)
      VALUES ('tx-posted', 'GASTO', '2026-08-01T00:00:00.000Z', 'Q1', 'super', '2026-08-01T00:00:00.000Z', 'POSTED');
      INSERT INTO transaction_splits (id, transaction_id, amount_cents)
      VALUES ('split-1', 'tx-posted', -500);
    `);

    await ensureTransactionsAllowPagoDeuda(asJeepMigrationDb(db));

    expect(tableExists(db, 'transactions_new')).toBe(false);
    expect(db.exec(`SELECT id, status FROM transactions`)[0].values[0]).toEqual([
      'tx-posted',
      'POSTED',
    ]);
    expect(db.exec(`SELECT id FROM transaction_splits`)[0].values[0][0]).toBe('split-1');
    db.close();
  });
});

describe('ensureLegacyColumns', () => {
  it('añade columnas viejas una vez y la segunda pasada no lanza duplicate column', async () => {
    const SQL = await sqlEngine();
    const db = new SQL.Database();
    db.exec(`
      CREATE TABLE funds (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        purpose TEXT NOT NULL,
        target_amount_cents INTEGER,
        priority INTEGER
      );
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        visibility TEXT NOT NULL,
        owner_person_id TEXT,
        counts_as_liquidity INTEGER NOT NULL,
        is_card_payment_source INTEGER NOT NULL
      );
      CREATE TABLE transaction_splits (
        id TEXT PRIMARY KEY NOT NULL,
        transaction_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        role TEXT NOT NULL
      );
      CREATE TABLE budget_items (
        id TEXT PRIMARY KEY NOT NULL,
        budget_scope TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        frequency TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        fortnight TEXT NOT NULL,
        cover_fund_id TEXT,
        usual_medium TEXT NOT NULL,
        active INTEGER NOT NULL
      );
      CREATE TABLE credit_cards (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        payment_account_id TEXT NOT NULL,
        cover_fund_id TEXT,
        credit_limit_cents INTEGER,
        person_id TEXT
      );
    `);

    const jeep = asJeepMigrationDb(db);
    await ensureLegacyColumns(jeep);
    for (const col of LEGACY_COLUMNS) {
      expect(await hasColumn(jeep, col.table, col.column)).toBe(true);
    }

    await expect(ensureLegacyColumns(jeep)).resolves.toBeUndefined();
    await expect(ensureLegacyColumns(jeep)).resolves.toBeUndefined();
    db.close();
  });

  it('añade annual_rate_bps a funds que ya tienen interest_kind (libro desfasado)', async () => {
    const SQL = await sqlEngine();
    const db = new SQL.Database();
    db.exec(`
      CREATE TABLE funds (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        purpose TEXT NOT NULL,
        target_amount_cents INTEGER,
        priority INTEGER,
        segment TEXT NOT NULL DEFAULT 'OPERATING',
        interest_kind TEXT NOT NULL DEFAULT 'NONE'
      );
      INSERT INTO funds (id, account_id, name, purpose, target_amount_cents, priority)
      VALUES ('fund-super', 'acc-barras', 'Super', 'Despensa', NULL, NULL);
    `);
    const jeep = asJeepMigrationDb(db);
    expect(await hasColumn(jeep, 'funds', 'annual_rate_bps')).toBe(false);

    await ensureLegacyColumns(jeep);

    expect(await hasColumn(jeep, 'funds', 'annual_rate_bps')).toBe(true);
    expect(await hasColumn(jeep, 'funds', 'interest_kind')).toBe(true);
    const rate = db.exec(`SELECT annual_rate_bps FROM funds WHERE id = 'fund-super'`);
    expect(rate[0].values[0][0]).toBeNull();
    await expect(ensureLegacyColumns(jeep)).resolves.toBeUndefined();
    db.close();
  });
});

describe('wipe de dominio con FK', () => {
  it('hijos→padre vacía el libro y un wipe ya vacío no explota', async () => {
    const SQL = await sqlEngine();
    const db = new SQL.Database();
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec(SCHEMA_SQL);

    db.exec(`
      INSERT INTO people (id, code, display_name) VALUES ('person-z', 'Z', 'Z');
      INSERT INTO accounts (id, name, kind, visibility, owner_person_id, counts_as_liquidity, is_card_payment_source)
      VALUES ('acc-barras', 'Barras', 'BANK', 'PUBLIC', NULL, 1, 0);
      INSERT INTO funds (id, account_id, name, purpose, target_amount_cents, priority)
      VALUES ('fund-super', 'acc-barras', 'Super', 'Despensa', NULL, NULL);
      INSERT INTO transactions (id, type, occurred_at, period, note, created_at, status)
      VALUES ('tx-posted', 'GASTO', '2026-08-01T00:00:00.000Z', 'Q1', 'super', '2026-08-01T00:00:00.000Z', 'POSTED');
      INSERT INTO transaction_splits (id, transaction_id, account_id, fund_id, person_id, card_id, amount_cents, role)
      VALUES ('split-1', 'tx-posted', 'acc-barras', 'fund-super', NULL, NULL, -500, 'SOURCE');
      INSERT INTO transaction_splits (id, transaction_id, account_id, fund_id, person_id, card_id, amount_cents, role)
      VALUES ('split-2', 'tx-posted', NULL, NULL, NULL, NULL, 500, 'EQUITY');
    `);

    expect(() => db.exec('DELETE FROM transactions')).toThrow(/FOREIGN KEY/i);

    for (const table of DOMAIN_DELETE_ORDER) {
      db.exec(`DELETE FROM ${table}`);
    }
    expect(db.exec('SELECT COUNT(*) FROM transactions')[0].values[0][0]).toBe(0);
    expect(db.exec('SELECT COUNT(*) FROM transaction_splits')[0].values[0][0]).toBe(0);

    expect(() => {
      for (const table of DOMAIN_DELETE_ORDER) {
        db.exec(`DELETE FROM ${table}`);
      }
    }).not.toThrow();
    db.close();
  });

  it('SCHEMA actual ya trae las columnas legacy; ensureLegacyColumns no ALTERA', async () => {
    const SQL = await sqlEngine();
    const db = new SQL.Database();
    db.exec(SCHEMA_SQL);
    const jeep = asJeepMigrationDb(db);
    expect(await dbTableExists(jeep, 'funds')).toBe(true);
    await expect(ensureLegacyColumns(jeep)).resolves.toBeUndefined();
    db.close();
  });
});
