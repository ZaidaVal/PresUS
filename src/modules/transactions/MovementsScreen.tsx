import { useEffect, useMemo, useState } from 'react';
import {
  filterHistoryMovements,
  formatUsd,
  describeMovement,
  MOVEMENT_FILTER_TYPES,
  movementPlaceLabel,
  movementTypeLabel,
  utcMonthBoundsIso,
  utcYearMonthFromDate,
  type MovementFilter,
  type SpendLane,
  type UtcYearMonth,
} from '../../domain';
import { useFinance } from '../../stores/financeStore';
import { ChipBtn } from '../ui/Icon';
import { DataCell, DataRow, DataTable, EditCell } from '../ui/DataTable';

function monthInputValue(yearMonth: UtcYearMonth): string {
  return `${yearMonth.year}-${String(yearMonth.month + 1).padStart(2, '0')}`;
}

function parseMonthInput(value: string): UtcYearMonth | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  if (month < 0 || month > 11) return null;
  return { year, month };
}

function gastosFilter(yearMonth: UtcYearMonth, spendLane: SpendLane | ''): MovementFilter {
  return {
    type: 'GASTO',
    spendLane,
    ...utcMonthBoundsIso(yearMonth),
  };
}

export function MovementsScreen() {
  const { transactions, splitsByTx, cardCharges, budgetItems, funds, accounts, people, go, screen } =
    useFinance();
  const startAsTodos = screen.name === 'movements' && screen.list === 'todos';
  const [listMode, setListMode] = useState<'all' | 'gastos'>(startAsTodos ? 'all' : 'gastos');
  const [yearMonth, setYearMonth] = useState<UtcYearMonth>(() => utcYearMonthFromDate(new Date()));
  const [horizonOnly, setHorizonOnly] = useState(false);
  const [includeVoided, setIncludeVoided] = useState(false);
  const [filter, setFilter] = useState<MovementFilter>(() =>
    startAsTodos ? {} : gastosFilter(utcYearMonthFromDate(new Date()), 'CASA'),
  );

  useEffect(() => {
    if (screen.name !== 'movements') return;
    if (screen.list === 'todos') {
      setListMode('all');
      return;
    }
    setListMode('gastos');
    setFilter((current) => ({
      ...current,
      type: 'GASTO',
      spendLane: current.spendLane === 'GASTO_X' || current.spendLane === '' ? current.spendLane : 'CASA',
      ...(current.fromOccurredAt && current.toOccurredAt ? {} : utcMonthBoundsIso(yearMonth)),
    }));
  }, [screen, yearMonth]);

  const rows = useMemo(
    () =>
      filterHistoryMovements(transactions, splitsByTx, {
        cardCharges,
        budgetItems,
        accounts,
        filter: { ...filter, horizonOnly, includeVoided },
      }),
    [transactions, splitsByTx, cardCharges, budgetItems, accounts, filter, horizonOnly, includeVoided],
  );

  const setField = (patch: Partial<MovementFilter>) => setFilter((current) => ({ ...current, ...patch }));

  const showGastos = () => {
    setListMode('gastos');
    setFilter(gastosFilter(yearMonth, 'CASA'));
    go({ name: 'movements', list: 'gastos' });
  };

  const showAll = () => {
    setListMode('all');
    setFilter({});
    go({ name: 'movements', list: 'todos' });
  };

  const applyMonth = (next: UtcYearMonth) => {
    setYearMonth(next);
    setField(utcMonthBoundsIso(next));
  };

  return (
    <div className="space-y-4">
      <section className="hero">
        <p className="text-xs uppercase tracking-[0.28em] text-hope">Historial</p>
        <h2 className="mt-2 font-display text-4xl">{listMode === 'gastos' ? 'Gastos' : 'Movimientos'}</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <ChipBtn label="Gastos" title="Solo gastos (efectivo y cargos ONE)." active={listMode === 'gastos'} onClick={showGastos} />
          <ChipBtn label="Todos" title="Todo el libro: aportes, reservas, transferencias." active={listMode === 'all'} onClick={showAll} />
        </div>
      </section>

      <section className="card grid gap-3 sm:grid-cols-2">
        {listMode === 'gastos' ? (
          <>
            <label className="block text-sm">
              Mes
              <input
                type="month"
                className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
                value={monthInputValue(yearMonth)}
                onChange={(event) => {
                  const parsed = parseMonthInput(event.target.value);
                  if (parsed) applyMonth(parsed);
                }}
              />
            </label>
            <label className="block text-sm">
              Carril
              <select
                className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
                value={filter.spendLane ?? 'CASA'}
                onChange={(event) => setField({ spendLane: event.target.value as SpendLane | '' })}
              >
                <option value="CASA">Casa / Barras</option>
                <option value="GASTO_X">Gastos X</option>
                <option value="">Ambos (explícito)</option>
              </select>
            </label>
          </>
        ) : (
          <label className="block text-sm">
            Tipo
            <select
              className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
              value={filter.type ?? ''}
              onChange={(event) => setField({ type: event.target.value as MovementFilter['type'] })}
            >
              <option value="">Todos</option>
              {MOVEMENT_FILTER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {movementTypeLabel(type)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-sm">
          Cuenta
          <select
            className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
            value={filter.accountId ?? ''}
            onChange={(event) => setField({ accountId: event.target.value })}
          >
            <option value="">Todas</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Fondo
          <select
            className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
            value={filter.fundId ?? ''}
            onChange={(event) => setField({ fundId: event.target.value })}
          >
            <option value="">Todos</option>
            {funds.map((row) => (
              <option key={row.fund.id} value={row.fund.id}>
                {row.fund.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Partida
          <select
            className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
            value={filter.budgetItemId ?? ''}
            onChange={(event) => setField({ budgetItemId: event.target.value })}
          >
            <option value="">Todas</option>
            {budgetItems.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Persona
          <select
            className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
            value={filter.personId ?? ''}
            onChange={(event) => setField({ personId: event.target.value })}
          >
            <option value="">Todas</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
              </option>
            ))}
          </select>
        </label>
        {listMode === 'all' && (
          <>
            <label className="block text-sm">
              Desde
              <input
                type="date"
                className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
                value={filter.fromOccurredAt?.slice(0, 10) ?? ''}
                onChange={(event) =>
                  setField({ fromOccurredAt: event.target.value ? `${event.target.value}T00:00:00.000Z` : '' })
                }
              />
            </label>
            <label className="block text-sm">
              Hasta
              <input
                type="date"
                className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
                value={filter.toOccurredAt?.slice(0, 10) ?? ''}
                onChange={(event) =>
                  setField({ toOccurredAt: event.target.value ? `${event.target.value}T23:59:59.999Z` : '' })
                }
              />
            </label>
          </>
        )}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={horizonOnly} onChange={(event) => setHorizonOnly(event.target.checked)} />
          Solo 3 meses
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={includeVoided}
            onChange={(event) => setIncludeVoided(event.target.checked)}
          />
          Incluir anulados
        </label>
      </section>

      <section className="card">
        {rows.length === 0 ? (
          <p className="text-sm text-stone-500">
            {listMode === 'gastos' ? 'Sin gastos con esos filtros.' : 'Sin movimientos con esos filtros.'}
          </p>
        ) : (
          <DataTable
            caption={listMode === 'gastos' ? 'Gastos' : 'Movimientos'}
            columns={[
              { key: 'fecha', label: 'Fecha' },
              { key: 'tipo', label: 'Tipo' },
              { key: 'monto', label: 'Monto', numeric: true },
              { key: 'lugar', label: 'Cuentas / fondos' },
              { key: 'estado', label: 'Estado' },
              { key: 'acciones', label: '' },
            ]}
          >
            {rows.map((row) => {
              const splits = splitsByTx.get(row.id) ?? [];
              const draft = describeMovement(row, splits);
              const voided = row.status === 'VOID';
              const place = movementPlaceLabel(draft, {
                accountName: (id) => accounts.find((account) => account.id === id)?.name ?? '',
                fundName: (id) => funds.find((item) => item.fund.id === id)?.fund.name ?? '',
              });
              return (
                <DataRow key={row.id} onOpen={() => go({ name: 'move', id: row.id })}>
                  <DataCell nowrap>{new Date(row.occurredAt).toLocaleDateString()}</DataCell>
                  <DataCell>{movementTypeLabel(draft.type)}</DataCell>
                  <DataCell numeric>{formatUsd(draft.amountCents)}</DataCell>
                  <DataCell>{place}</DataCell>
                  <DataCell nowrap>{voided ? 'Anulado' : 'Vivo'}</DataCell>
                  <EditCell onEdit={voided ? undefined : () => go({ name: 'move', id: row.id, edit: true })} />
                </DataRow>
              );
            })}
          </DataTable>
        )}
      </section>
      <button type="button" onClick={() => go({ name: 'move', intent: listMode === 'gastos' ? 'GASTO' : undefined })} className="btn-primary w-full py-3">
        {listMode === 'gastos' ? 'Registrar gasto' : 'Registrar movimiento nuevo'}
      </button>
    </div>
  );
}
