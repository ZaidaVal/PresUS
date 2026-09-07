import { create } from 'zustand';
import type { Ledger } from '../domain/ledger';
import {
  backupToDrive,
  fetchGoogleEmail,
  httpDriveClient,
  isGoogleConfigured,
  parseBackupFile,
  peekAccessToken,
  requestAccessToken,
  restoreFromBackup,
  type DriveFile,
} from '../sync';
import {
  isEmptyBookPendingPush,
  markAccessPullFinished,
  markAccessPullStarted,
  scheduleLatestPush,
  syncOnAccess,
} from '../sync/accessSync';
import { EMPTY_BOOK_PENDING_PUSH_KEY } from '../database/seed';
import { linkAllowedEmail } from '../security/allowedEmails';
import { useLock } from './lockStore';

interface DriveState {
  configured: boolean;
  connected: boolean;
  email: string | null;
  busy: boolean;
  accessPulling: boolean;
  status: string;
  error: string | null;
  backups: DriveFile[];
  lastBackupAt: string | null;
  lastBackupFileId: string | null;
  connect: (ledger?: Ledger | null) => Promise<void>;
  refreshMeta: (ledger: Ledger) => Promise<void>;
  pullOnAccess: (ledger: Ledger) => Promise<void>;
  scheduleLatestPush: (ledger: Ledger) => void;
  backupNow: (ledger: Ledger) => Promise<void>;
  pushLatest: (ledger: Ledger) => Promise<void>;
  loadBackups: () => Promise<void>;
  restoreFile: (ledger: Ledger, fileId: string) => Promise<void>;
}

