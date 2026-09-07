import { useState } from 'react';
import { useFinance } from '../../stores/financeStore';
import { useLock } from '../../stores/lockStore';
import { useDrive } from '../../stores/driveStore';

export function AccessSettings() {
  const { ledger, refresh, accounts } = useFinance();
  const { lock, linkedEmail } = useLock();
  const drive = useDrive();
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const accountsEmpty = accounts.length === 0;

  const onBackup = async () => {
    if (!ledger) return;
    await drive.backupNow(ledger);
    await refresh();
  };

  const onPushLatest = async () => {
    if (!ledger) return;
    await drive.pushLatest(ledger);
    await refresh();
  };

  const onRestore = async () => {
    if (!ledger || !restoreId) return;
    try {
      await drive.restoreFile(ledger, restoreId);
      await refresh();
      setConfirmRestore(false);
      setRestoreId(null);
    } catch {
      /* el error ya está en useDrive */
    }
  };

  return (
    <div className="space-y-6">
      <section className="card space-y-3">
        <h2 className="text-sm uppercase tracking-[0.2em] text-stone-500">Acceso</h2>
        <p className="text-sm">
          {linkedEmail ? <strong>{linkedEmail}</strong> : 'Sin correo vinculado'}
        </p>
        <p className="text-sm text-stone-600">
          Al entrar bien con Google (conectar, reabrir sesión silenciosa con token, o desbloquear con Drive al
          alcance) se trae <code>finanzas-za-latest.json</code> y <strong>sustituye el libro local</strong>. Gana
          Drive; no se pide confirmación. Un fallo de red no impide seguir anotando aquí.
        </p>
        <p className="text-sm text-stone-600">
          Tras importar PresUSNuevo (o si el libro local no debe perderse), al conectar se{' '}
          <strong>sube ese libro</strong> a <code>finanzas-za-latest.json</code> (sin snapshot fechado). No se
          restaura el latest viejo ni se sube un vacío encima.
        </p>
        <button type="button" className="rounded-full bg-stone-200 px-4 py-2 text-sm" title="Cierra la sesión de Google en este dispositivo. El libro local se queda." onClick={() => lock()}>
          Cerrar sesión
        </button>
      </section>

      <section className="card space-y-3">
        <h2 className="text-sm uppercase tracking-[0.2em] text-stone-500">Google Drive</h2>
        {accountsEmpty && <p className="text-sm text-stone-600">Sin cuentas</p>}
        {!drive.configured && (
          <p className="text-sm text-stone-600">
            Falta <code>VITE_GOOGLE_CLIENT_ID</code> en <code>.env.local</code>.
          </p>
        )}
        {drive.email && <p className="text-sm">Sesión Google: {drive.email}</p>}
        <p className="text-sm text-stone-600">
          Tras un cambio local se actualiza solo el latest (con un breve retraso; el posteo no espera a Drive). No
          se crea una copia con fecha en cada movimiento. <strong>Subir a Drive</strong> sobrescribe
          <code>finanzas-za-latest.json</code>. <strong>Generar respaldo</strong> sí crea un snapshot
          fechado, por si quieres volver atrás.
        </p>
        {drive.lastBackupAt && (
          <p className="text-sm">Último latest confirmado: {new Date(drive.lastBackupAt).toLocaleString()}</p>
        )}
        {drive.status && <p className="text-sm text-stone-600">{drive.status}</p>}
        {drive.error && <p className="rounded-2xl bg-red-950/90 p-3 text-sm text-red-50">{drive.error}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary px-4 py-2 text-sm"
            disabled={!drive.configured || drive.busy}
            title="Conecta la cuenta Google permitida para respaldar el JSON en Drive."
            onClick={() => void drive.connect(ledger)}
          >
            Conectar Drive
          </button>
          <button
            type="button"
            className="btn-primary px-4 py-2 text-sm"
            title="Sube el libro local a finanzas-za-latest.json en Drive. No borra el SQLite."
            disabled={!drive.configured || drive.busy || !ledger}
            onClick={() => void onPushLatest()}
          >
            Subir a Drive
          </button>
          <button
            type="button"
            className="btn-primary px-4 py-2 text-sm"
            title="Crea una copia fechada en Drive, por si quieres restaurar más tarde."
            disabled={!drive.configured || drive.busy || !ledger}
            onClick={() => void onBackup()}
          >
            Generar respaldo
          </button>
          <button
            type="button"
            className="rounded-full bg-stone-200 px-4 py-2 text-sm disabled:opacity-50"
            title="Lista copias fechadas en Drive para restaurar una."
            disabled={!drive.configured || drive.busy}
            onClick={() => void drive.loadBackups()}
          >
            Ver copias
          </button>
        </div>
        {drive.backups.length > 0 && (
          <ul className="mt-2 space-y-2 text-sm">
            {drive.backups.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {file.name}
                  {file.modifiedTime ? ` · ${new Date(file.modifiedTime).toLocaleString()}` : ''}
                </span>
                <button
                  type="button"
                  className="rounded-full bg-stone-200 px-3 py-1 text-xs"
                  onClick={() => {
                    setRestoreId(file.id);
                    setConfirmRestore(false);
                  }}
                >
                  Restaurar
                </button>
              </li>
            ))}
          </ul>
        )}
        {restoreId && (
          <div className="mt-3 space-y-2 rounded-2xl bg-amber-50 p-3">
            <p className="text-sm">
              Esto reemplaza el libro local. Se guarda una copia preventiva en el dispositivo; no se crea otra copia
              en Drive.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmRestore}
                onChange={(event) => setConfirmRestore(event.target.checked)}
              />
              Confirmo que no sobrescribo en silencio: quiero restaurar
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-full bg-red-950 px-4 py-2 text-sm text-amber-50 disabled:opacity-50"
                disabled={!confirmRestore || drive.busy || !ledger}
                onClick={() => void onRestore()}
              >
                Restaurar ahora
              </button>
              <button type="button" className="rounded-full bg-stone-200 px-4 py-2 text-sm" onClick={() => setRestoreId(null)}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
