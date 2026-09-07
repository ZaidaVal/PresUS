import { EMPTY_BOOK_PENDING_PUSH_KEY } from '../database/seed';
import type { Ledger } from '../domain/ledger';
import {
  backupToDrive,
  LATEST_BACKUP_NAME,
  parseBackupFile,
  restoreFromBackup,
  type BackupResult,
  type DriveBackupClient,
} from './backup';
import { peekAccessToken } from './driveAuth';
import { httpDriveClient } from './driveClient';

export const LATEST_PUSH_DEBOUNCE_MS = 8_000;

export type DrivePullClient = Pick<DriveBackupClient, 'ensureFolders'> & {
  findBackup(name: string, parentId: string): Promise<{ id: string; name: string } | undefined>;
  downloadBackup(fileId: string): Promise<string>;
};

export type PullLatestResult =
  | { ok: true; kind: 'restored' | 'empty' }
  | { ok: false; kind: 'unreachable' | 'error'; error: string };

export type AccessSyncStorage = {
  getItem(key: string): string | null;
  removeItem(key: string): void;
};

export type AccessSyncDrive = DriveBackupClient & DrivePullClient;

export type AccessSyncResult =
  | { ok: true; kind: 'pushed-empty'; fileId: string; fileName: string }
  | PullLatestResult;

export function isEmptyBookPendingPush(storage?: AccessSyncStorage | null): boolean {
  return storage?.getItem(EMPTY_BOOK_PENDING_PUSH_KEY) === '1';
}

/**
 * Al acceder con Google: si hay wipe vacío pendiente de subir, PUSH latest (sin snapshot)
 * y no se restaura el Drive viejo. Si no hay pending, gana Drive (pull latest).
 */
export async function syncOnAccess(
  ledger: Ledger,
  drive: AccessSyncDrive,
  storage?: AccessSyncStorage | null,
  backup: (book: Ledger, client: DriveBackupClient, options?: { snapshot?: boolean }) => Promise<BackupResult> = backupToDrive,
): Promise<AccessSyncResult> {
  if (isEmptyBookPendingPush(storage)) {
    const result = await backup(ledger, drive, { snapshot: false });
    if (!result.ok) return { ok: false, kind: 'error', error: result.error };
    storage?.removeItem(EMPTY_BOOK_PENDING_PUSH_KEY);
    return { ok: true, kind: 'pushed-empty', fileId: result.fileId, fileName: result.fileName };
  }
  return pullLatestAndRestore(ledger, drive);
}

export async function pullLatestAndRestore(
  ledger: Ledger,
  drive: DrivePullClient,
): Promise<PullLatestResult> {
  let folders: { rootId: string; backupsId: string };
  try {
    folders = await drive.ensureFolders();
  } catch (error) {
    return { ok: false, kind: 'unreachable', error: error instanceof Error ? error.message : String(error) };
  }

  let file: { id: string; name: string } | undefined;
  try {
    file = await drive.findBackup(LATEST_BACKUP_NAME, folders.backupsId);
  } catch (error) {
    return { ok: false, kind: 'unreachable', error: error instanceof Error ? error.message : String(error) };
  }
  if (!file?.id) return { ok: true, kind: 'empty' };

  let raw: string;
  try {
    raw = await drive.downloadBackup(file.id);
  } catch (error) {
    return { ok: false, kind: 'unreachable', error: error instanceof Error ? error.message : String(error) };
  }

  let payload;
  try {
    payload = await parseBackupFile(raw);
  } catch (error) {
    return { ok: false, kind: 'error', error: error instanceof Error ? error.message : String(error) };
  }

  try {
    await restoreFromBackup(ledger, payload);
  } catch (error) {
    return { ok: false, kind: 'error', error: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true, kind: 'restored' };
}

type PushDeps = {
  backup?: typeof backupToDrive;
  drive?: DriveBackupClient;
  peek?: () => string | null;
  delayMs?: number;
};

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let accessPullDone = false;
let suppressPush = false;
let skipNextSchedule = false;
let scheduledLedger: Ledger | null = null;
let pushDeps: PushDeps = {};

export function resetAccessSyncForTests() {
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  debounceTimer = null;
  accessPullDone = false;
  suppressPush = false;
  skipNextSchedule = false;
  scheduledLedger = null;
  pushDeps = {};
}

export function markAccessPullStarted() {
  suppressPush = true;
  if (debounceTimer !== null) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

export function markAccessPullFinished() {
  suppressPush = false;
  accessPullDone = true;
  skipNextSchedule = true;
}

export function configureLatestPushForTests(deps: PushDeps) {
  pushDeps = deps;
}

export function scheduleLatestPush(ledger: Ledger) {
  if (suppressPush || !accessPullDone) return;
  if (skipNextSchedule) {
    skipNextSchedule = false;
    return;
  }
  const peek = pushDeps.peek ?? peekAccessToken;
  if (!peek()) return;
  scheduledLedger = ledger;
  if (debounceTimer !== null) clearTimeout(debounceTimer);
  const delay = pushDeps.delayMs ?? LATEST_PUSH_DEBOUNCE_MS;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const book = scheduledLedger;
    if (!book) return;
    const backup = pushDeps.backup ?? backupToDrive;
    const drive = pushDeps.drive ?? httpDriveClient;
    void backup(book, drive, { snapshot: false });
  }, delay);
}
