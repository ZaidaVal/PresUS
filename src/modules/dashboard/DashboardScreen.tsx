import { useMemo } from 'react';
import { Bell, Landmark, Pencil, Receipt } from 'lucide-react';
import {
  buildFundSetAnalytics,
  describeMovement,
  dashboardListedAccounts,
  formatFundDueDate,
  formatUsd,
  homeZaBudgetedCents,
  isAtlantidaAccount,
  monthSpendCompare,
  movementTypeLabel,
  oneCardSpendTotals,
  onePendingReservaSummary,
  oneVsAtlantidaCents,
  pendingReservaByMonth,
  priorityFundsDueSoon,
  utcMonthLabel,
  visiblePostedMovements,
  type FundSpendRow,
} from '../../domain';
import { useFinance } from '../../stores/financeStore';
import { CollapsibleCard } from '../ui/CollapsibleCard';
import { DataCell, DataRow, DataTable } from '../ui/DataTable';
import { HubGlyph } from '../ui/Icon';
import { CompareBars, DonutChart, MagnitudeBars, TrendBars } from './DashboardCharts';

function dashboardMovementLabel(type: string): string {
  if (type === 'RESERVA') return 'Apartar';
  if (type === 'LIBERACION_RESERVA') return 'Liberación';
  return movementTypeLabel(type);
}

function reservaBreakdown(summary: ReturnType<typeof onePendingReservaSummary>): string {
  const parts: string[] = [];
  if (summary.presupuestoCents > 0) parts.push(`presupuesto ${formatUsd(summary.presupuestoCents)}`);
  if (summary.bolsilloZCents > 0) parts.push(`bolsillo Z ${formatUsd(summary.bolsilloZCents)}`);
  if (summary.bolsilloACents > 0) parts.push(`bolsillo A ${formatUsd(summary.bolsilloACents)}`);
  if (summary.gastoXCents > 0) parts.push(`Gasto X ${formatUsd(summary.gastoXCents)}`);
  return parts.join(' · ');
}

function deltaLabel(cents: number): string {
  if (cents === 0) return 'Igual que el mes anterior';
  if (cents > 0) return `+${formatUsd(cents)} vs mes anterior`;
  return `${formatUsd(cents)} vs mes anterior`;
}

function remainingCents(row: FundSpendRow): number {
  return row.varianceCents > 0 ? row.varianceCents : 0;
}

function overrunCents(row: FundSpendRow): number {
  return row.overBudget ? -row.varianceCents : 0;
}

function FundSpendTable({ rows }: { rows: FundSpendRow[] }) {
  return (
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
      {rows.map((row) => (
        <DataRow key={row.fundId}>
          <DataCell>{row.fundName}</DataCell>
          <DataCell numeric>{formatUsd(row.spentCents)}</DataCell>
          <DataCell numeric>{formatUsd(row.budgetedMonthlyCents)}</DataCell>
          <DataCell numeric>{formatUsd(remainingCents(row))}</DataCell>
          <DataCell nowrap>
            {row.overBudget ? (
              <span className="text-spend">Sí · {formatUsd(overrunCents(row))}</span>
            ) : (
              'No'
            )}
          </DataCell>
        </DataRow>
      ))}
    </DataTable>
  );
}

