import { useMemo, useState } from 'react';
import {
  formatUsd,
  utcMonthLabel,
  utcYearMonthFromDate,
  shiftUtcMonth,
  buildMonthlySpendReport,
  buildBudgetOverrunReport,
  buildFundSetAnalytics,
  utcPeriodRef,
  type UtcYearMonth,
} from '../../domain';
import { useFinance } from '../../stores/financeStore';
import { CutoffBar, OverrunPanel } from '../budgets/OverrunPanel';
import { BackLink } from '../ui/Icon';
import { CollapsibleCard } from '../ui/CollapsibleCard';
import { DataCell, DataRow, DataTable } from '../ui/DataTable';

function pctUsed(spent: number, budgeted: number): number {
  if (budgeted <= 0) return spent > 0 ? 100 : 0;
  return Math.min(100, Math.trunc((spent * 100) / budgeted));
}

function Delta({ spent, budgeted, onDark = false }: { spent: number; budgeted: number; onDark?: boolean }) {
  const left = budgeted - spent;
  if (budgeted === 0 && spent === 0) {
    return <span className={onDark ? 'text-amber-100/70' : 'text-stone-500'}>Sin partida</span>;
  }
  if (left >= 0) {
    return <span>Quedan {formatUsd(left)}</span>;
  }
  return <span className={onDark ? 'text-amber-200' : 'text-amber-800'}>Pasó {formatUsd(-left)}</span>;
}

