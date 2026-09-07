import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryLedger } from '../domain/memoryLedger';
import { postAjuste, postGasto } from '../domain/posting';
import { DomainError } from '../domain/ledger';
import {
  backupToDrive,
  exportBackup,
  parseBackupFile,
  restoreFromBackup,
  sanitizeMeta,
  isSecretMetaKey,
  isDatedSnapshotName,
  LATEST_BACKUP_NAME,
  type DriveBackupClient,
} from './backup';
import * as backupModule from './backup';
import type { BackupPayload } from './backupTypes';
import { useFinance } from '../stores/financeStore';
import {
  configureLatestPushForTests,
  markAccessPullFinished,
  pullLatestAndRestore,
  resetAccessSyncForTests,
  scheduleLatestPush,
  syncOnAccess,
} from './accessSync';
import { EMPTY_BOOK_PENDING_PUSH_KEY, EXPLICIT_EMPTY_BOOK_META, IDS, seedIfNeeded } from '../database/seed';

async function seededLedger() {
  const ledger = new MemoryLedger();
  await ledger.withTransaction(async (tx) => {
    await tx.setMeta('schema_version', '1');
    await tx.setMeta('device_id', 'device-local');
    await tx.setMeta('oauth_access_token', 'SECRET-TOKEN');
    await tx.setMeta('refresh_token', 'SECRET-REFRESH');
    await tx.setMeta('client_secret', 'SECRET-CLIENT');
    await tx.insertPerson({ id: 'z', code: 'Z', displayName: 'Z' });
    await tx.insertPerson({ id: 'a', code: 'A', displayName: 'A' });
    await tx.insertAccount({
      id: 'barras',
      name: 'Barras',
      kind: 'BANK',
      visibility: 'PUBLIC',
      ownerPersonId: null,
      countsAsLiquidity: true,
      isCardPaymentSource: false,
    });
    await tx.insertFund({
      id: 'casa',
      accountId: 'barras',
      name: 'Casa',
      purpose: 'Vivienda',
      targetAmountCents: null,
      priority: 1,
      segment: 'OPERATING',
    });
    await postAjuste(tx, { accountId: 'barras', amountCents: 100000, note: 'apertura' });
  });
  return ledger;
}

describe('export backup', () => {
  it('drops OAuth secrets and does not embed a client id', async () => {
    expect(isSecretMetaKey('oauth_access_token')).toBe(true);
    expect(sanitizeMeta({ oauth_access_token: 'SECRET', schema_version: '1' })).toEqual({
      schema_version: '1',
    });
    expect(
      sanitizeMeta({ dashboard_prefs: '{"showHero":true}', oauth_access_token: 'SECRET', schema_version: '1' }),
    ).toEqual({
      dashboard_prefs: '{"showHero":true}',
      schema_version: '1',
    });
    const ledger = await seededLedger();
    const payload = await ledger.withTransaction((tx) => exportBackup(tx));
    const dumped = JSON.stringify(payload);
    expect(dumped).not.toContain('SECRET');
    expect(dumped).not.toContain('oauth_access_token');
    expect(dumped).not.toContain('refresh_token');
    expect(dumped).not.toContain('client_secret');
    expect(dumped).not.toContain('apps.googleusercontent.com');
    expect(payload.schemaVersion).toBe(1);
    expect(payload.transactions).toHaveLength(1);
  });

  it('round-trips export into another ledger without secrets', async () => {
    const source = await seededLedger();
    const payload = await source.withTransaction((tx) => exportBackup(tx));
    const target = new MemoryLedger();
    await restoreFromBackup(target, payload, { savePreventive: async () => {} });
    await target.withTransaction(async (tx) => {
      expect(await tx.listPeople()).toHaveLength(2);
      expect((await tx.listPostedSplitsForAccount('barras')).length).toBeGreaterThan(0);
      const meta = await tx.listMeta();
      expect(meta.oauth_access_token).toBeUndefined();
    });
  });
});

