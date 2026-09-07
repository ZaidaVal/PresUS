import { create } from 'zustand';
import { isAllowedGoogleIdentity, linkAllowedEmail, readLinkedEmail, readLinkedEmailFromWebStorage } from '../security/allowedEmails';
import {
  clearAccessToken,
  fetchGoogleEmail,
  isGoogleConfigured,
  requestAccessToken,
  trySilentAccessToken,
} from '../sync/driveAuth';

const LOCK_AFTER_HIDDEN_MS = 5 * 60_000;

interface LockState {
  initialized: boolean;
  linkedEmail: string | null;
  googleConfigured: boolean;
  unlocked: boolean;
  error: string | null;
  init: () => Promise<void>;
  unlockWithGoogle: () => Promise<void>;
  lock: () => void;
}

async function sessionFromToken(token: string): Promise<string> {
  const email = await fetchGoogleEmail(token);
  const linked = await linkAllowedEmail(email);
  const allowed = await isAllowedGoogleIdentity(linked);
  if (!allowed) {
    clearAccessToken();
    throw new Error('Ese correo no está vinculado y permitido para Drive');
  }
  return linked;
}

export const useLock = create<LockState>((set, get) => ({
  initialized: false,
  linkedEmail: readLinkedEmailFromWebStorage() ?? null,
  googleConfigured: isGoogleConfigured(),
  unlocked: false,
  error: null,
  init: async () => {
    const linked = await readLinkedEmail();
    set({
      linkedEmail: linked ?? null,
      googleConfigured: isGoogleConfigured(),
      unlocked: false,
      error: null,
      initialized: false,
    });

    if (linked && isGoogleConfigured()) {
      const token = await trySilentAccessToken(linked);
      if (token) {
        try {
          const confirmed = await sessionFromToken(token);
          set({ initialized: true, unlocked: true, linkedEmail: confirmed, error: null });
          return;
        } catch {
          clearAccessToken();
        }
      }
    }

    set({
      initialized: true,
      unlocked: false,
      linkedEmail: linked ?? null,
      googleConfigured: isGoogleConfigured(),
      error: null,
    });
  },
  unlockWithGoogle: async () => {
    const hint = get().linkedEmail ?? (await readLinkedEmail()) ?? undefined;
    let token: string;
    try {
      token = await requestAccessToken(false, hint);
    } catch {
      token = await requestAccessToken(true, hint);
    }
    const linked = await sessionFromToken(token);
    set({ unlocked: true, linkedEmail: linked, error: null });
  },
  lock: () => {
    clearAccessToken();
    set({ unlocked: false, error: null });
  },
}));

let hideTimer: number | undefined;

export function attachLockOnHide() {
  const onVisibility = () => {
    if (typeof document === 'undefined') return;
    if (document.hidden) {
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        useLock.getState().lock();
      }, LOCK_AFTER_HIDDEN_MS);
    } else {
      window.clearTimeout(hideTimer);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.clearTimeout(hideTimer);
  };
}
