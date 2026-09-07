import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryStore, setSecureStore } from '../security/secureStore';
import { linkAllowedEmail } from '../security/allowedEmails';
import * as driveAuth from '../sync/driveAuth';
import { useLock } from './lockStore';

vi.mock('../sync/driveAuth', () => ({
  isGoogleConfigured: () => true,
  requestAccessToken: vi.fn(),
  trySilentAccessToken: vi.fn(),
  fetchGoogleEmail: vi.fn(),
  clearAccessToken: vi.fn(),
}));

describe('sesión al recargar', () => {
  beforeEach(() => {
    setSecureStore(createMemoryStore());
    vi.mocked(driveAuth.requestAccessToken).mockReset();
    vi.mocked(driveAuth.trySilentAccessToken).mockReset();
    vi.mocked(driveAuth.fetchGoogleEmail).mockReset();
    vi.mocked(driveAuth.clearAccessToken).mockReset();
    useLock.setState({
      initialized: false,
      linkedEmail: null,
      googleConfigured: true,
      unlocked: false,
      error: null,
    });
  });

  afterEach(() => {
    setSecureStore(null);
  });

  it('con correo vinculado pide token silencioso y abre sin popup', async () => {
    await linkAllowedEmail('z@casa.com');
    vi.mocked(driveAuth.trySilentAccessToken).mockResolvedValue('mem-token');
    vi.mocked(driveAuth.fetchGoogleEmail).mockResolvedValue('z@casa.com');

    await useLock.getState().init();

    expect(driveAuth.trySilentAccessToken).toHaveBeenCalledWith('z@casa.com');
    expect(driveAuth.requestAccessToken).not.toHaveBeenCalled();
    expect(useLock.getState().unlocked).toBe(true);
    expect(useLock.getState().linkedEmail).toBe('z@casa.com');
  });

  it('si el silencioso falla deja la pantalla de Google, no un token en disco', async () => {
    await linkAllowedEmail('z@casa.com');
    vi.mocked(driveAuth.trySilentAccessToken).mockResolvedValue(null);

    await useLock.getState().init();

    expect(useLock.getState().unlocked).toBe(false);
    expect(useLock.getState().initialized).toBe(true);
    expect(useLock.getState().linkedEmail).toBe('z@casa.com');
    expect(driveAuth.requestAccessToken).not.toHaveBeenCalled();
  });
});
