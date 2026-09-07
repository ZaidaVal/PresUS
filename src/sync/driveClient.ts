import { DRIVE_BACKUPS_FOLDER, DRIVE_FOLDER_NAME, requestAccessToken } from './driveAuth';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export type DriveFile = {
  id: string;
  name: string;
  modifiedTime?: string;
};

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await requestAccessToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Drive ${response.status}: ${body || response.statusText}`);
  }
  return response;
}

async function findChild(name: string, mimeType: string, parentId?: string): Promise<DriveFile | undefined> {
  const escaped = name.replace(/'/g, "\\'");
  const parts = [`name = '${escaped}'`, `mimeType = '${mimeType}'`, 'trashed = false'];
  if (parentId) parts.push(`'${parentId}' in parents`);
  const q = encodeURIComponent(parts.join(' and '));
  const response = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name,modifiedTime)&pageSize=10`);
  const data = (await response.json()) as { files?: DriveFile[] };
  return data.files?.[0];
}

async function createFolder(name: string, parentId?: string): Promise<DriveFile> {
  const body: { name: string; mimeType: string; parents?: string[] } = { name, mimeType: FOLDER_MIME };
  if (parentId) body.parents = [parentId];
  const response = await driveFetch(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await response.json()) as DriveFile;
}

async function ensureFolder(name: string, parentId?: string): Promise<DriveFile> {
  const existing = await findChild(name, FOLDER_MIME, parentId);
  if (existing) return existing;
  return createFolder(name, parentId);
}

export async function ensureFolders(): Promise<{ rootId: string; backupsId: string }> {
  const root = await ensureFolder(DRIVE_FOLDER_NAME);
  const backups = await ensureFolder(DRIVE_BACKUPS_FOLDER, root.id);
  return { rootId: root.id, backupsId: backups.id };
}

export async function uploadBackup(name: string, contents: string, parentId: string): Promise<DriveFile> {
  const metadata = JSON.stringify({
    name,
    parents: [parentId],
    mimeType: 'application/octet-stream',
  });
  const boundary = `finanzasza_${crypto.randomUUID()}`;
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: application/octet-stream',
    '',
    contents,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const response = await driveFetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,modifiedTime`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const file = (await response.json()) as DriveFile;
  if (!file.id) throw new Error('Drive no confirmó el fileId');
  return file;
}

export async function findBackup(name: string, parentId: string): Promise<DriveFile | undefined> {
  const escaped = name.replace(/'/g, "\\'");
  const q = encodeURIComponent(`name = '${escaped}' and '${parentId}' in parents and trashed = false`);
  const response = await driveFetch(`${DRIVE_API}/files?q=${q}&fields=files(id,name,modifiedTime)&pageSize=5`);
  const data = (await response.json()) as { files?: DriveFile[] };
  return data.files?.[0];
}

export async function updateBackup(fileId: string, contents: string): Promise<DriveFile> {
  const response = await driveFetch(
    `${DRIVE_UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: contents,
    },
  );
  const file = (await response.json()) as DriveFile;
  if (!file.id) throw new Error('Drive no confirmó la actualización');
  return file;
}

export async function listBackups(parentId: string): Promise<DriveFile[]> {
  const q = encodeURIComponent(`'${parentId}' in parents and trashed = false`);
  const response = await driveFetch(
    `${DRIVE_API}/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=50`,
  );
  const data = (await response.json()) as { files?: DriveFile[] };
  return data.files ?? [];
}

export async function downloadBackup(fileId: string): Promise<string> {
  const response = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`);
  return response.text();
}

export const httpDriveClient = {
  ensureFolders,
  uploadBackup,
  findBackup,
  updateBackup,
  listBackups,
  downloadBackup,
};
