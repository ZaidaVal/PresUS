import { useMemo, useState, type FormEvent } from 'react';
import {
  bpsToInput,
  centsToInput,
  formatUsd,
  parsePercentToBps,
  parseUsdToCents,
  saveDebt,
  suggestedInstallmentCents,
  removeDebt,
  type DebtAmortization,
  type DebtCompounding,
  type DebtKind,
} from '../../domain';
import { errorMessage } from '../../App';
import { useFinance } from '../../stores/financeStore';
import { ActionBtn, BackLink } from '../ui/Icon';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Ban, Save } from 'lucide-react';

function isoFromDateInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Usa una fecha válida');
  }
  return `${value}T00:00:00.000Z`;
}

export function DebtEditScreen({ id }: { id?: string }) {
  const { ledger, refresh, go, debts, accounts, funds } = useFinance();
  const existing = id ? debts.find((row) => row.id === id) : undefined;
  const publicAccounts = accounts.filter((row) => row.visibility === 'PUBLIC');

  const [name, setName] = useState(existing?.name ?? 'Hipoteca');
  const [kind, setKind] = useState<DebtKind>(existing?.kind ?? 'MORTGAGE');
  const [principal, setPrincipal] = useState(existing ? centsToInput(existing.originalCents) : '');
  const [rate, setRate] = useState(existing ? bpsToInput(existing.annualRateBps) : '6.00');
  const [term, setTerm] = useState(existing ? String(existing.termMonths) : '360');
  const [installment, setInstallment] = useState(existing ? centsToInput(existing.installmentCents) : '');
  const [started, setStarted] = useState(existing ? existing.startedAt.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [amortization, setAmortization] = useState<DebtAmortization>(existing?.amortization ?? 'FRENCH');
  const [compounding, setCompounding] = useState<DebtCompounding>(existing?.compounding ?? 'MONTHLY');
  const [extraMonthly, setExtraMonthly] = useState(existing ? centsToInput(existing.extraMonthlyCents) : '0.00');
  const [extraFortnight, setExtraFortnight] = useState(
    existing ? centsToInput(existing.extraFortnightCents) : '0.00',
  );
  const [everyN, setEveryN] = useState(
    existing?.extraEveryNMonths != null ? String(existing.extraEveryNMonths) : '',
  );
  const [everyNAmount, setEveryNAmount] = useState(
    existing ? centsToInput(existing.extraEveryNAmountCents) : '0.00',
  );
  const [paymentAccountId, setPaymentAccountId] = useState(
    existing?.paymentAccountId ?? publicAccounts[0]?.id ?? '',
  );
  const [coverFundId, setCoverFundId] = useState(existing?.coverFundId ?? '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [active, setActive] = useState(existing?.active ?? true);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  const previewInstallment = useMemo(() => {
    try {
      const principalCents = parseUsdToCents(principal);
      const annualRateBps = parsePercentToBps(rate);
      const termMonths = Number(term);
      if (!Number.isInteger(termMonths) || termMonths <= 0) return null;
      return suggestedInstallmentCents({
        principalCents,
        annualRateBps,
        termMonths,
        amortization,
        compounding,
      });
    } catch {
      return null;
    }
  }, [principal, rate, term, amortization, compounding]);

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!ledger) return;
    setMessage(null);
    try {
      const originalCents = parseUsdToCents(principal);
      const annualRateBps = parsePercentToBps(rate);
      const termMonths = Number(term);
      if (!Number.isInteger(termMonths) || termMonths <= 0) {
        throw new Error('El plazo debe ser un entero de meses mayor que cero');
      }
      const installmentCents = installment.trim()
        ? parseUsdToCents(installment)
        : previewInstallment ??
          suggestedInstallmentCents({
            principalCents: originalCents,
            annualRateBps,
            termMonths,
            amortization,
            compounding,
          });
      const extraEveryNMonths = everyN.trim() ? Number(everyN) : null;
      await ledger.withTransaction((tx) =>
        saveDebt(
          tx,
          {
            id: existing?.id ?? crypto.randomUUID(),
            name,
            kind,
            originalCents,
            annualRateBps,
            termMonths,
            installmentCents,
            startedAt: isoFromDateInput(started),
            paymentAccountId: paymentAccountId || null,
            coverFundId: coverFundId || null,
            amortization,
            compounding,
            extraMonthlyCents: parseUsdToCents(extraMonthly || '0'),
            extraFortnightCents: parseUsdToCents(extraFortnight || '0'),
            extraEveryNMonths,
            extraEveryNAmountCents: parseUsdToCents(everyNAmount || '0'),
            note,
            active,
          },
          !existing,
        ),
      );
      await refresh();
      go({ name: 'debts' });
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const onRemove = async () => {
    if (!ledger || !existing) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await ledger.withTransaction((tx) => removeDebt(tx, existing.id));
      await refresh();
      if (result.outcome === 'deleted') {
        go({ name: 'debts' });
        return;
      }
      setActive(false);
      setConfirmRemove(false);
      setMessage('Quedó inactiva. Los pagos del historial se conservan.');
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
        <p>Deuda no encontrada.</p>
      </div>
    );
  }

  const coverFunds = funds.filter((row) => {
    if (!paymentAccountId) return true;
    return row.fund.accountId === paymentAccountId;
  });

  return (
    <>
    <form onSubmit={onSave} className="card space-y-4">
      <BackLink />
      <h2 className="font-display text-2xl">{existing ? 'Editar deuda' : 'Nueva deuda'}</h2>
      <p className="text-sm text-stone-600">No mueve efectivo. Tasa anual: 6.00 = 6%.</p>
      <Field label="Nombre" value={name} onChange={setName} />
      <label className="block text-sm">
        Tipo
        <select className="mt-1 w-full rounded-2xl bg-stone-100 p-3" value={kind} onChange={(e) => setKind(e.target.value as DebtKind)}>
          <option value="MORTGAGE">Hipoteca</option>
          <option value="PERSONAL">Personal</option>
          <option value="VEHICLE">Vehículo</option>
          <option value="OTHER">Otra</option>
        </select>
      </label>
      <Field label="Capital" value={principal} onChange={setPrincipal} placeholder="100000.00" />
      <Field label="Tasa anual %" value={rate} onChange={setRate} placeholder="6.00" />
      <Field label="Plazo (meses)" value={term} onChange={setTerm} placeholder="360" />
      <label className="block text-sm">
        Fecha de inicio
        <input
          type="date"
          className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
          value={started}
          onChange={(event) => setStarted(event.target.value)}
        />
      </label>
      <label className="block text-sm">
        Amortización
        <select
          className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
          value={amortization}
          onChange={(e) => setAmortization(e.target.value as DebtAmortization)}
        >
          <option value="FRENCH">Francesa (cuota fija)</option>
          <option value="INTEREST_ONLY">Solo interés</option>
          <option value="SIMPLE">Simple (interés sobre original)</option>
        </select>
      </label>
      <label className="block text-sm">
        Capitalización
        <select
          className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
          value={compounding}
          onChange={(e) => setCompounding(e.target.value as DebtCompounding)}
        >
          <option value="MONTHLY">Mensual</option>
          <option value="FORTNIGHTLY">Quincenal</option>
          <option value="ANNUAL">Anual</option>
        </select>
      </label>
      {previewInstallment != null && (
        <p className="text-sm text-stone-600">Cuota sugerida {formatUsd(previewInstallment)}</p>
      )}
      <Field label="Cuota" value={installment} onChange={setInstallment} placeholder={previewInstallment != null ? centsToInput(previewInstallment) : '0.00'} />
      <Field label="Extra mensual" value={extraMonthly} onChange={setExtraMonthly} placeholder="0.00" />
      <Field label="Extra quincenal (se aplica ×2 al mes)" value={extraFortnight} onChange={setExtraFortnight} placeholder="0.00" />
      <Field label="Cada N meses (opcional)" value={everyN} onChange={setEveryN} placeholder="12" />
      <Field label="Monto cada N meses" value={everyNAmount} onChange={setEveryNAmount} placeholder="0.00" />
      <label className="block text-sm">
        Cuenta de pago
        <select
          className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
          value={paymentAccountId}
          onChange={(event) => setPaymentAccountId(event.target.value)}
        >
          {publicAccounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Fondo opcional
        <select
          className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
          value={coverFundId}
          onChange={(event) => setCoverFundId(event.target.value)}
        >
          <option value="">Ninguno</option>
          {coverFunds.map((row) => (
            <option key={row.fund.id} value={row.fund.id}>
              {row.fund.name}
            </option>
          ))}
        </select>
      </label>
      <Field label="Nota" value={note} onChange={setNote} />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
        Activa
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
        title="¿Quitar esta deuda?"
        confirmLabel="Sí, quitar"
        busy={busy}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => void onRemove()}
      >
        <p>
          Si no hay pagos, sale del catálogo. Si hay pagos POSTED, se desactiva y el historial se conserva.
        </p>
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
