import { describe, expect, it } from 'vitest';
import { createMemoryStore } from './secureStore';
import {
  isAllowedGoogleIdentity,
  isEmailAllowed,
  linkAllowedEmail,
  LINKED_EMAIL_LS_KEY,
  normalizeEmail,
  parseEmailList,
  persistLinkedEmailToWebStorage,
  readLinkedEmail,
  readLinkedEmailFromWebStorage,
} from './allowedEmails';

function memoryWebStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
  };
}

describe('allowlist de Drive', () => {
  it('normalizes and parses emails', () => {
    expect(normalizeEmail('  Z@Example.COM ')).toBe('z@example.com');
    expect(parseEmailList('a@x.com, B@X.com; c@x.com')).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });

  it('rejects an email that is not on the list', () => {
    expect(isEmailAllowed('z@x.com', ['a@x.com'])).toBe(false);
    expect(isEmailAllowed('a@x.com', [])).toBe(false);
    expect(isEmailAllowed('A@X.com', ['a@x.com'])).toBe(true);
  });

  it('bootstraps the first linked email and then blocks others', async () => {
    const kv = createMemoryStore();
    const web = memoryWebStorage();
    await expect(linkAllowedEmail('yo@casa.com', kv)).resolves.toBe('yo@casa.com');
    persistLinkedEmailToWebStorage('yo@casa.com', web);
    await expect(linkAllowedEmail('otro@casa.com', kv)).rejects.toThrow(/no está permitido/);
    expect(await isAllowedGoogleIdentity('yo@casa.com', kv)).toBe(true);
    expect(await isAllowedGoogleIdentity('otro@casa.com', kv)).toBe(false);
    expect(await isAllowedGoogleIdentity(undefined, kv)).toBe(false);
    expect(web.getItem(LINKED_EMAIL_LS_KEY)).toBe('yo@casa.com');
    expect(web.getItem(LINKED_EMAIL_LS_KEY)).not.toMatch(/ya29\.|1\/|refresh|access_token/);
  });

  it('relee el correo desde web storage si el kv está vacío (no es un token)', async () => {
    const kv = createMemoryStore();
    const web = memoryWebStorage();
    persistLinkedEmailToWebStorage('z@casa.com', web);
    expect(readLinkedEmailFromWebStorage(web)).toBe('z@casa.com');
    expect(await readLinkedEmail(kv)).toBeUndefined();
    expect(web.getItem('access_token')).toBeNull();
    expect(web.getItem('refresh_token')).toBeNull();
  });
});
