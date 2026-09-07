import { DomainError, type DomainDump, type Ledger, type LedgerTx } from '../domain/ledger';
import type { BackupPayload } from './backupTypes';
import { getSecureStore } from '../security/secureStore';

export const BACKUP_FORMAT = 'finanzas-za-backup';
export const SUPPORTED_SCHEMA_VERSION = 1;
export const PREVENTIVE_BACKUP_KEY = 'preventive.backup.json';

const SECRET_META = /token|secret|password|pin|oauth|access|refresh|apikey|api[_-]?key|client_secret/i;

const META_ALLOWLIST = new Set([
  'schema_version',
  'device_id',
  'seeded',
  'catalog_initialized',
  'factory_empty_v1',
  'drive_folder_id',
  'drive_backups_folder_id',
  'last_backup_at',
  'last_backup_file_id',
  'dashboard_prefs',
  'savings_classified',
  'atlantida_credit_model',
  'two_savings_accounts',
  'budget_item_shares',
  'budget_cutoffs',
  'last_cutoff_at',
  'release_destination_account_ids',
  'coherent_clean_seed_v1',
  'explicit_empty_book_v1',
]);

const PRESERVE_ON_RESTORE = [
  'device_id',
  'drive_folder_id',
  'drive_backups_folder_id',
  'last_backup_at',
  'last_backup_file_id',
  'factory_empty_v1',
] as const;

export function isSecretMetaKey(key: string): boolean {
  return SECRET_META.test(key);
}

export function sanitizeMeta(meta: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (isSecretMetaKey(key)) continue;
    if (!META_ALLOWLIST.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}

export async function exportBackup(tx: LedgerTx): Promise<BackupPayload> {
  const [
    meta,
    people,
    accounts,
    funds,
    transactions,
    splits,
    reservations,
    budgetItems,
    creditCards,
    cardCharges,
    debts,
    debtPayments,
  ] = await Promise.all([
    tx.listMeta(),
    tx.listPeople(),
    tx.listAccounts(),
    tx.listFunds(),
    tx.listTransactions(),
    tx.listSplits(),
    tx.listReservations(),
    tx.listBudgetItems(),
    tx.listCreditCards(),
    tx.listCardCharges(),
    tx.listDebts(),
    tx.listDebtPayments(),
  ]);
  const schemaVersion = Number(meta.schema_version ?? SUPPORTED_SCHEMA_VERSION);
  return {
    format: BACKUP_FORMAT,
    schemaVersion,
    exportedAt: new Date().toISOString(),
    meta: sanitizeMeta(meta),
    people,
    accounts,
    funds,
    transactions,
    splits,
    reservations,
    budgetItems,
    creditCards,
    cardCharges,
    debts,
    debtPayments,
  };
}

export function validateBackup(payload: BackupPayload): void {
  if (payload.format !== BACKUP_FORMAT) {
    throw new DomainError('El archivo no es un respaldo de PresUS');
  }
  if (payload.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    throw new DomainError(`schemaVersion no soportado: ${payload.schemaVersion}`);
  }
  if (!Array.isArray(payload.people) || !Array.isArray(payload.accounts) || !Array.isArray(payload.funds)) {
    throw new DomainError('El respaldo no tiene el catálogo mínimo');
  }
  if (!Array.isArray(payload.transactions) || !Array.isArray(payload.splits)) {
    throw new DomainError('El respaldo no tiene historial de movimientos');
  }
  if (!Array.isArray(payload.reservations) || !Array.isArray(payload.budgetItems)) {
    throw new DomainError('El respaldo no tiene reservas o presupuesto');
  }
  if (!payload.people.some((row) => row.code === 'Z') || !payload.people.some((row) => row.code === 'A')) {
    throw new DomainError('El respaldo debe incluir a Z y A');
  }
}

export function assertPostedSplitsBalance(payload: BackupPayload) {
  const posted = new Set(payload.transactions.filter((row) => row.status === 'POSTED').map((row) => row.id));
  const sums = new Map<string, number>();
  for (const split of payload.splits) {
    if (!posted.has(split.transactionId)) continue;
    sums.set(split.transactionId, (sums.get(split.transactionId) ?? 0) + split.amountCents);
  }
  for (const [id, total] of sums) {
    if (total !== 0) {
      throw new DomainError(`Integridad rota: splits de ${id} no suman 0`);
    }
  }
}

function toDump(payload: BackupPayload, preserved: Record<string, string>): DomainDump {
  return {
    meta: sanitizeMeta({
      ...payload.meta,
      schema_version: String(payload.schemaVersion),
      ...preserved,
    }),
    people: payload.people,
    accounts: payload.accounts,
    funds: payload.funds,
    transactions: payload.transactions,
    splits: payload.splits,
    reservations: payload.reservations,
    budgetItems: payload.budgetItems,
    creditCards: payload.creditCards ?? [],
    cardCharges: payload.cardCharges ?? [],
    debts: payload.debts ?? [],
    debtPayments: payload.debtPayments ?? [],
  };
}

export async function assertRestoredIntegrity(tx: LedgerTx) {
  const people = await tx.listPeople();
  if (!people.some((row) => row.code === 'Z') || !people.some((row) => row.code === 'A')) {
    throw new DomainError('Tras restaurar faltan Z o A');
  }
  const transactions = await tx.listTransactions();
  const splits = await tx.listSplits();
  assertPostedSplitsBalance({
    format: BACKUP_FORMAT,
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    exportedAt: '',
    meta: {},
    people,
    accounts: [],
    funds: [],
    transactions,
    splits,
    reservations: [],
    budgetItems: [],
  });
}

export async function restoreFromBackup(
  ledger: Ledger,
  payload: BackupPayload,
  options?: { savePreventive?: (json: string) => Promise<void> },
): Promise<void> {
  validateBackup(payload);
  assertPostedSplitsBalance(payload);

  const current = await ledger.withTransaction((tx) => exportBackup(tx));
  const preserved: Record<string, string> = {};
  for (const key of PRESERVE_ON_RESTORE) {
    const value = current.meta[key];
    if (value) preserved[key] = value;
  }

  const savePreventive = options?.savePreventive ?? defaultSavePreventive;
  await savePreventive(JSON.stringify(current));

  await ledger.withTransaction(async (tx) => {
    await tx.replaceDomain(toDump(payload, preserved));
    await assertRestoredIntegrity(tx);
  });
}

async function defaultSavePreventive(json: string) {
  await getSecureStore().set(PREVENTIVE_BACKUP_KEY, json);
}

export function backupFileName(at = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `finanzas-za-${at.getUTCFullYear()}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}.json`;
}

export const LATEST_BACKUP_NAME = 'finanzas-za-latest.json';

export async function parseBackupFile(raw: string): Promise<BackupPayload> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DomainError('El archivo de Drive no es JSON válido');
  }
  const record = parsed as BackupPayload & { alg?: string };
  if (record?.alg === 'AES-GCM') {
    throw new DomainError('Este archivo es un respaldo antiguo cifrado. Genera uno nuevo desde la app.');
  }
  if (record?.format === BACKUP_FORMAT) {
    validateBackup(record);
    return record;
  }
    throw new DomainError('El archivo no es un respaldo de PresUS');
}

