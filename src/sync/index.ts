export {
  googleClientId,
  isGoogleConfigured,
  peekAccessToken,
  clearAccessToken,
  requestAccessToken,
  trySilentAccessToken,
  fetchGoogleEmail,
  DRIVE_SCOPE,
  AUTH_SCOPES,
} from './driveAuth';
export { httpDriveClient, ensureFolders, uploadBackup, listBackups, downloadBackup, findBackup, updateBackup } from './driveClient';
export type { DriveFile } from './driveClient';
export {
  exportBackup,
  restoreFromBackup,
  backupToDrive,
  validateBackup,
  sanitizeMeta,
  isSecretMetaKey,
  parseBackupFile,
  LATEST_BACKUP_NAME,
  BACKUP_FORMAT,
  SUPPORTED_SCHEMA_VERSION,
  isDatedSnapshotName,
} from './backup';
export type { BackupPayload } from './backupTypes';
export type { BackupResult, DriveBackupClient, BackupToDriveOptions } from './backup';
export {
  pullLatestAndRestore,
  syncOnAccess,
  isEmptyBookPendingPush,
  scheduleLatestPush,
  LATEST_PUSH_DEBOUNCE_MS,
  resetAccessSyncForTests,
} from './accessSync';
export type { PullLatestResult, DrivePullClient, AccessSyncResult, AccessSyncDrive } from './accessSync';
