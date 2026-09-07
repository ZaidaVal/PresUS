import { useState, type FormEvent } from 'react';
import {
  centsToInput,
  defaultBudgetShares,
  formatUsd,
  monthlyEquivalentCents,
  parseUsdToCents,
  saveBudgetItem,
  isSavingsFund,
  OPERATING_EXPENSE_FREQUENCIES,
  removeBudgetItem,
  type BudgetItemDraft,
  type BudgetScope,
  type Fortnight,
  type Frequency,
  type PaymentMedium,
} from '../../domain';
import { errorMessage } from '../../App';
import { useFinance } from '../../stores/financeStore';
import { ActionBtn, BackLink } from '../ui/Icon';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Ban, Save } from 'lucide-react';

export function BudgetEditScreen({ id }: { id?: string }) {
  const store = useFinance();
  const existing = id ? store.budgetItems.find((item) => item.id === id) : undefined;
  const [name, setName] = useState(existing?.name ?? '');
  const [category, setCategory] = useState(existing?.category ?? '');
  const [scope, setScope] = useState<BudgetScope>(existing?.budgetScope ?? 'HOME');
  const [frequency, setFrequency] = useState<Frequency>(existing?.frequency ?? 'QUINCENAL');
  const [fortnight, setFortnight] = useState<Fortnight>(existing?.fortnight ?? 'BOTH');
  const [amount, setAmount] = useState(existing ? centsToInput(existing.amountCents) : '');
  const initialShares = existing
    ? { zShareCents: existing.zShareCents, aShareCents: existing.aShareCents }
    : defaultBudgetShares('HOME', 0, '');
  const [zShare, setZShare] = useState(existing ? centsToInput(initialShares.zShareCents) : '');
  const [aShare, setAShare] = useState(existing ? centsToInput(initialShares.aShareCents) : '');
  const [coverFundId, setCoverFundId] = useState(existing?.coverFundId ?? '');
  const [medium, setMedium] = useState<PaymentMedium>(existing?.usualMedium ?? 'TRANSFER');
  const [active, setActive] = useState(existing?.active ?? true);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);
  const coverFund = store.funds.find((row) => row.fund.id === coverFundId)?.fund;
  const allowAnnual = coverFund ? isSavingsFund(coverFund) : false;
  const frequencies: Frequency[] = allowAnnual
    ? [...OPERATING_EXPENSE_FREQUENCIES, 'ANUAL']
    : OPERATING_EXPENSE_FREQUENCIES;

  const applyScopeShares = (nextScope: BudgetScope, amountText: string, nextName: string) => {
    try {
      const cents = parseUsdToCents(amountText);
      const shares = defaultBudgetShares(nextScope, cents, nextName);
      setZShare(centsToInput(shares.zShareCents));
      setAShare(centsToInput(shares.aShareCents));
    } catch {
      if (nextScope === 'Z') {
        setZShare(amountText);
        setAShare('0.00');
      } else if (nextScope === 'A') {
        setZShare('0.00');
        setAShare(amountText);
      }
    }
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!store.ledger) return;
    try {
      const amountCents = parseUsdToCents(amount);
      const row: BudgetItemDraft = {
        id: existing?.id ?? crypto.randomUUID(),
        name,
        category,
        budgetScope: scope,
        frequency: frequencies.includes(frequency) ? frequency : 'MENSUAL',
        fortnight,
        amountCents,
        zShareCents: scope === 'HOME' ? parseUsdToCents(zShare) : scope === 'Z' ? amountCents : 0,
        aShareCents: scope === 'HOME' ? parseUsdToCents(aShare) : scope === 'A' ? amountCents : 0,
        coverFundId: coverFundId || null,
        usualMedium: medium,
        active,
      };
      await store.ledger.withTransaction(async (tx) => {
        await saveBudgetItem(tx, row, !existing);
      });
      await store.refresh();
      store.go({ name: 'budgets' });
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function onRemove() {
    if (!store.ledger || !existing) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await store.ledger.withTransaction((tx) => removeBudgetItem(tx, existing.id));
      await store.refresh();
      if (result.outcome === 'deleted') {
        store.go({ name: 'budgets' });
        return;
      }
      setActive(false);
      setConfirmRemove(false);
      setMessage('Quedó inactiva. Sale de la operación diaria. El historial no se toca.');
    } catch (error) {
      setMessage(errorMessage(error));
      setConfirmRemove(false);
    } finally {
      setBusy(false);
    }
  }

  let zMonthly: string | null = null;
  let aMonthly: string | null = null;
  let shareHint: string | null = null;
  try {
    const amountCents = amount.trim() ? parseUsdToCents(amount) : 0;
    const zCents = scope === 'HOME' ? (zShare.trim() ? parseUsdToCents(zShare) : 0) : scope === 'Z' ? amountCents : 0;
    const aCents = scope === 'HOME' ? (aShare.trim() ? parseUsdToCents(aShare) : 0) : scope === 'A' ? amountCents : 0;
    const freq = frequencies.includes(frequency) ? frequency : 'MENSUAL';
    zMonthly = formatUsd(monthlyEquivalentCents(freq, zCents, active));
    aMonthly = formatUsd(monthlyEquivalentCents(freq, aCents, active));
    if (scope === 'HOME' && amountCents > 0 && zCents + aCents !== amountCents) {
      shareHint = `Z + A = ${formatUsd(zCents + aCents)}. Debe ser ${formatUsd(amountCents)}.`;
    }
  } catch {
    shareHint = 'Usa dólares con hasta 2 decimales, sin centavos con decimal.';
  }

  return (
    <>
    <form onSubmit={submit} className="space-y-4 rounded-3xl bg-white/80 p-4">
      <BackLink />
      <h2 className="font-display text-2xl">{existing ? 'Editar partida' : 'Nueva partida'}</h2>
      <Field label="Nombre" value={name} onChange={setName} />
      <Field label="Categoría" value={category} onChange={setCategory} />
      <label className="block text-sm">
        Alcance
        <select
          className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
          value={scope}
          onChange={(e) => {
            const next = e.target.value as BudgetScope;
            setScope(next);
            applyScopeShares(next, amount, name);
          }}
        >
          <option value="HOME">Hogar (se parte entre Z y A)</option>
          <option value="Z">Solo Z</option>
          <option value="A">Solo A</option>
        </select>
      </label>
      <label className="block text-sm">
        Frecuencia
        <select
          className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
          value={frequencies.includes(frequency) ? frequency : 'MENSUAL'}
          onChange={(e) => setFrequency(e.target.value as Frequency)}
        >
          <option value="QUINCENAL">Quincenal</option>
          <option value="MENSUAL">Mensual</option>
          <option value="BIMESTRAL">Bimestral</option>
          <option value="TRIMESTRAL">Trimestral (máximo para un gasto)</option>
          {allowAnnual && <option value="ANUAL">Anual (solo ahorro)</option>}
          <option value="UNICO">Único</option>
        </select>
      </label>
      <label className="block text-sm">
        Quincena
        <select className="mt-1 w-full rounded-2xl bg-stone-100 p-3" value={fortnight} onChange={(e) => setFortnight(e.target.value as Fortnight)}>
          <option value="BOTH">Ambas (14 y 29)</option>
          <option value="Q1">Quincena 1 ≈ 14</option>
          <option value="Q2">Quincena 2 ≈ 29</option>
          <option value="NONE">Ninguna</option>
        </select>
      </label>
      <Field
        label="Monto por período (USD)"
        value={amount}
        onChange={(value) => {
          setAmount(value);
          applyScopeShares(scope, value, name);
        }}
      />
      {scope === 'HOME' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Pone Z (USD)"
            value={zShare}
            onChange={(value) => {
              setZShare(value);
              try {
                const total = parseUsdToCents(amount);
                const z = parseUsdToCents(value);
                if (z >= 0 && z <= total) setAShare(centsToInput(total - z));
              } catch {
                /* se valida al guardar */
              }
            }}
          />
          <Field
            label="Pone A (USD)"
            value={aShare}
            onChange={(value) => {
              setAShare(value);
              try {
                const total = parseUsdToCents(amount);
                const a = parseUsdToCents(value);
                if (a >= 0 && a <= total) setZShare(centsToInput(total - a));
              } catch {
                /* se valida al guardar */
              }
            }}
          />
        </div>
      ) : (
        <p className="rounded-2xl bg-emerald-950/5 px-4 py-3 text-sm text-stone-600">
          {scope === 'Z' ? 'Z pone el total. A pone $0.00.' : 'A pone el total. Z pone $0.00.'}
        </p>
      )}
      {(zMonthly || aMonthly) && (
        <p className="rounded-2xl bg-amber-100/70 px-4 py-3 text-sm">
          Equivalente mensual: Z {zMonthly} · A {aMonthly}
        </p>
      )}
      {shareHint && <p className="text-sm text-amber-800">{shareHint}</p>}
      <label className="block text-sm">
        Fondo que cubre
        <select
          className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
          value={coverFundId}
          onChange={(e) => {
            const next = e.target.value;
            setCoverFundId(next);
            const nextFund = store.funds.find((row) => row.fund.id === next)?.fund;
            if (frequency === 'ANUAL' && (!nextFund || !isSavingsFund(nextFund))) {
              setFrequency('MENSUAL');
            }
          }}
        >
          <option value="">Ninguno</option>
          {store.funds.map((item) => (
            <option key={item.fund.id} value={item.fund.id}>
              {item.fund.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Medio habitual
        <select className="mt-1 w-full rounded-2xl bg-stone-100 p-3" value={medium} onChange={(e) => setMedium(e.target.value as PaymentMedium)}>
          <option value="TRANSFER">Transferencia</option>
          <option value="CASH">Efectivo</option>
          <option value="CARD">Tarjeta (cargo; no saca efectivo)</option>
        </select>
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Activa
      </label>
      {message && <p className="text-sm text-red-800">{message}</p>}
      <ActionBtn icon={Save} label="Guardar" className="w-full" type="submit" />
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
        title={existing.active ? '¿Quitar esta partida?' : '¿Borrar del catálogo?'}
        confirmLabel={existing.active ? 'Sí, desactivar' : 'Sí, quitar'}
        busy={busy}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void onRemove()}
      >
        <p>
          {existing.active
            ? 'Sale de la operación diaria. Queda inactiva. El historial de movimientos no se borra.'
            : 'Se quita del catálogo. No hay movimientos en esta partida.'}
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
      <input className="mt-1 w-full rounded-2xl bg-stone-100 p-3" value={value} onChange={(e) => onChange(e.target.value)} required />
    </label>
  );
}