export type BackupResult =
  | { ok: true; fileId: string; fileName: string }
  | { ok: false; error: string };

export type DriveBackupClient = {
  ensureFolders(): Promise<{ rootId: string; backupsId: string }>;
  uploadBackup(name: string, contents: string, parentId: string): Promise<{ id: string; name: string }>;
  findBackup?(name: string, parentId: string): Promise<{ id: string; name: string } | undefined>;
  updateBackup?(fileId: string, contents: string): Promise<{ id: string; name: string }>;
  downloadBackup?(fileId: string): Promise<string>;
};

const DATED_SNAPSHOT = /^finanzas-za-\d{8}-\d{6}\.json$/;

export function isDatedSnapshotName(name: string): boolean {
  return DATED_SNAPSHOT.test(name);
}

export type BackupToDriveOptions = {
  /** Copia con fecha. Solo al pulsar Generar respaldo. El latest siempre se sobrescribe. */
  snapshot?: boolean;
};

async function upsertLatest(
  drive: DriveBackupClient,
  parentId: string,
  contents: string,
): Promise<{ id: string; name: string }> {
  if (drive.findBackup && drive.updateBackup) {
    const existing = await drive.findBackup(LATEST_BACKUP_NAME, parentId);
    if (existing?.id) return drive.updateBackup(existing.id, contents);
  }
  return drive.uploadBackup(LATEST_BACKUP_NAME, contents, parentId);
}

export async function backupToDrive(
  ledger: Ledger,
  drive: DriveBackupClient,
  options?: BackupToDriveOptions,
): Promise<BackupResult> {
  try {
    const payload = await ledger.withTransaction((tx) => exportBackup(tx));
    for (const key of Object.keys(payload.meta)) {
      if (isSecretMetaKey(key)) throw new DomainError('El respaldo no puede incluir secretos');
    }
    const contents = JSON.stringify(payload);
    const folders = await drive.ensureFolders();
    const latest = await upsertLatest(drive, folders.backupsId, contents);
    if (!latest.id) throw new DomainError('Drive no confirmó el archivo');
    let snapshotId: string | undefined;
    if (options?.snapshot) {
      const snapshot = await drive.uploadBackup(backupFileName(), contents, folders.backupsId);
      if (!snapshot.id) throw new DomainError('Drive no confirmó el snapshot');
      snapshotId = snapshot.id;
    }
    await ledger.withTransaction(async (tx) => {
      await tx.setMeta('drive_folder_id', folders.rootId);
      await tx.setMeta('drive_backups_folder_id', folders.backupsId);
      await tx.setMeta('last_backup_at', new Date().toISOString());
      await tx.setMeta('last_backup_file_id', latest.id);
      if (snapshotId) await tx.setMeta('last_backup_snapshot_id', snapshotId);
    });
    return { ok: true, fileId: latest.id, fileName: latest.name };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
