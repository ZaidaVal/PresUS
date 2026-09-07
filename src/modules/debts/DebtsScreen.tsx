import { useMemo, useState } from 'react';
import { Calculator, House, Pencil, Plus } from 'lucide-react';
import {
  centsToInput,
  debtViewsFromState,
  formatUsd,
  parseUsdToCents,
  planDebtPayment,
  postPagoDeuda,
} from '../../domain';
import { errorMessage } from '../../App';
import { useFinance } from '../../stores/financeStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ActionBtn, BackLink } from '../ui/Icon';
import { CollapsibleCard } from '../ui/CollapsibleCard';
import { ActionsCell, DataCell, DataRow, DataTable } from '../ui/DataTable';
import { PartnerIouPanel } from './PartnerIouPanel';

const KIND_LABEL: Record<string, string> = {
  MORTGAGE: 'Hipoteca',
  PERSONAL: 'Personal',
  VEHICLE: 'Vehículo',
  OTHER: 'Otra',
};

const AMORT_LABEL: Record<string, string> = {
  FRENCH: 'Francesa',
  INTEREST_ONLY: 'Solo interés',
  SIMPLE: 'Simple',
};

export function DebtsScreen() {
  const { ledger, refresh, go, debts, debtPayments, transactions, balances, funds } = useFinance();
  const views = useMemo(
    () => debtViewsFromState(debts, debtPayments, transactions),
    [debts, debtPayments, transactions],
  );
  const [payId, setPayId] = useState<string | null>(null);
  const paying = views.find((row) => row.debt.id === payId);
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const publicAccounts = balances.filter((row) => row.account.visibility === 'PUBLIC');

  const openPay = (id: string) => {
    const view = views.find((row) => row.debt.id === id);
    if (!view) return;
    setPayId(id);
    setAmount(centsToInput(view.nextAmountCents));
    setAccountId(view.debt.paymentAccountId ?? publicAccounts[0]?.account.id ?? '');
    setMessage(null);
    setConfirmOpen(false);
  };

  const preview = (() => {
    if (!paying) return null;
    try {
      const amountCents = parseUsdToCents(amount);
      return planDebtPayment({
        debt: paying.debt,
        remainingCents: paying.remainingCents,
        amountCents,
      });
    } catch {
      return null;
    }
  })();

  const submitPay = async () => {
    if (!ledger || !paying) return;
    setBusy(true);
    setMessage(null);
    try {
      const amountCents = parseUsdToCents(amount);
      await ledger.withTransaction((tx) =>
        postPagoDeuda(tx, {
          debtId: paying.debt.id,
          amountCents,
          accountId,
        }),
      );
      await refresh();
      setPayId(null);
      setConfirmOpen(false);
    } catch (error) {
      setMessage(errorMessage(error));
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <BackLink />

      <section className="overflow-hidden rounded-[2rem] bg-emerald-950 p-6 text-amber-50 shadow-lg shadow-emerald-950/20">
        <p className="text-xs uppercase tracking-[0.28em] text-amber-200/80">Deudas / Hipoteca</p>
        <h2 className="mt-2 font-display text-4xl">Préstamos</h2>
      </section>

      <div className="flex flex-wrap gap-2">
        <ActionBtn icon={Plus} label="Nueva deuda" onClick={() => go({ name: 'debt-edit' })} />
        <ActionBtn icon={Calculator} label="Plan hipoteca" variant="secondary" onClick={() => go({ name: 'debt-plan' })} />
      </div>

      {!views.some((row) => row.debt.kind === 'MORTGAGE') && (
        <p className="text-sm text-stone-500">Hipoteca: capital/tasa vacíos (no vienen en el Excel).</p>
      )}

      {views.length === 0 ? (
        <p className="card text-sm text-stone-500">Sin hipotecas ni préstamos</p>
      ) : (
        <CollapsibleCard id="debts.loans" title="Préstamos" defaultOpen>
          <DataTable
            caption="Préstamos"
            columns={[
              { key: 'nombre', label: 'Nombre' },
              { key: 'tipo', label: 'Tipo' },
              { key: 'saldo', label: 'Saldo', numeric: true },
              { key: 'cuota', label: 'Cuota', numeric: true },
              { key: 'proximo', label: 'Próximo' },
              { key: 'acciones', label: '' },
            ]}
          >
            {views.map((view) => {
              const accountName =
                balances.find((row) => row.account.id === view.debt.paymentAccountId)?.account.name ?? '—';
              const fundName = funds.find((row) => row.fund.id === view.debt.coverFundId)?.fund.name;
              const due = view.nextDueAt ? view.nextDueAt.slice(0, 10) : 'Saldada';
              return (
                <DataRow key={view.debt.id} onOpen={() => go({ name: 'debt-edit', id: view.debt.id })}>
                  <DataCell>
                    {view.debt.name}
                    <span className="mt-0.5 block text-xs text-stone-500">
                      {accountName}
                      {fundName ? ` · fondo ${fundName}` : ''}
                    </span>
                  </DataCell>
                  <DataCell nowrap>
                    {KIND_LABEL[view.debt.kind] ?? view.debt.kind}
                    <span className="mt-0.5 block text-xs text-stone-500">
                      {AMORT_LABEL[view.debt.amortization]}
                    </span>
                  </DataCell>
                  <DataCell numeric>{formatUsd(view.remainingCents)}</DataCell>
                  <DataCell numeric>{formatUsd(view.debt.installmentCents)}</DataCell>
                  <DataCell nowrap>{due}</DataCell>
                  <ActionsCell>
                    {view.remainingCents > 0 && view.debt.active && (
                      <ActionBtn icon={House} label="Pagar" onClick={() => openPay(view.debt.id)} />
                    )}
                    <ActionBtn
                      icon={Calculator}
                      label="Plan"
                      variant="secondary"
                      onClick={() => go({ name: 'debt-plan', id: view.debt.id })}
                    />
                    <ActionBtn
                      icon={Pencil}
                      label="Editar"
                      variant="secondary"
                      onClick={() => go({ name: 'debt-edit', id: view.debt.id })}
                    />
                  </ActionsCell>
                </DataRow>
              );
            })}
          </DataTable>
        </CollapsibleCard>
      )}

      <PartnerIouPanel />

      {paying && (
        <CollapsibleCard id="debts.pay" title={`Pagar ${paying.debt.name}`} defaultOpen>
          <p className="text-sm text-stone-600">Saldo {formatUsd(paying.remainingCents)}</p>
          <label className="block text-sm">
            Monto
            <input
              className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <label className="block text-sm">
            Cuenta
            <select
              className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            >
              {publicAccounts.map((row) => (
                <option key={row.account.id} value={row.account.id}>
                  {row.account.name}
                </option>
              ))}
            </select>
          </label>
          {preview && (
            <p className="text-sm text-stone-600">
              De {formatUsd(preview.amountCents)}: {formatUsd(preview.interestCents)} a interés y{' '}
              {formatUsd(preview.principalCents)} a capital. Saldo después {formatUsd(preview.remainingAfterCents)}.
            </p>
          )}
          {message && <p className="text-sm text-red-800">{message}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-full bg-emerald-950 px-4 py-2 text-sm text-amber-50 disabled:opacity-50"
              disabled={busy || !preview}
              onClick={() => setConfirmOpen(true)}
            >
              Confirmar pago
            </button>
            <button type="button" className="rounded-full bg-stone-200 px-4 py-2 text-sm" onClick={() => setPayId(null)}>
              Cerrar
            </button>
          </div>
        </CollapsibleCard>
      )}

      {confirmOpen && paying && preview && (
        <ConfirmDialog
          title={`Pagar ${paying.debt.name}`}
          confirmLabel="Registrar pago"
          busy={busy}
          onConfirm={() => void submitPay()}
          onCancel={() => setConfirmOpen(false)}
        >
          <p>
            Se debitará {formatUsd(preview.amountCents)} de{' '}
            {publicAccounts.find((row) => row.account.id === accountId)?.account.name ?? 'la cuenta'}.
          </p>
          <p>
            Interés {formatUsd(preview.interestCents)} · capital {formatUsd(preview.principalCents)}.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