export function MonthlySpendScreen() {
  const {
    budgetItems,
    funds,
    accounts,
    transactions,
    splitsByTx,
    cardCharges,
    go,
    budgetCutoffs,
    lastCutoffAt,
  } = useFinance();
  const [yearMonth, setYearMonth] = useState<UtcYearMonth>(() => utcYearMonthFromDate(new Date()));
  const current = utcYearMonthFromDate(new Date());
  const publicFunds = useMemo(() => {
    const publicIds = new Set(accounts.filter((row) => row.visibility === 'PUBLIC').map((row) => row.id));
    return funds.map((row) => row.fund).filter((fund) => publicIds.has(fund.accountId));
  }, [accounts, funds]);

  const report = useMemo(
    () =>
      buildMonthlySpendReport({
        items: budgetItems,
        funds: publicFunds,
        transactions,
        splitsByTx,
        cardCharges,
        yearMonth,
      }),
    [budgetItems, publicFunds, transactions, splitsByTx, cardCharges, yearMonth],
  );
  const fundAnalytics = useMemo(
    () =>
      buildFundSetAnalytics({
        items: budgetItems,
        funds: publicFunds,
        transactions,
        splitsByTx,
        cardCharges,
        yearMonth,
      }),
    [budgetItems, publicFunds, transactions, splitsByTx, cardCharges, yearMonth],
  );
  const overrunReport = useMemo(
    () =>
      buildBudgetOverrunReport({
        items: budgetItems,
        funds: publicFunds,
        transactions,
        splitsByTx,
        cardCharges,
        cutoffs: budgetCutoffs,
        period: utcPeriodRef(),
      }),
    [budgetItems, publicFunds, transactions, splitsByTx, cardCharges, budgetCutoffs],
  );
  const lastCutoff = lastCutoffAt
    ? budgetCutoffs.find((row) => row.closedAt === lastCutoffAt) ?? budgetCutoffs.at(-1) ?? null
    : budgetCutoffs.at(-1) ?? null;

  const used = pctUsed(report.totalSpentCents, report.totalBudgetedMonthlyCents);
  const scopes = [
    { label: 'Hogar', row: report.home },
    { label: 'Z', row: report.personZ },
    { label: 'A', row: report.personA },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink />
        <button type="button" className="text-sm text-duty" onClick={() => go({ name: 'movements', list: 'gastos' })}>
          Lista de gastos
        </button>
      </div>

      <CollapsibleCard id="spend.hero" title="Este mes" surface="hero" defaultOpen>
        <h2 className="font-display text-4xl capitalize">{utcMonthLabel(yearMonth)}</h2>
        <p className="mt-4 font-display text-5xl tabular-nums tracking-tight">{formatUsd(report.totalSpentCents)}</p>
        <p className="mt-2 text-sm text-cream/85">
          Gastado · presupuestado {formatUsd(report.totalBudgetedMonthlyCents)} / mes
        </p>
        <div className="mt-6 h-2 overflow-hidden rounded-full bg-duty/50">
          <div className="h-full rounded-full bg-hope" style={{ width: `${used}%` }} />
        </div>
        <p className="mt-2 text-xs text-cream/75">
          <Delta spent={report.totalSpentCents} budgeted={report.totalBudgetedMonthlyCents} onDark />
        </p>
        <div className="mt-5 flex gap-2">
          <button
            type="button"
            className="rounded-full bg-white/15 px-4 py-2 text-sm text-cream"
            onClick={() => setYearMonth(shiftUtcMonth(yearMonth, -1))}
          >
            Mes anterior
          </button>
          {(yearMonth.year !== current.year || yearMonth.month !== current.month) && (
            <button
              type="button"
              className="rounded-full bg-hope px-4 py-2 text-sm text-ink"
              onClick={() => setYearMonth(current)}
            >
              Mes en curso
            </button>
          )}
        </div>
      </CollapsibleCard>

      <CutoffBar report={overrunReport} busy={false} onCutoff={() => go({ name: 'budget-balance' })} />
      <OverrunPanel report={overrunReport} lastCutoff={lastCutoff} />

      <CollapsibleCard id="spend.conjunto" title="Conjunto" defaultOpen>
        <ul className="space-y-3">
          {scopes.map(({ label, row }) => (
            <li key={row.scope} className="flex items-baseline justify-between gap-3">
              <span>
                <span className="text-lg text-ink">{label}</span>
                <span className="mt-0.5 block text-xs text-stone-500">
                  Presupuestado {formatUsd(row.budgetedMonthlyCents)} / mes
                </span>
              </span>
              <span className="text-right">
                <span className="block tabular-nums">{formatUsd(row.spentCents)}</span>
                <span className="text-xs text-stone-500">
                  <Delta spent={row.spentCents} budgeted={row.budgetedMonthlyCents} />
                </span>
              </span>
            </li>
          ))}
          <li className="flex items-baseline justify-between gap-3 border-t border-stone-200 pt-3">
            <span className="font-display text-xl text-ink">Total</span>
            <span className="text-right">
              <span className="block tabular-nums text-lg">{formatUsd(report.totalSpentCents)}</span>
              <span className="text-xs text-stone-500">vs {formatUsd(report.totalBudgetedMonthlyCents)}</span>
            </span>
          </li>
        </ul>
      </CollapsibleCard>

      {fundAnalytics.funds.length > 0 && (
        <CollapsibleCard id="spend.funds" title="Gastos por fondo" defaultOpen>
          <DataTable
            caption="Gastos por fondo"
            columns={[
              { key: 'fondo', label: 'Fondo' },
              { key: 'gastado', label: 'Gastado', numeric: true },
              { key: 'presup', label: 'Presup.', numeric: true },
              { key: 'resta', label: 'Resta', numeric: true },
              { key: 'excede', label: 'Excede' },
            ]}
          >
            {fundAnalytics.funds.map((row) => (
              <DataRow key={row.fundId}>
                <DataCell>{row.fundName}</DataCell>
                <DataCell numeric>{formatUsd(row.spentCents)}</DataCell>
                <DataCell numeric>{formatUsd(row.budgetedMonthlyCents)}</DataCell>
                <DataCell numeric>{formatUsd(row.varianceCents > 0 ? row.varianceCents : 0)}</DataCell>
                <DataCell nowrap>
                  {row.overBudget ? (
                    <span className="text-spend">Sí · {formatUsd(-row.varianceCents)}</span>
                  ) : (
                    'No'
                  )}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        </CollapsibleCard>
      )}

      <section className="grid gap-3 sm:grid-cols-2">
        <PersonCard
          title="Z"
          quincenal={report.personZ.quincenalCents}
          mensual={report.personZ.mensualCents}
          equivalent={report.personZ.budgetedMonthlyCents}
        />
        <PersonCard
          title="A"
          quincenal={report.personA.quincenalCents}
          mensual={report.personA.mensualCents}
          equivalent={report.personA.budgetedMonthlyCents}
        />
      </section>

      <CollapsibleCard id="spend.areas" title="Por área">
        {report.areas.length === 0 ? (
          <p className="text-sm text-stone-500">No hay partidas ni gastos en este mes.</p>
        ) : (
          <ul className="space-y-4">
            {report.areas.map((row) => {
              const usedArea = pctUsed(row.spentCents, row.budgetedMonthlyCents);
              return (
                <li key={row.area}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-lg text-ink">{row.area}</span>
                    <span className="tabular-nums">{formatUsd(row.spentCents)}</span>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-200">
                    <div className="h-full rounded-full bg-hope" style={{ width: `${usedArea}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-stone-500">
                    Presupuestado {formatUsd(row.budgetedMonthlyCents)} / mes
                    {' · '}
                    <Delta spent={row.spentCents} budgeted={row.budgetedMonthlyCents} />
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </CollapsibleCard>
    </div>
  );
}

function PersonCard({
  title,
  quincenal,
  mensual,
  equivalent,
}: {
  title: string;
  quincenal: number;
  mensual: number;
  equivalent: number;
}) {
  return (
    <CollapsibleCard id={`spend.person-${title}`} title={`Persona ${title}`} surface="tile" defaultOpen>
      <p className="font-display text-3xl tabular-nums text-ink">{formatUsd(equivalent)}</p>
      <p className="text-xs text-stone-500">Equivalente mensual</p>
      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-stone-600">Quincenal</dt>
          <dd className="tabular-nums">{formatUsd(quincenal)} / Q</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-stone-600">Mensual</dt>
          <dd className="tabular-nums">{formatUsd(mensual)} / mes</dd>
        </div>
      </dl>
    </CollapsibleCard>
  );
}
