import { useState, type FormEvent } from 'react';
import { Ban, Save } from 'lucide-react';
import {
  centsToInput,
  fundDueAnchorLabel,
  goalKindLabel,
  goalKindOf,
  isGoalFund,
  isSavingsAccount,
  parseUsdToCents,
  removeFund,
  saveFund,
  saveGoalFund,
  type FundDueAnchor,
  type FundSegment,
  type GoalKind,
} from '../../domain';
import { errorMessage } from '../../App';
import { useFinance } from '../../stores/financeStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ActionBtn, BackLink } from '../ui/Icon';

export function FundEditScreen({
  id,
  segment: defaultSegment,
  goalKind: defaultGoalKind,
}: {
  id?: string;
  segment?: FundSegment;
  goalKind?: GoalKind;
}) {
  const { ledger, refresh, accounts, funds, go } = useFinance();
  const existing = id ? funds.find((row) => row.fund.id === id)?.fund : undefined;
  const asGoal = Boolean(defaultGoalKind) || Boolean(existing && isGoalFund(existing));
  const savingsAccount =
    accounts.find((account) => account.id === 'acc-ahorro') ??
    accounts.find((account) => isSavingsAccount(account) && account.name === 'Ahorros') ??
    accounts.find((account) => isSavingsAccount(account) && account.visibility === 'PUBLIC');
  const [name, setName] = useState(existing?.name ?? '');
  const [purpose, setPurpose] = useState(existing?.purpose ?? '');
  const [kind, setKind] = useState<GoalKind>(defaultGoalKind ?? (existing ? goalKindOf(existing) : null) ?? 'PROYECTO');
  const [accountId, setAccountId] = useState(
    existing?.accountId ??
      (asGoal || defaultSegment === 'SAVINGS' ? savingsAccount?.id : undefined) ??
      accounts[0]?.id ??
      '',
  );
  const [segment, setSegment] = useState<FundSegment>(
    asGoal ? 'SAVINGS' : (existing?.segment ?? defaultSegment ?? 'OPERATING'),
  );
  const [target, setTarget] = useState(
    existing?.targetAmountCents != null ? centsToInput(existing.targetAmountCents) : '',
  );
  const [priority, setPriority] = useState(existing?.priority != null ? String(existing.priority) : '');
  const [dueAnchor, setDueAnchor] = useState<FundDueAnchor | ''>(existing?.dueAnchor ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!ledger) return;
    setMessage(null);
    try {
      const allowsTarget = asGoal || segment === 'SAVINGS';
      let targetAmountCents: number | null = null;
      if (allowsTarget && target.trim()) targetAmountCents = parseUsdToCents(target);
      let priorityValue: number | null = null;
      if (priority.trim()) {
        const parsed = Number(priority);
        if (!Number.isInteger(parsed)) throw new Error('La prioridad del fondo debe ser un entero');
        priorityValue = parsed;
      }
      const saved = await ledger.withTransaction((tx) =>
        asGoal
          ? saveGoalFund(
              tx,
              {
                id: existing?.id,
                kind,
                name,
                accountId,
                targetAmountCents,
                priority: priorityValue,
                purposeRest: existing?.purpose,
              },
              !existing,
            )
          : saveFund(
              tx,
              {
                id: existing?.id ?? crypto.randomUUID(),
                accountId,
                name,
                purpose,
                targetAmountCents,
                priority: priorityValue,
                segment,
                dueAnchor: dueAnchor === '' ? null : dueAnchor,
              },
              !existing,
            ),
      );
      await refresh();
      go(asGoal ? { name: 'projects' } : { name: 'account', id: saved.accountId });
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const onRemove = async () => {
    if (!ledger || !existing) return;
    setBusy(true);
    setMessage(null);
    try {
      await ledger.withTransaction((tx) => removeFund(tx, existing.id));
      await refresh();
      go(asGoal ? { name: 'projects' } : { name: 'settings', tab: 'catalogos' });
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
        <p>Fondo no encontrado.</p>
      </div>
    );
  }

  const accountChoices = asGoal
    ? accounts.filter((account) => account.visibility === 'PUBLIC' && isSavingsAccount(account))
    : accounts.filter((account) => account.visibility === 'PUBLIC' || account.id === accountId);
  const heading = asGoal
    ? `${existing ? 'Editar' : 'Nuevo'} ${goalKindLabel(kind).toLowerCase()}`
    : existing
      ? 'Editar fondo'
      : 'Nuevo fondo';

  return (
    <>
    <form onSubmit={onSave} className="space-y-4 rounded-3xl bg-white/80 p-4">
      <BackLink />
      <h2 className="font-display text-2xl">{heading}</h2>
      {asGoal ? (
        <label className="block text-sm">
          Tipo
          <select
            className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
            value={kind}
            title="Proyecto: meta cercana. Sueño: meta larga."
            onChange={(event) => setKind(event.target.value as GoalKind)}
          >
            <option value="PROYECTO">Proyecto</option>
            <option value="SUEÑO">Sueño</option>
          </select>
        </label>
      ) : null}
      <Field label="Nombre" value={name} onChange={setName} />
      {asGoal ? null : <Field label="Propósito" value={purpose} onChange={setPurpose} />}
      {asGoal ? null : (
        <label className="block text-sm">
          Tipo
          <select
            className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
            value={segment}
            onChange={(event) => setSegment(event.target.value as FundSegment)}
          >
            <option value="OPERATING">Operativo</option>
            <option value="SAVINGS">Ahorro</option>
          </select>
        </label>
      )}
      <label className="block text-sm">
        Cuenta
        <select
          className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
        >
          {accountChoices.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>
      <>
        {asGoal || segment === 'SAVINGS' ? (
          <Field label="Meta (opcional)" value={target} onChange={setTarget} placeholder="0.00" />
        ) : null}
        <Field label="Prioridad (opcional)" value={priority} onChange={setPriority} placeholder="1" />
      </>
      {asGoal ? null : (
      <label className="block text-sm">
        Fecha de pago
        <select
          className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
          value={dueAnchor}
          title="Día destinado a pagarse: inicio de mes, día 14 o fin de mes."
          onChange={(event) => setDueAnchor(event.target.value as FundDueAnchor | '')}
        >
          <option value="">{fundDueAnchorLabel(null)}</option>
          <option value="MONTH_START">{fundDueAnchorLabel('MONTH_START')}</option>
          <option value="MONTH_MID">{fundDueAnchorLabel('MONTH_MID')}</option>
          <option value="MONTH_END">{fundDueAnchorLabel('MONTH_END')}</option>
        </select>
      </label>
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
        title={asGoal ? '¿Quitar esta meta?' : '¿Quitar este fondo?'}
        confirmLabel="Sí, quitar"
        busy={busy}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void onRemove()}
      >
        <p>Solo si no hay movimientos ni reservas. Si hay historial, anula esos movimientos. El libro no se borra.</p>
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
