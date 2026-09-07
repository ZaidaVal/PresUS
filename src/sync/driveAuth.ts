export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const EMAIL_SCOPE = 'email openid';
export const AUTH_SCOPES = `${DRIVE_SCOPE} ${EMAIL_SCOPE}`;
export const DRIVE_FOLDER_NAME = 'Finanzas ZA';
export const DRIVE_BACKUPS_FOLDER = 'backups';

export function googleClientId(): string {
  return import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim() ?? '';
}

export function isGoogleConfigured(): boolean {
  return googleClientId().length > 0;
}

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type TokenClient = {
  requestAccessToken: (override?: { prompt?: string; hint?: string }) => void;
};

type PromptMoment = {
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
};

declare global {
  interface Window {
    google?: {
      accounts: {
        id?: {
          initialize: (config: {
            client_id: string;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
            callback: (response: { credential?: string }) => void;
          }) => void;
          prompt: (listener?: (notification: PromptMoment) => void) => void;
        };
        oauth2: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            hint?: string;
            include_granted_scopes?: boolean;
            callback: (response: TokenResponse) => void;
            error_callback?: (error: { type?: string; message?: string }) => void;
          }) => TokenClient;
        };
      };
    };
  }
}

let accessToken: string | null = null;
let expiresAt = 0;
let gisPromise: Promise<void> | null = null;

export function peekAccessToken(): string | null {
  if (!accessToken) return null;
  if (Date.now() >= expiresAt) {
    accessToken = null;
    return null;
  }
  return accessToken;
}

export function clearAccessToken() {
  accessToken = null;
  expiresAt = 0;
}

export async function fetchGoogleEmail(token = peekAccessToken()): Promise<string> {
  if (!token) throw new Error('No hay sesión de Google');
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('No se pudo leer el correo de Google');
  const data = (await response.json()) as { email?: string };
  if (!data.email) throw new Error('Google no devolvió el correo');
  return data.email;
}

function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-finanzas-gis]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('No se pudo cargar Google Identity')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.finanzasGis = '1';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar Google Identity'));
    document.head.appendChild(script);
  });
  return gisPromise;
}

/** One Tap auto_select: calienta la cuenta Google si sigue en el navegador. No guarda tokens. */
async function warmGoogleAutoSelect(clientId: string): Promise<void> {
  await loadGis();
  const id = window.google?.accounts?.id;
  if (!id) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(done, 2500);
    try {
      id.initialize({
        client_id: clientId,
        auto_select: true,
        cancel_on_tap_outside: true,
        callback: () => done(),
      });
      id.prompt((notification) => {
        if (
          notification.isNotDisplayed?.() ||
          notification.isSkippedMoment?.() ||
          notification.isDismissedMoment?.()
        ) {
          done();
        }
      });
    } catch {
      done();
    }
  });
}

export async function requestAccessToken(forcePrompt = false, hint?: string): Promise<string> {
  const clientId = googleClientId();
  if (!clientId) {
    throw new Error('Falta VITE_GOOGLE_CLIENT_ID en .env.local');
  }
  const cached = peekAccessToken();
  if (cached) return cached;

  await loadGis();
  if (!forcePrompt) {
    await warmGoogleAutoSelect(clientId);
  }
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) throw new Error('Google Identity no está disponible');

  const timeoutMs = forcePrompt ? 120_000 : 8_000;

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      fn();
    };
    const timer = window.setTimeout(() => {
      finish(() => reject(new Error('Google no respondió a tiempo')));
    }, timeoutMs);

    const client = oauth.initTokenClient({
      client_id: clientId,
      scope: AUTH_SCOPES,
      hint,
      include_granted_scopes: true,
      callback: (response) => {
        if (response.error || !response.access_token) {
          finish(() =>
            reject(new Error(response.error_description || response.error || 'No se obtuvo acceso a Drive')),
          );
          return;
        }
        accessToken = response.access_token;
        const seconds = Number(response.expires_in ?? 3600);
        expiresAt = Date.now() + Math.max(30, seconds - 60) * 1000;
        finish(() => resolve(accessToken as string));
      },
      error_callback: (error) => {
        finish(() => reject(new Error(error.message || error.type || 'No se obtuvo acceso a Drive')));
      },
    });
    client.requestAccessToken({ prompt: forcePrompt ? 'consent' : '', hint });
  });
}

/** Recarga: pide token en memoria con prompt vacío. Nunca escribe access/refresh token a disco. */
export async function trySilentAccessToken(hint?: string): Promise<string | null> {
  try {
    return await requestAccessToken(false, hint);
  } catch {
    return null;
  }
}
