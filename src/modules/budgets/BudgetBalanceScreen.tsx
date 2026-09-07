import { useMemo, useState } from 'react';
import {
  areaOverrunRows,
  buildBudgetOverrunReport,
  cutoffDestinationAccounts,
  executeBudgetCutoff,
  formatUsd,
  itemLeftoverCents,
  personShareCents,
  planCutoffTransfer,
  utcPeriodRef,
} from '../../domain';
import { errorMessage } from '../../App';
import { useFinance } from '../../stores/financeStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { BackLink } from '../ui/Icon';
import { CollapsibleCard } from '../ui/CollapsibleCard';
import { CutoffBar, OverrunPanel } from './OverrunPanel';

export function BudgetBalanceScreen() {
  const {
    budgetItems,
    funds,
    balances,
    transactions,
    splitsByTx,
    cardCharges,
    budgetCutoffs,
    lastCutoffAt,
    ledger,
    refresh,
  } = useFinance();
  const destinations = useMemo(
    () => cutoffDestinationAccounts(balances.map((row) => row.account)),
    [balances],
  );
  const [toAccountId, setToAccountId] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reservedByFund = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of funds) map.set(row.fund.id, row.reservedCents);
    return map;
  }, [funds]);

  const accountSaldoById = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of balances) map.set(row.account.id, row.saldoCents);
    return map;
  }, [balances]);

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

  const plan = useMemo(
    () =>
      planCutoffTransfer({
        items: budgetItems,
        funds: funds.map((row) => row.fund),
        accounts: balances.map((row) => row.account),
        reservedByFund,
        accountSaldoById,
        transactions,
        splitsByTx,
        cardCharges,
        period: utcPeriodRef(),
        toAccountId,
        cutoffs: budgetCutoffs,
      }),
    [
      budgetItems,
      funds,
      balances,
      reservedByFund,
      accountSaldoById,
      transactions,
      splitsByTx,
      cardCharges,
      toAccountId,
      budgetCutoffs,
    ],
  );

  const lastCutoff = lastCutoffAt
    ? budgetCutoffs.find((row) => row.closedAt === lastCutoffAt) ?? budgetCutoffs.at(-1) ?? null
    : budgetCutoffs.at(-1) ?? null;

  const leftoverLines = plan.lines.filter((line) => line.leftoverCents > 0);

  const openCutoff = () => {
    setMessage(null);
    setToAccountId('');
    setConfirming(true);
  };

  const runCutoff = async () => {
    if (!ledger || !plan.feasible) return;
    setBusy(true);
    setMessage(null);
    try {
      await ledger.withTransaction((tx) =>
        executeBudgetCutoff(tx, { toAccountId: plan.toAccountId || undefined }),
      );
      await refresh();
      setConfirming(false);
      setToAccountId('');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <BackLink />
      <CollapsibleCard id="budget.hero" title="Balance" surface="hero" defaultOpen>
        <h2 className="font-display text-4xl">Presupuesto</h2>
      </CollapsibleCard>

      <CutoffBar report={overrunReport} busy={busy} onCutoff={openCutoff} />

      {(['HOME', 'Z', 'A'] as const).map((scope) => {
        const items = budgetItems.filter((item) => item.budgetScope === scope);
        if (items.length === 0) return null;
        const areaRows = areaOverrunRows(
          overrunReport.rows.filter((row) => items.some((item) => item.id === row.budgetItemId)),
        );
        return (
          <CollapsibleCard key={scope} id={`budget.scope-${scope}`} title={scope === 'HOME' ? 'Hogar' : scope} defaultOpen>
            <ul className="space-y-3">
              {items.map((item) => {
                const row = overrunReport.rows.find((entry) => entry.budgetItemId === item.id);
                const reserved = item.coverFundId ? (reservedByFund.get(item.coverFundId) ?? 0) : 0;
                const leftover = itemLeftoverCents(reserved, row?.budgetedCents ?? 0, row?.spentCents ?? 0);
                return (
                  <li key={item.id} className="border-t border-stone-200/80 pt-3 first:border-t-0 first:pt-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span>
                        {item.name}
                        <span className="mt-0.5 block text-xs text-stone-500">
                          Z {formatUsd(personShareCents(item, 'Z'))} · A {formatUsd(personShareCents(item, 'A'))}
                        </span>
                      </span>
                      <span className="tabular-nums text-sm">{formatUsd(row?.spentCents ?? 0)}</span>
                    </div>
                    <p className="mt-1 text-xs text-stone-500">
                      Estimado {formatUsd(row?.budgetedCents ?? 0)}
                      {leftover > 0 ? ` · excedente ${formatUsd(leftover)}` : ''}
                      {(row?.overrunCents ?? 0) > 0 ? ` · me pasé ${formatUsd(row?.overrunCents ?? 0)}` : ''}
                    </p>
                  </li>
                );
              })}
            </ul>
            {areaRows.length > 0 && (
              <p className="mt-3 text-xs text-stone-500">
                {areaRows
                  .map((row) => `${row.area} ${formatUsd(row.spentCents)} / ${formatUsd(row.budgetedCents)}`)
                  .join(' · ')}
              </p>
            )}
          </CollapsibleCard>
        );
      })}

      <OverrunPanel report={overrunReport} lastCutoff={lastCutoff} />
      {message && <p className="text-sm text-red-800">{message}</p>}

      {confirming && (
        <ConfirmDialog
          title={`¿${overrunReport.label}?`}
          confirmLabel={plan.totalLeftoverCents > 0 ? 'Sí, cortar y mover' : 'Sí, cortar'}
          busy={busy}
          confirmDisabled={!plan.feasible}
          onCancel={() => {
            setConfirming(false);
            setToAccountId('');
          }}
          onConfirm={() => void runCutoff()}
        >
          {leftoverLines.map((line) => (
            <p key={line.budgetItemId}>
              {line.name}: {formatUsd(line.leftoverCents)} de {line.sourceAccountName}/{line.fundName}
              {toAccountId
                ? line.disposition === 'RELEASE'
                  ? ' · se libera'
                  : ' · se transfiere'
                : ''}
              . Apartado {formatUsd(line.sourceReservedBeforeCents)} → {formatUsd(line.sourceReservedAfterCents)}.
            </p>
          ))}
          {plan.totalLeftoverCents > 0 && (
            <label className="block text-sm text-ink">
              ¿A qué cuenta de ahorro va el excedente?
              <select
                className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
                value={toAccountId}
                onChange={(event) => setToAccountId(event.target.value)}
              >
                <option value="">Elige cuenta</option>
                {destinations.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {plan.totalLeftoverCents > 0 && !toAccountId && (
            <p>No hay destino por defecto: hay que elegirla para cortar.</p>
          )}
          {toAccountId && plan.totalTransferredCents > 0 && (
            <p>
              Se manda <strong className="tabular-nums">{formatUsd(plan.totalTransferredCents)}</strong> a{' '}
              {plan.toAccountName}. Destino queda en{' '}
              <strong className="tabular-nums">{formatUsd(plan.destinationSaldoAfterCents)}</strong> (ahora{' '}
              {formatUsd(plan.destinationSaldoBeforeCents)}).
            </p>
          )}
          {toAccountId && plan.totalReleasedCents > 0 && (
            <p>Se libera {formatUsd(plan.totalReleasedCents)} en {plan.toAccountName} (deja de estar retenido).</p>
          )}
          <p>Me pasé {formatUsd(plan.totalOverrunCents)}: no se mueve como sobrante.</p>
          {plan.rejection && toAccountId ? <p className="text-red-800">{plan.rejection}</p> : null}
        </ConfirmDialog>
      )}
    </div>
  );
}
