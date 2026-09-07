import { useState, type FormEvent } from 'react';
import { Ban, Save } from 'lucide-react';
import { removeAccount, saveAccount, type AccountKind, type AccountVisibility } from '../../domain';
import { errorMessage } from '../../App';
import { useFinance } from '../../stores/financeStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ActionBtn, BackLink } from '../ui/Icon';

export function AccountEditScreen({ id }: { id?: string }) {
  const { ledger, refresh, people, accounts, go } = useFinance();
  const existing = id ? accounts.find((row) => row.id === id) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [kind, setKind] = useState<AccountKind>(existing?.kind ?? 'BANK');
  const [visibility, setVisibility] = useState<AccountVisibility>(existing?.visibility ?? 'PUBLIC');
  const [ownerPersonId, setOwnerPersonId] = useState(existing?.ownerPersonId ?? '');
  const [countsAsLiquidity, setCountsAsLiquidity] = useState(existing?.countsAsLiquidity ?? true);
  const [isCardPaymentSource, setIsCardPaymentSource] = useState(existing?.isCardPaymentSource ?? false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!ledger) return;
    setMessage(null);
    try {
      const saved = await ledger.withTransaction((tx) =>
        saveAccount(
          tx,
          {
            id: existing?.id ?? crypto.randomUUID(),
            name,
            kind,
            visibility,
            ownerPersonId: ownerPersonId || null,
            countsAsLiquidity,
            isCardPaymentSource,
          },
          !existing,
        ),
      );
      await refresh();
      go({ name: 'account', id: saved.id });
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const onRemove = async () => {
    if (!ledger || !existing) return;
    setBusy(true);
    setMessage(null);
    try {
      await ledger.withTransaction((tx) => removeAccount(tx, existing.id));
      await refresh();
      go({ name: 'settings', tab: 'catalogos' });
    } catch (error) {
      setMessage(errorMessage(error));
      setConfirmRemove(false);
    } finally {
      setBusy(false);
    }
  };

  if (id && !existing) {
    return (
      <div className="space-y-3">
        <BackLink />
        <p>Cuenta no encontrada.</p>
      </div>
    );
  }

  return (
    <>
    <form onSubmit={onSave} className="space-y-4 rounded-3xl bg-white/80 p-4">
      <BackLink />
      <h2 className="font-display text-2xl">{existing ? 'Editar cuenta' : 'Nueva cuenta'}</h2>
      <Field label="Nombre" value={name} onChange={setName} />
      <label className="block text-sm">
        Tipo
        <select
          className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
          value={kind}
          onChange={(event) => setKind(event.target.value as AccountKind)}
        >
          <option value="BANK">Banco</option>
          <option value="CASH">Efectivo</option>
          <option value="CREDIT">Crédito</option>
          <option value="FUND_HOLDER">Tenedora de fondos</option>
        </select>
      </label>
      <label className="block text-sm">
        Visibilidad
        <select
          className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
          value={visibility}
          onChange={(event) => setVisibility(event.target.value as AccountVisibility)}
        >
          <option value="PUBLIC">Pública (entra a Tengo)</option>
          <option value="PRIVATE">Privada (solo aportes e impactos)</option>
        </select>
      </label>
      <label className="block text-sm">
        Dueño
        <select
          className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
          value={ownerPersonId}
          onChange={(event) => setOwnerPersonId(event.target.value)}
        >
          <option value="">Ninguno (compartida)</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.code} · {person.displayName}
            </option>
          ))}
        </select>
      </label>
      {visibility === 'PUBLIC' && (
        <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={countsAsLiquidity}
              onChange={(event) => setCountsAsLiquidity(event.target.checked)}
            />
            Cuenta como liquidez (no duplicar con fondos)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isCardPaymentSource}
              onChange={(event) => setIsCardPaymentSource(event.target.checked)}
            />
            Desde aquí se paga la tarjeta (Atlántida)
          </label>
        </>
      )}
      {message && <p className="text-sm text-red-800">{message}</p>}
      <ActionBtn icon={Save} label="Guardar" type="submit" className="w-full" />
      {existing && (
        <ActionBtn
          icon={Ban}
          label="Eliminar"
          variant="secondary"
          className="w-full"
          disabled={busy}
          onClick={() => setConfirmRemove(true)}
        />
      )}
    </form>
    {confirmRemove && existing && (
      <ConfirmDialog
        title="¿Quitar esta cuenta?"
        confirmLabel="Sí, quitar"
        busy={busy}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void onRemove()}
      >
        <p>
          Solo si no hay movimientos ni fondos. Si hay historial, se rechaza: hay que anular movimientos, no borrar el
          libro.
        </p>
      </ConfirmDialog>
    )}
    </>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-sm">
      {label}
      <input className="mt-1 w-full rounded-2xl bg-stone-100 p-3" value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