describe('restore', () => {
  it('does not touch data when schemaVersion is unknown', async () => {
    const ledger = await seededLedger();
    const payload = await ledger.withTransaction((tx) => exportBackup(tx));
    const bad: BackupPayload = { ...payload, schemaVersion: 99 };
    await expect(restoreFromBackup(ledger, bad, { savePreventive: async () => {} })).rejects.toBeInstanceOf(
      DomainError,
    );
    await ledger.withTransaction(async (tx) => {
      expect(await tx.listTransactions()).toHaveLength(1);
    });
  });

  it('rolls back if restore fails halfway', async () => {
    const ledger = await seededLedger();
    const original = await ledger.withTransaction((tx) => exportBackup(tx));
    const other = structuredClone(original);
    other.accounts[0] = { ...other.accounts[0], name: 'Cambiada' };
    await expect(
      ledger.withTransaction(async (tx) => {
        await tx.replaceDomain({
          meta: other.meta,
          people: other.people,
          accounts: other.accounts,
          funds: other.funds,
          transactions: other.transactions,
          splits: other.splits,
          reservations: other.reservations,
          budgetItems: other.budgetItems,
          creditCards: other.creditCards ?? [],
          cardCharges: other.cardCharges ?? [],
          debts: other.debts ?? [],
          debtPayments: other.debtPayments ?? [],
        });
        throw new Error('fallo a mitad');
      }),
    ).rejects.toThrow('fallo a mitad');
    const after = await ledger.withTransaction((tx) => exportBackup(tx));
    expect(after.accounts[0]?.name).toBe('Barras');
    expect(after.transactions).toHaveLength(original.transactions.length);
  });

  it('saves a preventive local backup before a successful restore', async () => {
    const ledger = await seededLedger();
    let preventive = '';
    const payload = await ledger.withTransaction((tx) => exportBackup(tx));
    const clone: BackupPayload = structuredClone(payload);
    clone.accounts[0] = { ...clone.accounts[0], name: 'Barras restaurada' };
    await restoreFromBackup(ledger, clone, { savePreventive: async (json) => { preventive = json; } });
    expect(preventive).toContain('Barras');
    expect(preventive).not.toContain('Barras restaurada');
    await ledger.withTransaction(async (tx) => {
      expect((await tx.getAccount('barras'))?.name).toBe('Barras restaurada');
    });
  });

  it('keeps factory_empty_v1 so init does not wipe a restored book', async () => {
    const ledger = await seededLedger();
    await ledger.withTransaction(async (tx) => {
      await tx.setMeta('factory_empty_v1', '1');
    });
    const payload = await ledger.withTransaction((tx) => exportBackup(tx));
    const clone: BackupPayload = structuredClone(payload);
    delete clone.meta.factory_empty_v1;
    clone.accounts[0] = { ...clone.accounts[0], name: 'Barras desde Drive' };
    await restoreFromBackup(ledger, clone, { savePreventive: async () => {} });
    await ledger.withTransaction(async (tx) => {
      expect(await tx.getMeta('factory_empty_v1')).toBe('1');
      expect((await tx.getAccount('barras'))?.name).toBe('Barras desde Drive');
    });
  });
});

