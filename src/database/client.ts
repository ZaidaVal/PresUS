import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import { SCHEMA_SQL } from './schema';
import { SqliteLedger } from './sqliteLedger';
import {
  applyExplicitEmptyBookIfNeeded,
  applyFactoryEmptyIfNeeded,
  markFactoryFileWipeDone,
  seedIfNeeded,
  shouldWipeLegacyDatabase,
} from './seed';
import { applyPresusNuevoBootImports } from '../import/importPresusNuevo';
import { ensureLegacyColumns } from './ensureColumns';
import { ensureTransactionsAllowPagoDeuda } from './migrateTransactions';
import type { Ledger } from '../domain/ledger';
import type { SqliteExecDb } from './sqliteMeta';

const DB_NAME = 'finanzasza';
const sqlite = new SQLiteConnection(CapacitorSQLite);

type JeepSqliteEl = HTMLElement & {
  isStoreOpen: () => Promise<boolean>;
};

export async function initLocalDatabase(): Promise<Ledger> {
  const platform = Capacitor.getPlatform();

  if (platform === 'web') {
    await ensureJeepSqlite();
    await sqlite.initWebStore();
  }

  await wipeLegacySeededDatabase();

  const consistency = await sqlite.checkConnectionsConsistency();
  const connected = (await sqlite.isConnection(DB_NAME, false)).result;
  let db: SQLiteDBConnection;
  if (consistency.result && connected) {
    db = await sqlite.retrieveConnection(DB_NAME, false);
  } else {
    db = await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);
  }

  await db.open();
  const adapter: SqliteExecDb = {
    execute: (sql, transaction) => db.execute(sql, transaction),
    query: (sql) => db.query(sql),
  };
  await db.execute('PRAGMA foreign_keys = ON;', false);
  for (const statement of SCHEMA_SQL.split(';')) {
    const sql = statement.trim();
    if (sql.length === 0 || /^PRAGMA\b/i.test(sql)) continue;
    await db.execute(`${sql};`);
  }
  await ensureLegacyColumns(adapter);
  await ensureTransactionsAllowPagoDeuda(adapter);

  const persist = async () => {
    if (platform === 'web') {
      await sqlite.saveToStore(DB_NAME);
    }
  };

  const ledger = new SqliteLedger(db, persist);
  await applyFactoryEmptyIfNeeded(ledger);
  await applyExplicitEmptyBookIfNeeded(ledger);
  await seedIfNeeded(ledger);
  await applyPresusNuevoBootImports(ledger, typeof localStorage !== 'undefined' ? localStorage : null);
  await persist();
  return ledger;
}

/**
 * Recrea el archivo SQLite/IndexedDB una vez para tirar la semilla PresUS.
 * No se llama copyFromAssets (no hay plantilla en /assets/databases); jeep-sqlite
 * abre lo que ya está en IndexedDB o crea vacío. Tras restore o altas, SqliteLedger
 * vuelve a saveToStore.
 */
async function wipeLegacySeededDatabase() {
  if (typeof localStorage === 'undefined') return;
  if (!shouldWipeLegacyDatabase(localStorage)) return;

  try {
    const connected = (await sqlite.isConnection(DB_NAME, false)).result;
    if (connected) {
      await sqlite.closeConnection(DB_NAME, false);
    }
  } catch {
    /* aún no hay conexión */
  }

  try {
    const exists = (await sqlite.isDatabase(DB_NAME)).result;
    if (exists) {
      await CapacitorSQLite.deleteDatabase({ database: DB_NAME, readonly: false });
    }
  } catch {
    /* primera instalación o el store web aún no tiene el archivo */
  }

  markFactoryFileWipeDone(localStorage);
}

async function waitForJeepStore(el: JeepSqliteEl) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      if (await el.isStoreOpen()) return;
    } catch {
      /* el custom element aún no hidrató */
    }
    await new Promise((resolve) => window.setTimeout(resolve, 25));
  }
  throw new Error('El almacén IndexedDB de SQLite no abrió');
}

async function ensureJeepSqlite() {
  const jeepSqliteMod = await import('jeep-sqlite/loader');
  const defineCustomElements = jeepSqliteMod.defineCustomElements;
  const applyPolyfills = jeepSqliteMod.applyPolyfills as undefined | (() => Promise<unknown>);
  if (applyPolyfills) {
    await applyPolyfills();
  }
  await defineCustomElements(window);
  await customElements.whenDefined('jeep-sqlite');

  let el = document.querySelector('jeep-sqlite') as JeepSqliteEl | null;
  if (!el) {
    el = document.createElement('jeep-sqlite') as JeepSqliteEl;
    el.setAttribute('wasmpath', '/assets');
    el.setAttribute('autosave', 'true');
    document.body.appendChild(el);
  }
  await waitForJeepStore(el);
}
