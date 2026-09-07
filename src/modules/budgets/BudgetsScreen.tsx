import { Banknote, Plus, Undo2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  assignGastoToBudgetItem,
  buildBudgetOverrunReport,
  centsToInput,
  envelopeForItem,
  formatUsd,
  isOperatingExpenseBeyondHorizon,
  monthlyEquivalentCents,
  parseUsdToCents,
  personMonthlyEquivalentCents,
  planReserveCover,
  redeemUnusedBudget,
  utcPeriodRef,
  type BudgetItem,
} from '../../domain';
import { errorMessage } from '../../App';
import { useFinance } from '../../stores/financeStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ActionBtn, PencilBtn } from '../ui/Icon';
import { ActionsCell, DataCell, DataRow, DataTable } from '../ui/DataTable';
import { CutoffBar, OverrunPanel } from './OverrunPanel';

type Action = {
  kind: 'spend' | 'redeem';
  item: BudgetItem;
  amount: string;
  toAccountId: string;
};

export function BudgetsScreen() {
  const {
    budgetItems,
    funds,
    balances,
    go,
    ledger,
    refresh,
    transactions,
    splitsByTx,
    cardCharges,
    budgetCutoffs,
    lastCutoffAt,
  } = useFinance();
  const scopes = ['HOME', 'Z', 'A'] as const;
  const publicAccounts = balances.filter((row) => row.account.visibility === 'PUBLIC');
  const [action, setAction] = useState<Action | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const envelopes = useMemo(
    () => budgetItems.map((item) => envelopeForItem(item, funds)),
    [budgetItems, funds],
  );
  const overrunReport = useMemo(
    () =>
      buildBudgetOverrunReport({
        items: budgetItems,
        funds: funds.map((row) => row.fund),
        transactions,
        splitsByTx,
        cardCharges,
        cutoffs: budgetCutoffs,
        period: utcPeriodRef(),
      }),
    [budgetItems, funds, transactions, splitsByTx, cardCharges, budgetCutoffs],
  );
  const lastCutoff = lastCutoffAt
    ? budgetCutoffs.find((row) => row.closedAt === lastCutoffAt) ?? budgetCutoffs.at(-1) ?? null
    : budgetCutoffs.at(-1) ?? null;

  const openSpend = (item: BudgetItem) => {
    const envelope = envelopeForItem(item, funds);
    setMessage(null);
    setConfirming(false);
    setAction({
      kind: 'spend',
      item,
      amount: envelope.reservedCents > 0 ? centsToInput(envelope.reservedCents) : '',
      toAccountId: '',
    });
  };

  const openRedeem = (item: BudgetItem) => {
    const envelope = envelopeForItem(item, funds);
    const dest = publicAccounts.find((row) => row.account.id !== envelope.accountId)?.account.id ?? '';
    setMessage(null);
    setConfirming(false);
    setAction({
      kind: 'redeem',
      item,
      amount: envelope.reservedCents > 0 ? centsToInput(envelope.reservedCents) : '',
      toAccountId: dest,
    });
  };

  const envelopeForAction = action ? envelopeForItem(action.item, funds) : null;
  const parsedAmount = (() => {
    if (!action?.amount.trim()) return null;
    try {
      return parseUsdToCents(action.amount);
    } catch {
      return null;
    }
  })();
  const destAccount = publicAccounts.find((row) => row.account.id === action?.toAccountId);
  const sourceAccount = balances.find((row) => row.account.id === envelopeForAction?.accountId);
  const spendPlan =
    action?.kind === 'spend' && parsedAmount != null && parsedAmount > 0 && envelopeForAction && sourceAccount
      ? planReserveCover({
          amountCents: parsedAmount,
          reservedCents: envelopeForAction.reservedCents,
          availableCents: sourceAccount.disponibleCents,
          coverFromReserveCents: Math.min(parsedAmount, envelopeForAction.reservedCents),
          fundName: envelopeForAction.coverFund?.name ?? action.item.name,
          accountName: sourceAccount.account.name,
        })
      : null;

  const run = async () => {
    if (!ledger || !action || parsedAmount == null) return;
    setBusy(true);
    setMessage(null);
    try {
      await ledger.withTransaction(async (tx) => {
        if (action.kind === 'spend') {
          await assignGastoToBudgetItem(tx, {
            budgetItemId: action.item.id,
            accountId: envelopeForAction?.accountId ?? '',
            amountCents: parsedAmount,
            coverFromReserveCents: Math.min(parsedAmount, envelopeForAction?.reservedCents ?? 0),
          });
        } else {
          await redeemUnusedBudget(tx, {
            budgetItemId: action.item.id,
            amountCents: parsedAmount,
            toAccountId: action.toAccountId,
          });
        }
      });
      await refresh();
      setAction(null);
      setConfirming(false);
    } catch (error) {
      setMessage(errorMessage(error));
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <ActionBtn icon={Plus} label="Nueva partida" onClick={() => go({ name: 'budget-edit' })} />
      <CutoffBar report={overrunReport} busy={busy} onCutoff={() => go({ name: 'budget-balance' })} />
      <OverrunPanel report={overrunReport} lastCutoff={lastCutoff} />
      {scopes.map((scope) => {
        const items = envelopes.filter((row) => {
          if (row.item.budgetScope !== scope) return false;
          const beyond = isOperatingExpenseBeyondHorizon(row.item, funds);
          if (beyond && row.reservedCents <= 0) return false;
          return true;
        });
        if (items.length === 0 && scope === 'A') {
          return (
            <section key={scope} className="rounded-3xl bg-white/70 p-4">
              <h2 className="text-sm uppercase tracking-[0.2em] text-stone-500">Presupuesto A</h2>
              <p className="mt-2 text-sm text-stone-500">Sin partidas</p>
            </section>
          );
        }
        if (items.length === 0) return null;
        const monthly = items.reduce(
          (sum, row) =>
            sum + monthlyEquivalentCents(row.item.frequency, row.item.amountCents, row.item.active),
          0,
        );
        return (
          <section key={scope} className="rounded-3xl bg-white/80 p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-sm uppercase tracking-[0.2em] text-stone-500">
                {scope === 'HOME' ? 'Hogar' : scope}
              </h2>
              <p className="tabular-nums text-sm">{formatUsd(monthly)} / mes</p>
            </div>
            <DataTable
              caption={`Partidas ${scope === 'HOME' ? 'Hogar' : scope}`}
              columns={[
                { key: 'nombre', label: 'Partida' },
                { key: 'fondo', label: 'Fondo' },
                { key: 'mes', label: '/ mes', numeric: true },
                { key: 'apartado', label: 'Apartado', numeric: true },
                { key: 'acciones', label: '' },
              ]}
            >
              {items.map((row) => {
                const beyond = isOperatingExpenseBeyondHorizon(row.item, funds);
                const overrun = overrunReport.rows.find(
                  (over) => over.budgetItemId === row.item.id && over.overrunCents > 0,
                );
                return (
                  <DataRow key={row.item.id} onOpen={() => go({ name: 'budget-edit', id: row.item.id })}>
                    <DataCell>
                      {row.item.name}
                      {!row.item.active ? (
                        <span className="mt-0.5 block text-xs text-stone-400">Inactiva</span>
                      ) : null}
                      {beyond ? (
                        <span className="mt-0.5 block text-xs text-amber-800">Venció (más de 3 meses)</span>
                      ) : null}
                      {overrun ? (
                        <span className="mt-0.5 block text-xs text-amber-900">
                          Te pasaste {formatUsd(overrun.overrunCents)}
                        </span>
                      ) : null}
                      <span className="mt-0.5 block text-xs text-stone-500">
                        Z {formatUsd(personMonthlyEquivalentCents(row.item, 'Z'))} · A{' '}
                        {formatUsd(personMonthlyEquivalentCents(row.item, 'A'))}
                      </span>
                    </DataCell>
                    <DataCell>
                      {row.coverFund
                        ? `${row.coverFund.name} · ${formatUsd(row.obligationCents || row.item.amountCents)}`
                        : 'Sin fondo'}
                    </DataCell>
                    <DataCell numeric>
                      {formatUsd(monthlyEquivalentCents(row.item.frequency, row.item.amountCents, row.item.active))}
                    </DataCell>
                    <DataCell numeric>
                      {row.coverFund ? formatUsd(row.reservedCents) : '—'}
                      {row.coverFund && row.leftoverCents > 0 ? (
                        <span className="mt-0.5 block text-xs font-normal text-stone-500">
                          Redimible {formatUsd(row.leftoverCents)}
                        </span>
                      ) : null}
                    </DataCell>
                    <ActionsCell>
                      <PencilBtn onClick={() => go({ name: 'budget-edit', id: row.item.id })} />
                      <ActionBtn
                        icon={Banknote}
                        label="Gastar"
                        disabled={!row.coverFund || beyond}
                        onClick={() => openSpend(row.item)}
                      />
                      <ActionBtn
                        icon={Undo2}
                        label="Redimir"
                        variant="secondary"
                        disabled={!row.coverFund || row.reservedCents <= 0}
                        onClick={() => openRedeem(row.item)}
                      />
                    </ActionsCell>
                  </DataRow>
                );
              })}
            </DataTable>
          </section>
        );
      })}

      {action && envelopeForAction && !confirming && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-emerald-950/40 p-4 sm:items-center">
          <form
            className="w-full max-w-md space-y-4 rounded-[2rem] bg-white p-5"
            onSubmit={(event) => {
              event.preventDefault();
              setMessage(null);
              if (parsedAmount == null || parsedAmount <= 0) {
                setMessage('Indica un monto válido');
                return;
              }
              if (action.kind === 'redeem' && parsedAmount > envelopeForAction.reservedCents) {
                setMessage(`Solo hay ${formatUsd(envelopeForAction.reservedCents)} apartado`);
                return;
              }
              if (action.kind === 'spend' && spendPlan && !spendPlan.feasible) {
                setMessage(spendPlan.rejection ?? 'No hay disponible para el sobrecosto');
                return;
              }
              if (action.kind === 'redeem' && !action.toAccountId) {
                setMessage('Elige la cuenta destino');
                return;
              }
              setConfirming(true);
            }}
          >
            <h2 className="font-display text-2xl text-ink">
              {action.kind === 'spend' ? 'Gastar presupuesto' : 'Redimir no usado'}
            </h2>
            <p className="text-sm text-stone-600">
              {action.item.name}
              {envelopeForAction.coverFund ? ` · fondo ${envelopeForAction.coverFund.name}` : ''}
            </p>
            <p className="rounded-2xl bg-emerald-950/5 px-4 py-3 text-sm">
              Apartado ahora:{' '}
              <strong className="tabular-nums">{formatUsd(envelopeForAction.reservedCents)}</strong>
              {sourceAccount && (
                <span className="mt-1 block text-xs text-stone-500">Cuenta {sourceAccount.account.name}</span>
              )}
            </p>
            <label className="block text-sm">
              Cantidad
              <input
                className="mt-1 w-full rounded-2xl bg-stone-100 p-3 tabular-nums"
                value={action.amount}
                onChange={(event) => setAction({ ...action, amount: event.target.value })}
                inputMode="decimal"
                required
              />
            </label>
            {action.kind === 'redeem' && (
              <label className="block text-sm">
                Enviar a
                <select
                  className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
                  value={action.toAccountId}
                  onChange={(event) => setAction({ ...action, toAccountId: event.target.value })}
                >
                  <option value="">Elige cuenta</option>
                  {publicAccounts
                    .filter((row) => row.account.id !== envelopeForAction.accountId)
                    .map((row) => (
                      <option key={row.account.id} value={row.account.id}>
                        {row.account.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {message && <p className="text-sm text-red-800">{message}</p>}
            <div className="flex gap-2">
              <button type="submit" className="btn-primary flex-1 py-3 text-sm">
                Continuar
              </button>
              <button
                type="button"
                className="rounded-full bg-stone-200 px-4 py-3 text-sm"
                onClick={() => setAction(null)}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}

      {action && confirming && envelopeForAction && parsedAmount != null && (
        <ConfirmDialog
          title={action.kind === 'spend' ? '¿Sustraer del presupuesto?' : '¿Redimir a otra cuenta?'}
          confirmLabel={action.kind === 'spend' ? 'Sí, registrar gasto' : 'Sí, redimir'}
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void run()}
        >
          {action.kind === 'spend' ? (
            <>
              <p>
                Vas a registrar <strong className="tabular-nums">{formatUsd(parsedAmount)}</strong> de{' '}
                <strong>{action.item.name}</strong>.
              </p>
              {spendPlan && (
                <p>
                  Apartado {formatUsd(spendPlan.reservedCents)}. A consumir {formatUsd(spendPlan.consumedCents)}. A
                  salir de disponible (exceso) {formatUsd(spendPlan.fromAvailableCents)}. Quedará apartado{' '}
                  {formatUsd(spendPlan.leftoverReserveCents)}.
                </p>
              )}
              <p>
                Sale de {sourceAccount?.account.name ?? 'la cuenta del fondo'}. Esto sí es un gasto. El sobrante de
                reserva no se redime solo.
              </p>
            </>
          ) : (
            <>
              <p>
                Vas a redimir <strong className="tabular-nums">{formatUsd(parsedAmount)}</strong> no usados de{' '}
                <strong>{action.item.name}</strong>.
              </p>
              <p>
                Origen: {sourceAccount?.account.name ?? 'cuenta'} / {envelopeForAction.coverFund?.name}. Destino:{' '}
                {destAccount?.account.name ?? '—'}.
              </p>
              <p>Esto no es un gasto. El dinero cambia de cuenta y sale del presupuesto apartado.</p>
            </>
          )}
          {message && <p className="text-red-800">{message}</p>}
        </ConfirmDialog>
      )}
    </div>
  );
}