export const useDrive = create<DriveState>((set, get) => ({
  configured: isGoogleConfigured(),
  connected: Boolean(peekAccessToken()),
  email: null,
  busy: false,
  accessPulling: false,
  status: '',
  error: null,
  backups: [],
  lastBackupAt: null,
  lastBackupFileId: null,
  connect: async (ledger) => {
    set({ busy: true, error: null, status: 'Conectando con Google…' });
    try {
      const hint = useLock.getState().linkedEmail ?? undefined;
      try {
        await requestAccessToken(false, hint);
      } catch {
        await requestAccessToken(true, hint);
      }
      const email = await fetchGoogleEmail();
      const linked = await linkAllowedEmail(email);
      await httpDriveClient.ensureFolders();
      useLock.setState({ linkedEmail: linked });
      set({
        connected: true,
        email: linked,
        busy: false,
        error: null,
        status: `Vinculado ${linked}`,
      });
      if (ledger) await get().pullOnAccess(ledger);
      else await get().loadBackups();
    } catch (error) {
      set({
        busy: false,
        connected: Boolean(peekAccessToken()),
        error: error instanceof Error ? error.message : String(error),
        status: '',
      });
    }
  },
  refreshMeta: async (ledger) => {
    await ledger.withTransaction(async (tx) => {
      set({
        lastBackupAt: (await tx.getMeta('last_backup_at')) ?? null,
        lastBackupFileId: (await tx.getMeta('last_backup_file_id')) ?? null,
        configured: isGoogleConfigured(),
        connected: Boolean(peekAccessToken()),
      });
    });
  },
  pullOnAccess: async (ledger) => {
    if (!peekAccessToken()) return;
    const storage = typeof localStorage !== 'undefined' ? localStorage : null;
    const pendingEmptyPush = isEmptyBookPendingPush(storage);
    if (!pendingEmptyPush) markAccessPullStarted();
    set({
      accessPulling: !pendingEmptyPush,
      busy: true,
      error: null,
      status: pendingEmptyPush
        ? 'Subiendo el libro local a finanzas-za-latest.json…'
        : 'Trayendo finanzas-za-latest.json…',
    });
    try {
      const result = await syncOnAccess(ledger, httpDriveClient, storage);
      if (result.ok && result.kind === 'pushed-empty') {
        set({
          accessPulling: false,
          busy: false,
          connected: true,
          error: null,
          status: 'Libro local subido a finanzas-za-latest.json',
          lastBackupFileId: result.fileId,
          lastBackupAt: new Date().toISOString(),
        });
        return;
      }
      if (result.ok && result.kind === 'restored') {
        set({
          accessPulling: false,
          busy: false,
          connected: true,
          error: null,
          status: 'Libro local sustituido por el latest de Drive',
        });
        return;
      }
      if (result.ok && result.kind === 'empty') {
        set({
          accessPulling: false,
          busy: false,
          connected: true,
          status: 'Drive no tiene latest todavía. El libro local sigue; Generar respaldo crea la primera copia.',
        });
        return;
      }
      if (!result.ok && result.kind === 'unreachable') {
        set({
          accessPulling: false,
          busy: false,
          connected: Boolean(peekAccessToken()),
          error: null,
          status: `Drive no alcanzó (${result.error}). Sigues con el libro local.`,
        });
        return;
      }
      set({
        accessPulling: false,
        busy: false,
        error: !result.ok ? result.error : null,
        status: pendingEmptyPush
          ? 'Libro vacío local. No se pudo subir el latest.'
          : !result.ok
            ? 'No se restauró el latest. El libro local no se tocó.'
            : '',
      });
    } catch (error) {
      set({
        accessPulling: false,
        busy: false,
        error: error instanceof Error ? error.message : String(error),
        status: pendingEmptyPush
          ? 'Libro vacío local. No se pudo subir el latest.'
          : 'Fallo al traer Drive. El registro local sigue disponible.',
      });
    } finally {
      markAccessPullFinished();
    }
  },
  scheduleLatestPush: (ledger) => {
    scheduleLatestPush(ledger);
  },
  backupNow: async (ledger) => {
    if (!peekAccessToken()) {
      set({ error: 'Entra con Google para copiar a Drive.', status: '' });
      return;
    }
    set({ busy: true, error: null, status: 'Subiendo latest y snapshot fechado…' });
    const result = await backupToDrive(ledger, httpDriveClient, { snapshot: true });
    if (!result.ok) {
      set({ busy: false, error: result.error, status: '' });
      return;
    }
    set({
      busy: false,
      connected: true,
      error: null,
      status: `Snapshot creado y latest actualizado · ${result.fileName}`,
      lastBackupFileId: result.fileId,
      lastBackupAt: new Date().toISOString(),
    });
    await get().loadBackups();
  },
  pushLatest: async (ledger) => {
    if (!peekAccessToken()) {
      set({
        error: 'Entra con Google para subir el latest. El libro local no se toca.',
        status: '',
      });
      return;
    }
    set({ busy: true, error: null, status: 'Subiendo finanzas-za-latest.json…' });
    const result = await backupToDrive(ledger, httpDriveClient, { snapshot: false });
    if (!result.ok) {
      set({ busy: false, error: result.error, status: '' });
      return;
    }
    if (typeof localStorage !== 'undefined') localStorage.removeItem(EMPTY_BOOK_PENDING_PUSH_KEY);
    set({
      busy: false,
      connected: true,
      error: null,
      status: `Latest actualizado · ${result.fileName}`,
      lastBackupFileId: result.fileId,
      lastBackupAt: new Date().toISOString(),
    });
    await get().loadBackups();
  },
  loadBackups: async () => {
    set({ busy: true, error: null, status: 'Leyendo Drive…' });
    try {
      const folders = await httpDriveClient.ensureFolders();
      const backups = await httpDriveClient.listBackups(folders.backupsId);
      set({ backups, busy: false, connected: true, status: `${backups.length} archivo(s) en backups/` });
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
        status: '',
      });
    }
  },
  restoreFile: async (ledger, fileId) => {
    markAccessPullStarted();
    set({ busy: true, error: null, status: 'Restaurando…' });
    try {
      const raw = await httpDriveClient.downloadBackup(fileId);
      const payload = await parseBackupFile(raw);
      await restoreFromBackup(ledger, payload);
      set({ busy: false, status: 'Restaurado desde Drive' });
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
        status: '',
      });
      throw error;
    } finally {
      markAccessPullFinished();
    }
  },
}));
