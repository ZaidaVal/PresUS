import { formatUsd, isGoalFund, isSavingsFund, monthlyEquivalentCents } from '../../domain';
import { useFinance } from '../../stores/financeStore';
import { DataCell, DataRow, DataTable, EditCell } from '../ui/DataTable';
import { BackLink } from '../ui/Icon';
import { CollapsibleCard } from '../ui/CollapsibleCard';
import { SavingsProjectionPanel } from './SavingsProjectionPanel';

export function SavingsScreen() {
  const { funds, balances, budgetItems, go } = useFinance();
  const savingsFunds = funds.filter((row) => isSavingsFund(row.fund) && !isGoalFund(row.fund));
  const savingsItems = budgetItems.filter((item) => {
    if (item.category.trim().toLowerCase() === 'ahorro') return true;
    const cover = funds.find((row) => row.fund.id === item.coverFundId);
    return cover ? isSavingsFund(cover.fund) : false;
  });
  const totalReserved = savingsFunds.reduce((sum, row) => sum + row.reservedCents, 0);
  const plannedMonthly = savingsItems.reduce(
    (sum, item) => sum + monthlyEquivalentCents(item.frequency, item.amountCents, item.active),
    0,
  );

  return (
    <div className="space-y-5">
      <BackLink />

      <CollapsibleCard id="savings.hero" title="Ahorros apartados" surface="hero" defaultOpen summary={formatUsd(totalReserved)}>
        <p className="font-display text-5xl tabular-nums tracking-tight">{formatUsd(totalReserved)}</p>
        {plannedMonthly > 0 && (
          <p className="mt-3 text-xs text-cream/75">Aporte planeado {formatUsd(plannedMonthly)} / mes</p>
        )}
      </CollapsibleCard>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary px-4 py-2 text-sm"
          onClick={() => go({ name: 'fund-edit', segment: 'SAVINGS' })}
        >
          Nuevo segmento
        </button>
        <button
          type="button"
          className="rounded-full bg-stone-200 px-4 py-2 text-sm"
          onClick={() => go({ name: 'budget-edit' })}
        >
          Nuevo aporte planeado
        </button>
        <button
          type="button"
          className="rounded-full bg-stone-200 px-4 py-2 text-sm"
          onClick={() => go({ name: 'projects' })}
        >
          Proyectos
        </button>
      </div>

      <CollapsibleCard id="savings.segmentos" title="Segmentos" defaultOpen>
        {savingsFunds.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">Sin fondos de ahorros</p>
        ) : (
          <div className="mt-3">
            <DataTable
              caption="Segmentos de ahorro"
              columns={[
                { key: 'nombre', label: 'Nombre' },
                { key: 'tipo', label: 'Tipo' },
                { key: 'cuenta', label: 'Cuenta' },
                { key: 'apartado', label: 'Apartado', numeric: true },
                { key: 'meta', label: 'Meta', numeric: true },
                { key: 'acciones', label: '' },
              ]}
            >
              {savingsFunds.map((item) => {
                const accountName =
                  balances.find((row) => row.account.id === item.fund.accountId)?.account.name ?? '—';
                const target = item.fund.targetAmountCents;
                return (
                  <DataRow key={item.fund.id} onOpen={() => go({ name: 'account', id: item.fund.accountId })}>
                    <DataCell>
                      {item.fund.name}
                      {item.fund.purpose ? (
                        <span className="mt-0.5 block text-xs text-stone-500">{item.fund.purpose}</span>
                      ) : null}
                    </DataCell>
                    <DataCell nowrap>Fondo · ahorro</DataCell>
                    <DataCell>{accountName}</DataCell>
                    <DataCell numeric>{formatUsd(item.reservedCents)}</DataCell>
                    <DataCell numeric>{target != null ? formatUsd(target) : '—'}</DataCell>
                    <EditCell onEdit={() => go({ name: 'fund-edit', id: item.fund.id })} />
                  </DataRow>
                );
              })}
            </DataTable>
          </div>
        )}
      </CollapsibleCard>

      <CollapsibleCard id="savings.aportes" title="Aportes planeados">
        {savingsItems.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">Sin partidas de ahorro</p>
        ) : (
          <div className="mt-3">
            <DataTable
              caption="Aportes planeados"
              columns={[
                { key: 'nombre', label: 'Nombre' },
                { key: 'alcance', label: 'Alcance' },
                { key: 'fondo', label: 'Fondo' },
                { key: 'mes', label: '/ mes', numeric: true },
                { key: 'acciones', label: '' },
              ]}
            >
              {savingsItems.map((item) => {
                const cover = funds.find((row) => row.fund.id === item.coverFundId);
                return (
                  <DataRow key={item.id} onOpen={() => go({ name: 'budget-edit', id: item.id })}>
                    <DataCell>
                      {item.name}
                      {!item.active ? <span className="mt-0.5 block text-xs text-stone-500">Inactiva</span> : null}
                    </DataCell>
                    <DataCell nowrap>{item.budgetScope === 'HOME' ? 'Hogar' : item.budgetScope}</DataCell>
                    <DataCell>{cover?.fund.name ?? '—'}</DataCell>
                    <DataCell numeric>
                      {formatUsd(monthlyEquivalentCents(item.frequency, item.amountCents, item.active))}
                    </DataCell>
                    <EditCell onEdit={() => go({ name: 'budget-edit', id: item.id })} />
                  </DataRow>
                );
              })}
            </DataTable>
          </div>
        )}
      </CollapsibleCard>

      <SavingsProjectionPanel />
    </div>
  );
}
