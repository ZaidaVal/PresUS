import { formatUsd } from '../../domain';
import { useFinance } from '../../stores/financeStore';
import { DataCell, DataRow, DataTable, EditCell } from '../ui/DataTable';
import { BackLink } from '../ui/Icon';

export function AccountsScreen() {
  const { balances, go } = useFinance();
  return (
    <div className="space-y-3">
      <BackLink />
      {balances.length === 0 ? (
        <p className="card text-sm text-stone-600">Sin cuentas</p>
      ) : (
        <section className="card">
          <DataTable
            caption="Cuentas"
            columns={[
              { key: 'nombre', label: 'Nombre' },
              { key: 'tipo', label: 'Tipo' },
              { key: 'saldo', label: 'Saldo', numeric: true },
              { key: 'apartado', label: 'Apartado', numeric: true },
              { key: 'disp', label: 'Disponible', numeric: true },
              { key: 'acciones', label: '' },
            ]}
          >
            {balances.map((row) => {
              const isPublic = row.account.visibility === 'PUBLIC';
              return (
                <DataRow key={row.account.id} onOpen={() => go({ name: 'account', id: row.account.id })}>
                  <DataCell>
                    {row.account.name}
                    {row.account.isCardPaymentSource ? (
                      <span className="mt-0.5 block text-xs text-stone-500">Paga tarjeta</span>
                    ) : null}
                  </DataCell>
                  <DataCell nowrap>
                    Cuenta
                    {row.account.kind === 'CREDIT' ? ' · crédito' : ''}
                    {isPublic ? '' : ' · privada'}
                  </DataCell>
                  <DataCell numeric>{isPublic ? formatUsd(row.saldoCents) : '—'}</DataCell>
                  <DataCell numeric>{isPublic ? formatUsd(row.reservedCents) : '—'}</DataCell>
                  <DataCell numeric>{isPublic ? formatUsd(row.disponibleUiCents) : '—'}</DataCell>
                  <EditCell onEdit={() => go({ name: 'account-edit', id: row.account.id })} />
                </DataRow>
              );
            })}
          </DataTable>
        </section>
      )}
    </div>
  );
}