describe('Drive no bloquea lo local', () => {
  it('keeps posted movements when Drive upload fails', async () => {
    const ledger = await seededLedger();
    const failing: DriveBackupClient = {
      async ensureFolders() {
        throw new Error('red caída');
      },
      async uploadBackup() {
        throw new Error('red caída');
      },
    };
    const result = await backupToDrive(ledger, failing);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/red caída/);
    await ledger.withTransaction(async (tx) => {
      expect(await tx.listTransactions()).toHaveLength(1);
      await postGasto(tx, { accountId: 'barras', amountCents: 5000, note: 'sigue local' });
      expect(await tx.listTransactions()).toHaveLength(2);
    });
  });

  it('marks success only after Drive returns a fileId', async () => {
    const ledger = await seededLedger();
    const drive: DriveBackupClient = {
      async ensureFolders() {
        return { rootId: 'root', backupsId: 'backups' };
      },
      async uploadBackup() {
        return { id: '', name: 'x.json.enc' };
      },
    };
    const result = await backupToDrive(ledger, drive);
    expect(result.ok).toBe(false);
    await ledger.withTransaction(async (tx) => {
      expect(await tx.getMeta('last_backup_file_id')).toBeUndefined();
    });
  });

  it('uploads JSON without secrets and without extra credentials', async () => {
    const ledger = await seededLedger();
    const uploaded: string[] = [];
    const drive: DriveBackupClient = {
      async ensureFolders() {
        return { rootId: 'root', backupsId: 'backups' };
      },
      async uploadBackup(name, contents) {
        uploaded.push(contents);
        return { id: `id-${uploaded.length}`, name };
      },
    };
    const result = await backupToDrive(ledger, drive);
    expect(result.ok).toBe(true);
    expect(uploaded[0]).toContain('apertura');
    expect(uploaded[0]).not.toContain('SECRET');
    const parsed = await parseBackupFile(uploaded[0]!);
    expect(parsed.transactions).toHaveLength(1);
  });
});

function memoryDrive(initial: Record<string, string> = {}) {
  const files = new Map<string, { id: string; name: string; contents: string }>();
  const uploadedNames: string[] = [];
  for (const [name, contents] of Object.entries(initial)) {
    files.set(name, { id: `id-${name}`, name, contents });
  }
  const client: DriveBackupClient & {
    uploadedNames: string[];
    getContents: (name: string) => string | undefined;
    findBackup: NonNullable<DriveBackupClient['findBackup']>;
    downloadBackup: NonNullable<DriveBackupClient['downloadBackup']>;
    updateBackup: NonNullable<DriveBackupClient['updateBackup']>;
  } = {
    uploadedNames,
    getContents(name) {
      return files.get(name)?.contents;
    },
    async ensureFolders() {
      return { rootId: 'root', backupsId: 'backups' };
    },
    async uploadBackup(name, contents) {
      uploadedNames.push(name);
      const row = { id: `up-${name}-${uploadedNames.length}`, name, contents };
      files.set(name, row);
      return { id: row.id, name };
    },
    async findBackup(name) {
      const row = files.get(name);
      return row ? { id: row.id, name: row.name } : undefined;
    },
    async updateBackup(fileId, contents) {
      for (const row of files.values()) {
        if (row.id === fileId) {
          row.contents = contents;
          return { id: row.id, name: row.name };
        }
      }
      throw new Error('no está el archivo');
    },
    async downloadBackup(fileId) {
      for (const row of files.values()) {
        if (row.id === fileId) return row.contents;
      }
      throw new Error('no está el archivo');
    },
  };
  return client;
}

