import { useState, type FormEvent } from 'react';
import { Ban, Save } from 'lucide-react';
import { centsToInput, parseUsdToCents, removeCreditCard, saveCreditCard } from '../../domain';
import { errorMessage } from '../../App';
import { useFinance } from '../../stores/financeStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ActionBtn, BackLink } from '../ui/Icon';

export function CardEditScreen({ id }: { id?: string }) {
  const { ledger, refresh, accounts, funds, cards, people, go } = useFinance();
  const existing = id ? cards.find((row) => row.card.id === id)?.card : undefined;
  const payer =
    accounts.find((row) => row.isCardPaymentSource && row.kind === 'CREDIT') ??
    accounts.find((row) => row.isCardPaymentSource) ??
    accounts.find((row) => row.visibility === 'PUBLIC');
  const [name, setName] = useState(existing?.name ?? '');
  const [paymentAccountId, setPaymentAccountId] = useState(existing?.paymentAccountId ?? payer?.id ?? '');
  const [coverFundId, setCoverFundId] = useState(existing?.coverFundId ?? '');
  const [limit, setLimit] = useState(
    existing?.creditLimitCents != null ? centsToInput(existing.creditLimitCents) : '',
  );
  const [lineLimit, setLineLimit] = useState(
    existing?.creditLineLimitCents != null ? centsToInput(existing.creditLineLimitCents) : '',
  );
  const [personId, setPersonId] = useState(existing?.personId ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!ledger) return;
    setMessage(null);
    try {
      const creditLimitCents = limit.trim() ? parseUsdToCents(limit) : null;
      const creditLineLimitCents = lineLimit.trim() ? parseUsdToCents(lineLimit) : null;
      const saved = await ledger.withTransaction((tx) =>
        saveCreditCard(
          tx,
          {
            id: existing?.id ?? crypto.randomUUID(),
            name,
            paymentAccountId,
            coverFundId: coverFundId || null,
            creditLimitCents,
            creditLineId: existing?.creditLineId ?? null,
            creditLineLimitCents,
            personId: personId || null,
          },
          !existing,
        ),
      );
      await refresh();
      go({ name: 'account', id: saved.paymentAccountId, focus: 'cuadre' });
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const onRemove = async () => {
    if (!ledger || !existing) return;
    setBusy(true);
    setMessage(null);
    try {
      await ledger.withTransaction((tx) => removeCreditCard(tx, existing.id));
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
        <p>Tarjeta no encontrada.</p>
      </div>
    );
  }

  const publicAccounts = accounts.filter((row) => row.visibility === 'PUBLIC');

  return (
    <>
    <form onSubmit={onSave} className="space-y-4 rounded-3xl bg-white/80 p-4">
      <BackLink />
      <h2 className="font-display text-2xl">{existing ? 'Editar tarjeta' : 'Nueva tarjeta'}</h2>
      <p className="text-sm text-stone-600">
        Cambia nombre, tope y cobertura. El debe se cuadra en la cuenta de pago, no aquí.
      </p>
      <Field label="Nombre" value={name} onChange={setName} />
      <label className="block text-sm">
        Paga desde
        <select
          className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
          value={paymentAccountId}
          onChange={(event) => setPaymentAccountId(event.target.value)}
        >
          {publicAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
              {account.isCardPaymentSource ? ' · paga tarjeta' : ''}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Fondo que cubre (opcional)
        <select
          className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
          value={coverFundId}
          onChange={(event) => setCoverFundId(event.target.value)}
        >
          <option value="">Ninguno</option>
          {funds.map((row) => (
            <option key={row.fund.id} value={row.fund.id}>
              {row.fund.name}
            </option>
          ))}
        </select>
      </label>
      <Field label="Tope de esta tarjeta (vacío = usa la línea)" value={limit} onChange={setLimit} placeholder="2700.00" />
      <Field
        label="Línea compartida (si hay, se aplica a las tarjetas de la misma línea)"
        value={lineLimit}
        onChange={setLineLimit}
        placeholder="2700.00"
      />
      <label className="block text-sm">
        Persona (opcional)
        <select
          className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
          value={personId}
          onChange={(event) => setPersonId(event.target.value)}
        >
          <option value="">Ninguna</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.code} · {person.displayName}
            </option>
          ))}
        </select>
      </label>
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
        title="¿Quitar esta tarjeta?"
        confirmLabel="Sí, quitar"
        busy={busy}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void onRemove()}
      >
        <p>Solo si no hay cargos. Si hay historial, anula esos movimientos. El libro no se borra.</p>
      </ConfirmDialog>
    )}
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      {label}
      <input
        className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
