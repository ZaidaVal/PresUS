import { getSecureStore, type KvStore } from './secureStore';

const ALLOWED_KEY = 'allowed.google.emails';
const LINKED_KEY = 'linked.google.email';
/** Correo vinculado. No es token: se puede espejar en localStorage para sobrevivir recargas. */
export const LINKED_EMAIL_LS_KEY = 'finanzasza-linked-email';

type WebStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function webStorage(): WebStorage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function readLinkedEmailFromWebStorage(storage: WebStorage | null = webStorage()): string | undefined {
  if (!storage) return undefined;
  const raw = storage.getItem(LINKED_EMAIL_LS_KEY);
  if (!raw || !raw.includes('@')) return undefined;
  return normalizeEmail(raw);
}

export function persistLinkedEmailToWebStorage(
  email: string,
  storage: WebStorage | null = webStorage(),
): void {
  if (!storage) return;
  storage.setItem(LINKED_EMAIL_LS_KEY, normalizeEmail(email));
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function parseEmailList(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,;\s]+/)) {
    const email = normalizeEmail(part);
    if (email.includes('@')) seen.add(email);
  }
  return [...seen];
}

export function envAllowedEmails(): string[] {
  return parseEmailList(import.meta.env.VITE_ALLOWED_GOOGLE_EMAILS);
}

export function isEmailAllowed(email: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  return allowlist.includes(normalizeEmail(email));
}

function store(kv?: KvStore) {
  return kv ?? getSecureStore();
}

export async function readStoredAllowlist(kv?: KvStore): Promise<string[]> {
  const raw = await store(kv).get(ALLOWED_KEY);
  return parseEmailList(raw);
}

export async function effectiveAllowlist(kv?: KvStore): Promise<string[]> {
  const fromEnv = envAllowedEmails();
  if (fromEnv.length > 0) return fromEnv;
  return readStoredAllowlist(kv);
}

export async function readLinkedEmail(kv?: KvStore): Promise<string | undefined> {
  const value = await store(kv).get(LINKED_KEY);
  if (value) {
    const normalized = normalizeEmail(value);
    persistLinkedEmailToWebStorage(normalized);
    return normalized;
  }
  return readLinkedEmailFromWebStorage();
}

export async function linkAllowedEmail(email: string, kv?: KvStore): Promise<string> {
  const normalized = normalizeEmail(email);
  if (!normalized.includes('@')) throw new Error('Correo de Google inválido');
  const fromEnv = envAllowedEmails();
  let allowlist = fromEnv.length > 0 ? fromEnv : await readStoredAllowlist(kv);
  if (allowlist.length === 0) {
    allowlist = [normalized];
    await store(kv).set(ALLOWED_KEY, allowlist.join(','));
  }
  if (!isEmailAllowed(normalized, allowlist)) {
    throw new Error(`El correo ${normalized} no está permitido para Drive`);
  }
  await store(kv).set(LINKED_KEY, normalized);
  persistLinkedEmailToWebStorage(normalized);
  return normalized;
}

export async function isAllowedGoogleIdentity(email: string | undefined, kv?: KvStore): Promise<boolean> {
  if (!email) return false;
  const linked = await readLinkedEmail(kv);
  if (!linked || linked !== normalizeEmail(email)) return false;
  const allowlist = await effectiveAllowlist(kv);
  return isEmailAllowed(email, allowlist);
}