describe('respaldo latest vs snapshot', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetAccessSyncForTests();
    useFinance.setState({ ledger: null, ready: false });
  });

  it('no hay upload al postear; generar respaldo sí crea snapshot fechado', async () => {
    const ledger = await seededLedger();
    const drive = memoryDrive();

    await ledger.withTransaction(async (tx) => {
      await postGasto(tx, { accountId: 'barras', amountCents: 5000, note: 'sin Drive' });
    });
    expect(drive.uploadedNames).toHaveLength(0);

    const latestOnly = await backupToDrive(ledger, drive, { snapshot: false });
    expect(latestOnly.ok).toBe(true);
    expect(drive.uploadedNames.filter(isDatedSnapshotName)).toHaveLength(0);

    const withSnapshot = await backupToDrive(ledger, drive, { snapshot: true });
    expect(withSnapshot.ok).toBe(true);
    expect(drive.uploadedNames.filter(isDatedSnapshotName)).toHaveLength(1);
    expect(drive.uploadedNames.some((name) => name === LATEST_BACKUP_NAME || !isDatedSnapshotName(name))).toBe(true);
  });

  it('un cambio local no crea snapshot fechado; el debounce solo actualiza latest', async () => {
    vi.useFakeTimers();
    const ledger = await seededLedger();
    const drive = memoryDrive();
    const backup = vi.fn(backupToDrive);
    configureLatestPushForTests({
      backup,
      drive,
      peek: () => 'mem-token',
      delayMs: 8_000,
    });
    markAccessPullFinished();
    scheduleLatestPush(ledger);
    await ledger.withTransaction(async (tx) => {
      await postGasto(tx, { accountId: 'barras', amountCents: 2500, note: 'solo local' });
    });
    scheduleLatestPush(ledger);
    expect(backup).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(backup).toHaveBeenCalledTimes(1);
    expect(backup).toHaveBeenCalledWith(ledger, drive, { snapshot: false });
    const result = await backup.mock.results[0]?.value;
    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(drive.uploadedNames.filter(isDatedSnapshotName)).toHaveLength(0);
    vi.useRealTimers();
  });

  it('refrescar el libro tras un movimiento no espera a Drive', async () => {
    const spy = vi.spyOn(backupModule, 'backupToDrive');
    const ledger = await seededLedger();
    await useFinance.getState().setLedger(ledger);
    await ledger.withTransaction(async (tx) => {
      await postGasto(tx, { accountId: 'barras', amountCents: 2500, note: 'solo local' });
    });
    await useFinance.getState().refresh();
    expect(spy).not.toHaveBeenCalled();
    expect(useFinance.getState().transactions.length).toBeGreaterThanOrEqual(2);
  });

  it('restaurar no sube un respaldo extra a Drive', async () => {
    const spy = vi.spyOn(backupModule, 'backupToDrive');
    const ledger = await seededLedger();
    const payload = await ledger.withTransaction((tx) => exportBackup(tx));
    const clone: BackupPayload = structuredClone(payload);
    clone.accounts[0] = { ...clone.accounts[0], name: 'Barras restaurada' };
    await restoreFromBackup(ledger, clone, { savePreventive: async () => {} });
    await useFinance.getState().setLedger(ledger);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('acceso correcto trae latest', () => {
  afterEach(() => {
    resetAccessSyncForTests();
  });

  it('con latest en Drive el libro local queda igual al snapshot', async () => {
    const local = await seededLedger();
    const payload = await local.withTransaction((tx) => exportBackup(tx));
    const clone: BackupPayload = structuredClone(payload);
    clone.accounts[0] = { ...clone.accounts[0], name: 'Barras desde Drive' };
    const drive = memoryDrive({ [LATEST_BACKUP_NAME]: JSON.stringify(clone) });
    const result = await pullLatestAndRestore(local, drive);
    expect(result).toEqual({ ok: true, kind: 'restored' });
    await local.withTransaction(async (tx) => {
      expect((await tx.getAccount('barras'))?.name).toBe('Barras desde Drive');
      expect(await tx.listTransactions()).toHaveLength(clone.transactions.length);
    });
  });

  it('si el restore falla el libro local queda como antes (rollback)', async () => {
    const local = await seededLedger();
    const payload = await local.withTransaction((tx) => exportBackup(tx));
    const clone: BackupPayload = structuredClone(payload);
    clone.accounts[0] = { ...clone.accounts[0], name: 'No debe quedar' };
    const drive = memoryDrive({ [LATEST_BACKUP_NAME]: JSON.stringify(clone) });
    const originalReplace = local.withTransaction.bind(local);
    let sawReplace = false;
    local.withTransaction = async (fn) =>
      originalReplace(async (tx) => {
        const replace = tx.replaceDomain.bind(tx);
        tx.replaceDomain = async (data) => {
          await replace(data);
          sawReplace = true;
          throw new Error('fallo a mitad');
        };
        return fn(tx);
      });
    const result = await pullLatestAndRestore(local, drive);
    expect(sawReplace).toBe(true);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('error');
    local.withTransaction = originalReplace;
    await local.withTransaction(async (tx) => {
      expect((await tx.getAccount('barras'))?.name).toBe('Barras');
    });
  });

  it('sin red se puede postear local y no se restaura', async () => {
    const ledger = await seededLedger();
    const drive = memoryDrive();
    drive.ensureFolders = async () => {
      throw new Error('red caída');
    };
    const pulled = await pullLatestAndRestore(ledger, drive);
    expect(pulled.ok).toBe(false);
    if (!pulled.ok) expect(pulled.kind).toBe('unreachable');
    await ledger.withTransaction(async (tx) => {
      await postGasto(tx, { accountId: 'barras', amountCents: 5000, note: 'offline' });
      expect(await tx.listTransactions()).toHaveLength(2);
    });
  });

  it('POSTED solo en local se sustituye: al acceder gana Drive', async () => {
    const remote = await seededLedger();
    const payload = await remote.withTransaction((tx) => exportBackup(tx));
    const local = await seededLedger();
    await local.withTransaction(async (tx) => {
      await postGasto(tx, { accountId: 'barras', amountCents: 3300, note: 'solo aquí' });
    });
    const drive = memoryDrive({ [LATEST_BACKUP_NAME]: JSON.stringify(payload) });
    const result = await pullLatestAndRestore(local, drive);
    expect(result).toEqual({ ok: true, kind: 'restored' });
    await local.withTransaction(async (tx) => {
      expect(await tx.listTransactions()).toHaveLength(payload.transactions.length);
      const notes = (await tx.listTransactions()).map((row) => row.note);
      expect(notes.join(' ')).not.toContain('solo aquí');
    });
  });
});

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem(key: string) {
      return data[key] ?? null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
    removeItem(key: string) {
      delete data[key];
    },
  };
}

async function emptyBookLedger() {
  const ledger = new MemoryLedger();
  await ledger.withTransaction(async (tx) => {
    await tx.setMeta('schema_version', '1');
    await tx.setMeta('device_id', 'device-empty');
    await tx.setMeta(EXPLICIT_EMPTY_BOOK_META, '1');
    await tx.insertPerson({ id: 'z', code: 'Z', displayName: 'Z' });
    await tx.insertPerson({ id: 'a', code: 'A', displayName: 'A' });
  });
  return ledger;
}

async function dirtyPresUsLedger() {
  const ledger = new MemoryLedger();
  await ledger.withTransaction(async (tx) => {
    await tx.setMeta('schema_version', '1');
    await tx.setMeta('device_id', 'device-drive');
    await tx.insertPerson({ id: 'z', code: 'Z', displayName: 'Z' });
    await tx.insertPerson({ id: 'a', code: 'A', displayName: 'A' });
    await tx.insertAccount({
      id: 'acc-ahorro',
      name: 'Ahorros',
      kind: 'BANK',
      visibility: 'PUBLIC',
      ownerPersonId: null,
      countsAsLiquidity: true,
      isCardPaymentSource: false,
    });
    await tx.insertFund({
      id: 'fund-ahorro-general',
      accountId: 'acc-ahorro',
      name: 'Ahorros',
      purpose: 'PresUS',
      targetAmountCents: null,
      priority: 1,
      segment: 'SAVINGS',
    });
    await postAjuste(tx, { accountId: 'acc-ahorro', amountCents: 85000, note: 'PresUS Ahorros $850' });
  });
  return ledger;
}

describe('acceso con wipe vacío pendiente vs pull', () => {
  afterEach(() => {
    resetAccessSyncForTests();
  });

  it('pending empty + latest sucio: PUSH vacío, no restore, Drive latest queda empty', async () => {
    const local = await emptyBookLedger();
    const dirty = await dirtyPresUsLedger();
    const dirtyJson = JSON.stringify(await dirty.withTransaction((tx) => exportBackup(tx)));
    const drive = memoryDrive({ [LATEST_BACKUP_NAME]: dirtyJson });
    const storage = memoryStorage({ [EMPTY_BOOK_PENDING_PUSH_KEY]: '1' });

    const result = await syncOnAccess(local, drive, storage);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe('pushed-empty');
    expect(storage.getItem(EMPTY_BOOK_PENDING_PUSH_KEY)).toBeNull();
    expect(drive.uploadedNames.filter(isDatedSnapshotName)).toHaveLength(0);

    await local.withTransaction(async (tx) => {
      expect(await tx.listAccounts()).toEqual([]);
      expect(await tx.listFunds()).toEqual([]);
      expect(await tx.listTransactions()).toEqual([]);
      expect((await tx.listPeople()).map((row) => row.code).sort()).toEqual(['A', 'Z']);
    });

    const latestRaw = drive.getContents(LATEST_BACKUP_NAME);
    expect(latestRaw).toBeTruthy();
    const latest = await parseBackupFile(latestRaw!);
    expect(latest.accounts).toHaveLength(0);
    expect(latest.funds).toHaveLength(0);
    expect(latest.transactions).toHaveLength(0);
    expect(JSON.stringify(latest)).not.toContain('PresUS');
    expect(JSON.stringify(latest)).not.toContain('85000');
  });

  it('sin pending, pull restaura el latest sucio de Drive', async () => {
    const local = await emptyBookLedger();
    const dirty = await dirtyPresUsLedger();
    const dirtyPayload = await dirty.withTransaction((tx) => exportBackup(tx));
    const drive = memoryDrive({ [LATEST_BACKUP_NAME]: JSON.stringify(dirtyPayload) });
    const storage = memoryStorage();

    const result = await syncOnAccess(local, drive, storage);

    expect(result).toEqual({ ok: true, kind: 'restored' });
    await local.withTransaction(async (tx) => {
      expect((await tx.getAccount('acc-ahorro'))?.name).toBe('Ahorros');
      const txs = await tx.listTransactions();
      expect(txs.some((row) => row.note?.includes('PresUS'))).toBe(true);
      expect((await tx.listSplits()).some((split) => split.amountCents === 85000 || split.amountCents === -85000)).toBe(
        true,
      );
    });
  });

  it('pending + libro local: PUSH el local, no restaura el sucio ni sube vacío', async () => {
    const local = new MemoryLedger();
    await seedIfNeeded(local);
    await local.withTransaction(async (tx) => {
      await tx.insertAccount({
        id: IDS.accounts.barras,
        name: 'Barras',
        kind: 'BANK',
        visibility: 'PUBLIC',
        ownerPersonId: null,
        countsAsLiquidity: true,
        isCardPaymentSource: false,
      });
      await postAjuste(tx, { accountId: IDS.accounts.barras, amountCents: 1000, note: 'apertura' });
    });
    const storage = memoryStorage({ [EMPTY_BOOK_PENDING_PUSH_KEY]: '1' });

    const dirty = await dirtyPresUsLedger();
    const dirtyJson = JSON.stringify(await dirty.withTransaction((tx) => exportBackup(tx)));
    const drive = memoryDrive({ [LATEST_BACKUP_NAME]: dirtyJson });

    const result = await syncOnAccess(local, drive, storage);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe('pushed-empty');
    expect(storage.getItem(EMPTY_BOOK_PENDING_PUSH_KEY)).toBeNull();

    const latest = await parseBackupFile(drive.getContents(LATEST_BACKUP_NAME)!);
    expect(latest.accounts.some((row) => row.id === IDS.accounts.barras)).toBe(true);
    expect(latest.accounts).not.toHaveLength(0);
    expect(JSON.stringify(latest)).not.toContain('SECRET');
  });
});