export function DashboardScreen() {
  const {
    safe,
    transactions,
    splitsByTx,
    cardCharges,
    balances,
    accounts,
    budgetItems,
    funds,
    cards,
    creditCards,
    dashboardPrefs,
    go,
  } = useFinance();
  if (!safe) return null;

  const now = useMemo(() => new Date(), []);
  const publicAccountIds = useMemo(
    () => new Set(accounts.filter((row) => row.visibility === 'PUBLIC').map((row) => row.id)),
    [accounts],
  );
  const spendInput = useMemo(
    () => ({
      items: budgetItems,
      funds: funds.map((row) => row.fund).filter((fund) => publicAccountIds.has(fund.accountId)),
      transactions,
      splitsByTx,
      cardCharges,
      now,
    }),
    [budgetItems, funds, publicAccountIds, transactions, splitsByTx, cardCharges, now],
  );

  const monthCompare = useMemo(() => monthSpendCompare(spendInput), [spendInput]);
  const fundAnalytics = useMemo(() => buildFundSetAnalytics(spendInput), [spendInput]);
  const dueSoon = useMemo(() => priorityFundsDueSoon(funds, now), [funds, now]);
  const oneSpend = useMemo(
    () => oneCardSpendTotals(creditCards, cardCharges, transactions, monthCompare.current.yearMonth),
    [creditCards, cardCharges, transactions, monthCompare.current.yearMonth],
  );
  const homeBudget = useMemo(() => homeZaBudgetedCents(budgetItems), [budgetItems]);
  const reservaTrend = useMemo(
    () => pendingReservaByMonth(transactions, cardCharges, now, 4),
    [transactions, cardCharges, now],
  );

  const limitedCard = cards.find((row) => row.card.id === safe.limitedCardId);
  const oneOwedCents = limitedCard?.saldoCents ?? 0;
  const oneAtl = oneVsAtlantidaCents(safe, balances, oneOwedCents);

  const oneCents = Math.max(0, safe.limitedCardRemainingCents);
  const reservas = onePendingReservaSummary(cardCharges);
  const recent = visiblePostedMovements(transactions).slice(0, 5);
  const reservaHint = reservaBreakdown(reservas);
  const listed = dashboardListedAccounts(balances, dashboardPrefs.featuredAccountIds);
  const bookEmpty = accounts.length === 0 && recent.length === 0;

  const spent = monthCompare.current.totalSpentCents;
  const budgeted = monthCompare.current.totalBudgetedMonthlyCents;
  const hasSpendData = spent > 0 || budgeted > 0;
  const hasZaData =
    homeBudget.zCents > 0 ||
    homeBudget.aCents > 0 ||
    monthCompare.current.personZ.spentCents > 0 ||
    monthCompare.current.personA.spentCents > 0;
  const hasOneData = oneOwedCents > 0 || oneAtl.atlantidaApartadoCents > 0 || oneCents > 0;
  const hasReservaTrend = reservaTrend.some((point) => point.pendingCents > 0);
  const hasOneSpend = oneSpend.lineTotalCents > 0;
  const hasFundKpis = fundAnalytics.totalSpentCents > 0 || fundAnalytics.fundSetBudgetedCents > 0;

  return (
    <div className="space-y-5">
      {dueSoon.length > 0 && (
        <CollapsibleCard
          id="home.due-soon"
          title="Pagar pronto"
          icon={<Bell className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
          defaultOpen
          className="border-hope/40 bg-hope/15"
          titleClassName="text-ink"
        >
          <ul className="space-y-2">
            {dueSoon.map((row) => (
              <li key={row.fund.id}>
                <button
                  type="button"
                  className="flex w-full items-baseline justify-between gap-3 text-left"
                  title={`${row.fund.name} vence ${formatFundDueDate(row.dueAt)}`}
                  onClick={() => go({ name: 'funds' })}
                >
                  <span>
                    <span className="font-medium">{row.fund.name}</span>
                    <span className="mt-0.5 block text-xs text-stone-600">
                      {formatFundDueDate(row.dueAt)}
                      {row.daysUntil === 0 ? ' · hoy' : row.daysUntil === 1 ? ' · mañana' : ` · en ${row.daysUntil} días`}
                    </span>
                  </span>
                  <span className="tabular-nums text-sm">{formatUsd(row.reservedCents)}</span>
                </button>
              </li>
            ))}
          </ul>
        </CollapsibleCard>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="tile flex items-center gap-2 text-left"
          title="Lista de gastos"
          onClick={() => go({ name: 'movements', list: 'gastos' })}
        >
          <HubGlyph icon={Receipt} tone="square" />
          <span className="text-sm font-medium">Gastos</span>
        </button>
        <button
          type="button"
          className="tile flex items-center gap-2 text-left"
          title="Tabla de fondos"
          onClick={() => go({ name: 'funds' })}
        >
          <HubGlyph icon={Landmark} tone="view" />
          <span className="text-sm font-medium">Fondos</span>
        </button>
      </div>
      {bookEmpty && (
        <CollapsibleCard id="home.empty" title="Libro" defaultOpen>
          <p className="text-sm text-stone-600">Sin cuentas todavía. El libro está vacío.</p>
          <p className="mt-2 text-xs text-stone-500">Aún no hay historial ni gráficas de control.</p>
        </CollapsibleCard>
      )}
      {!bookEmpty && (
        <CollapsibleCard
          id="home.barras"
          title="Sobra en Barras"
          surface="hero"
          defaultOpen
          summary={formatUsd(safe.barrasDisponibleUiCents)}
        >
          <p className="font-display text-5xl tabular-nums tracking-tight">
            {formatUsd(safe.barrasDisponibleUiCents)}
          </p>
        </CollapsibleCard>
      )}

      {listed.length > 0 && (
        <CollapsibleCard id="home.accounts" title="Cuentas">
          <ul className="space-y-3">
            {listed.map((row) => {
              const atlantida = isAtlantidaAccount(row.account);
              return (
                <li key={row.account.id}>
                  <button
                    type="button"
                    className="flex w-full items-baseline justify-between gap-3 text-left"
                    onClick={() => go({ name: 'account', id: row.account.id })}
                  >
                    <span>
                      <span className="font-medium">{row.account.name}</span>
                      <span className="mt-0.5 block text-xs text-stone-400">
                        {atlantida ? 'Apartado para pagar ONE' : 'Sobra'}
                      </span>
                    </span>
                    <span className="tabular-nums text-sm">
                      {formatUsd(atlantida ? row.reservedCents : row.disponibleUiCents)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </CollapsibleCard>
      )}

      {!bookEmpty && hasFundKpis && (
        <CollapsibleCard
          id="home.kpis"
          title="KPIs del mes"
          defaultOpen
          summary={formatUsd(fundAnalytics.totalSpentCents)}
        >
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-stone-400">Gastos totales</dt>
              <dd className="font-medium tabular-nums">{formatUsd(fundAnalytics.totalSpentCents)}</dd>
            </div>
            <div>
              <dt className="text-xs text-stone-400">
                {fundAnalytics.fundSetVarianceCents >= 0 ? 'Sobra en fondos' : 'Fondos de más'}
              </dt>
              <dd className="font-medium tabular-nums">{formatUsd(Math.abs(fundAnalytics.fundSetVarianceCents))}</dd>
            </div>
            <div>
              <dt className="text-xs text-stone-400">Z a fondos Q / mes</dt>
              <dd className="tabular-nums">
                {formatUsd(fundAnalytics.personZ.quincenalCents)} / {formatUsd(fundAnalytics.personZ.mensualCents)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-stone-400">A a fondos Q / mes</dt>
              <dd className="tabular-nums">
                {formatUsd(fundAnalytics.personA.quincenalCents)} / {formatUsd(fundAnalytics.personA.mensualCents)}
              </dd>
            </div>
          </dl>
          {fundAnalytics.funds.length > 0 && (
            <div className="mt-3">
              <p className="mb-2 text-xs uppercase tracking-[0.2em] text-stone-400">Gastos por fondo</p>
              <FundSpendTable rows={fundAnalytics.funds} />
            </div>
          )}
        </CollapsibleCard>
      )}

      {!bookEmpty && hasSpendData && (
        <CollapsibleCard
          id="home.spend-vs-budget"
          title="Gastado vs presupuesto"
          actions={
            <button type="button" className="text-sm text-duty" onClick={() => go({ name: 'monthly-spend' })}>
              Este mes
            </button>
          }
        >
          <DonutChart
            slices={[
              {
                label: 'Gastado',
                cents: spent,
                color: 'color-mix(in srgb, var(--spend) 70%, var(--ink))',
              },
              {
                label: 'Presupuesto',
                cents: Math.max(0, budgeted - spent),
                color: 'color-mix(in srgb, var(--hope) 55%, var(--cream))',
              },
            ]}
          />
          <p className="mt-4 text-xs text-stone-500">
            {utcMonthLabel(monthCompare.current.yearMonth)} · presupuesto mensual {formatUsd(budgeted)}
          </p>
        </CollapsibleCard>
      )}

      {!bookEmpty && (monthCompare.current.totalSpentCents > 0 || monthCompare.previous.totalSpentCents > 0) && (
        <CollapsibleCard id="home.month-compare" title="Mes vs mes anterior">
          <CompareBars
            leftLabel={utcMonthLabel(monthCompare.current.yearMonth)}
            rightLabel={utcMonthLabel(monthCompare.previous.yearMonth)}
            left={{
              label: 'Gastado',
              cents: monthCompare.current.totalSpentCents,
              color: 'color-mix(in srgb, var(--duty) 42%, var(--cream))',
            }}
            right={{
              label: 'Gastado',
              cents: monthCompare.previous.totalSpentCents,
              color: 'color-mix(in srgb, var(--duty) 22%, var(--cream))',
            }}
          />
          <p className="mt-3 text-xs text-stone-500">{deltaLabel(monthCompare.spentDeltaCents)}</p>
        </CollapsibleCard>
      )}

      {!bookEmpty && hasZaData && (
        <CollapsibleCard id="home.za" title="Z vs A (partidas HOME)">
          <DonutChart
            slices={[
              {
                label: 'Z gastado',
                cents: monthCompare.current.personZ.spentCents,
                color: 'color-mix(in srgb, var(--duty) 38%, var(--cream))',
              },
              {
                label: 'A gastado',
                cents: monthCompare.current.personA.spentCents,
                color: 'color-mix(in srgb, var(--hope) 45%, var(--cream))',
              },
            ]}
          />
          <p className="mt-4 text-xs text-stone-500">
            Presupuesto mensual Z {formatUsd(homeBudget.zCents)} · A {formatUsd(homeBudget.aCents)}
          </p>
        </CollapsibleCard>
      )}

      {!bookEmpty && (
      <CollapsibleCard id="home.one" title="ONE y reservas">
        <div>
          {hasOneData ? (
            <MagnitudeBars
              quiet
              rows={[
                {
                  label: 'Debe ONE',
                  cents: oneAtl.oneOwedCents,
                  color: 'color-mix(in srgb, var(--spend) 55%, var(--cream))',
                },
                {
                  label: 'Cupo ONE',
                  cents: oneAtl.oneCupoLeftCents,
                  color: 'color-mix(in srgb, var(--duty) 42%, var(--cream))',
                },
                {
                  label: 'Apartado Atlántida',
                  cents: oneAtl.atlantidaApartadoCents,
                  color: 'color-mix(in srgb, var(--hope) 50%, var(--cream))',
                },
                {
                  label: 'Reservas pendientes',
                  cents: reservas.totalCents,
                  color: 'color-mix(in srgb, var(--duty) 26%, var(--cream))',
                },
              ]}
            />
          ) : (
            <p className="text-sm text-stone-500">Sin cargos ONE ni apartado todavía.</p>
          )}
        </div>
        {reservaHint ? (
          <p className="mt-3 text-xs text-stone-400">{reservaHint}</p>
        ) : (
          <p className="mt-3 text-xs text-stone-400">Cargos ONE por cubrir</p>
        )}
      </CollapsibleCard>
      )}

      {!bookEmpty && hasOneSpend && (
        <CollapsibleCard id="home.one-spend" title="Gastos ONE">
          <ul className="space-y-2 text-sm">
            {oneSpend.cards.map((row) => (
              <li key={row.cardId} className="flex justify-between gap-3">
                <span>{row.cardName}</span>
                <span className="tabular-nums">{formatUsd(row.spentCents)}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3 border-t border-duty/10 pt-2 font-medium">
              <span>Línea</span>
              <span className="tabular-nums">{formatUsd(oneSpend.lineTotalCents)}</span>
            </li>
          </ul>
        </CollapsibleCard>
      )}

      {!bookEmpty && hasReservaTrend && (
        <CollapsibleCard id="home.reserva-trend" title="Tendencia reservas (ONE por cubrir)">
          <TrendBars
            points={reservaTrend.map((point) => ({
              label: utcMonthLabel(point.yearMonth).slice(0, 3),
              cents: point.pendingCents,
            }))}
          />
        </CollapsibleCard>
      )}

      {!bookEmpty && (
      <CollapsibleCard
        id="home.recent"
        title="Últimos"
        actions={
          <div className="flex gap-3">
            <button type="button" className="text-sm text-duty" onClick={() => go({ name: 'movements', list: 'todos' })}>
              Ver todos
            </button>
            <button type="button" className="text-sm text-duty" onClick={() => go({ name: 'movements', list: 'gastos' })}>
              Ver gastos
            </button>
          </div>
        }
      >
        {recent.length === 0 ? (
          <p className="text-sm text-stone-500">Aún no hay historial.</p>
        ) : (
          <ul className="divide-y divide-stone-200/80">
            {recent.map((row) => {
              const splits = splitsByTx.get(row.id) ?? [];
              const draft = describeMovement(row, splits);
              const voided = row.status === 'VOID';
              return (
                <li key={row.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 py-2 text-left text-sm"
                    onClick={() => go({ name: 'move', id: row.id })}
                  >
                    <span>
                      <span className="font-medium">{dashboardMovementLabel(draft.type)}</span>
                      {voided && (
                        <span className="ml-2 rounded-full bg-stone-200 px-2 py-0.5 text-[0.65rem] uppercase tracking-wider text-stone-600">
                          Anulado
                        </span>
                      )}
                      <span className="block text-xs text-stone-500">{row.note || 'Sin nota'}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2 text-right">
                      <span>
                        <span className="block tabular-nums">{formatUsd(draft.amountCents)}</span>
                        <span className="text-xs tabular-nums text-stone-500">
                          {new Date(row.occurredAt).toLocaleDateString()}
                        </span>
                      </span>
                      <Pencil className="h-4 w-4 text-duty/70" strokeWidth={1.75} aria-hidden />
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </CollapsibleCard>
      )}
    </div>
  );
}
