import { useState, type ReactNode } from 'react';
import { PRODUCT_NAME, PRODUCT_TAGLINE } from '../../branding';
import { useLock } from '../../stores/lockStore';

export function LockScreen() {
  const { linkedEmail, googleConfigured, unlockWithGoogle, error } = useLock();
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enter = async () => {
    setLocalError(null);
    setBusy(true);
    try {
      await unlockWithGoogle();
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <p className="text-xs uppercase tracking-[0.28em] text-duty/80">{PRODUCT_TAGLINE}</p>
      <h1 className="mt-2 font-display text-4xl text-ink">{PRODUCT_NAME}</h1>

      
      <p className="mt-4 text-sm text-stone-600">
        Accede mediante Google Drive para continuar.
      </p>

      <div className="mt-8 space-y-3">
        {googleConfigured ? (
          <button
            type="button"
            disabled={busy}
            className="btn-primary w-full px-4 py-3"
            onClick={() => void enter()}
          >
            {linkedEmail ? 'Entrar con Google' : 'Vincular Google Drive'}
          </button>
        ) : (
          <p className="rounded-2xl bg-amber-100 p-4 text-sm">
            Falta <code>VITE_GOOGLE_CLIENT_ID</code> en <code>.env.local</code>.
          </p>
        )}
      </div>

      {(localError || error) && (
        <p className="mt-6 rounded-2xl bg-red-950/90 p-3 text-sm text-red-50">{localError || error}</p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto min-h-dvh max-w-3xl px-4 py-8 pb-16">{children}</div>;
}
