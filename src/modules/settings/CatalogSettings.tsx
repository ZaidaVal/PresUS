import { useEffect, useState, type FormEvent } from 'react';
import { formatUsd, savePersonName, type AccountKind } from '../../domain';
import { errorMessage } from '../../App';
import { useFinance } from '../../stores/financeStore';
import { DataCell, DataRow, DataTable, EditCell } from '../ui/DataTable';

const KIND_LABEL: Record<string, string> = {
  MORTGAGE: 'Hipoteca',
  PERSONAL: 'Personal',
  VEHICLE: 'Vehículo',
  OTHER: 'Otra',
};

export function CatalogSettings() {
  const { people, accounts, funds, cards, budgetItems, debts, go } = useFinance();
  const sorted = people.slice().sort((left, right) => left.code.localeCompare(right.code));

  return (
    <div className="space-y-6">
      <section className="card space-y-3">
        <h2 className="text-sm uppercase tracking-[0.2em] text-stone-500">Personas</h2>
        <DataTable
          caption="Personas"
          columns={[
            { key: 'nombre', label: 'Nombre' },
            { key: 'rol', label: 'Código' },
            { key: 'acciones', label: '' },
          ]}
        >
          {sorted.map((person) => (
            <PersonRow key={person.id} id={person.id} code={person.code} displayName={person.displayName} />
          ))}
        </DataTable>
      </section>

      <section className="card space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-sm uppercase tracking-[0.2em] text-stone-500">Cuentas</h2>
          <button type="button" className="text-sm text-duty" onClick={() => go({ name: 'account-edit' })}>
            Nueva
          </button>
        </div>
        <button type="button" className="text-sm text-duty" onClick={() => go({ name: 'accounts' })}>
          Ver saldos
        </button>
        {accounts.length === 0 ? (
          <p className="text-sm text-stone-500">Sin cuentas</p>
        ) : (
          <DataTable
            caption="Cuentas"
            columns={[
              { key: 'nombre', label: 'Nombre' },
              { key: 'tipo', label: 'Tipo' },
              { key: 'rol', label: 'Rol' },
              { key: 'acciones', label: '' },
            ]}
          >
            {accounts.map((account) => (
              <DataRow key={account.id} onOpen={() => go({ name: 'account', id: account.id })}>
                <DataCell>{account.name}</DataCell>
                <DataCell nowrap>Cuenta</DataCell>
                <DataCell>
                  {kindLabel(account.kind)}
                  {account.visibility === 'PRIVATE' ? ' · privada' : ''}
                  {account.isCardPaymentSource ? ' · paga tarjeta' : ''}
                </DataCell>
                <EditCell onEdit={() => go({ name: 'account-edit', id: account.id })} />
              </DataRow>
            ))}
          </DataTable>
        )}
      </section>

      <section className="card space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm uppercase tracking-[0.2em] text-stone-500">Fondos</h2>
          <div className="flex flex-wrap gap-3">
          <button type="button" className="text-sm text-duty" title="Tabla editable de todos los fondos" onClick={() => go({ name: 'funds' })}>
            Editar tabla
          </button>
          <button type="button" className="text-sm text-duty" title="Alta de un fondo" onClick={() => go({ name: 'fund-edit' })}>
            Nuevo
          </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="text-sm text-duty" onClick={() => go({ name: 'funds' })}>
            Ver fondos
          </button>
          <button type="button" className="text-sm text-duty" onClick={() => go({ name: 'savings' })}>
            Ver ahorros
          </button>
          <button type="button" className="text-sm text-duty" onClick={() => go({ name: 'projects' })}>
            Ver proyectos
          </button>
          <button
            type="button"
            className="text-sm text-duty"
            title="Alta de un proyecto o sueño en Ahorros"
            onClick={() => go({ name: 'fund-edit', segment: 'SAVINGS', goalKind: 'PROYECTO' })}
          >
            Nuevo proyecto
          </button>
        </div>
        {funds.length === 0 ? (
          <p className="text-sm text-stone-500">Sin fondos</p>
        ) : (
          <DataTable
            caption="Fondos"
            columns={[
              { key: 'nombre', label: 'Nombre' },
              { key: 'tipo', label: 'Tipo' },
              { key: 'cuenta', label: 'Cuenta' },
              { key: 'monto', label: 'Apartado', numeric: true },
              { key: 'acciones', label: '' },
            ]}
          >
            {funds.map((item) => (
              <DataRow key={item.fund.id} onOpen={() => go({ name: 'account', id: item.fund.accountId })}>
                <DataCell>{item.fund.name}</DataCell>
                <DataCell nowrap>{item.fund.segment === 'SAVINGS' ? 'Fondo · ahorro' : 'Fondo'}</DataCell>
                <DataCell>{accounts.find((account) => account.id === item.fund.accountId)?.name ?? '—'}</DataCell>
                <DataCell numeric>{formatUsd(item.reservedCents)}</DataCell>
                <EditCell onEdit={() => go({ name: 'funds' })} />
              </DataRow>
            ))}
          </DataTable>
        )}
      </section>

      <section className="card space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-sm uppercase tracking-[0.2em] text-stone-500">Tarjetas</h2>
          <button type="button" className="text-sm text-duty" onClick={() => go({ name: 'card-edit' })}>
            Nueva
          </button>
        </div>
        {cards.length === 0 ? (
          <p className="text-sm text-stone-500">Sin tarjetas</p>
        ) : (
          <DataTable
            caption="Tarjetas"
            columns={[
              { key: 'nombre', label: 'Nombre' },
              { key: 'tipo', label: 'Tipo' },
              { key: 'paga', label: 'Paga desde' },
              { key: 'monto', label: 'Saldo', numeric: true },
              { key: 'acciones', label: '' },
            ]}
          >
            {cards.map((item) => (
              <DataRow
                key={item.card.id}
                onOpen={() => go({ name: 'account', id: item.card.paymentAccountId, focus: 'cuadre' })}
              >
                <DataCell>{item.card.name}</DataCell>
                <DataCell nowrap>Tarjeta</DataCell>
                <DataCell>
                  {accounts.find((account) => account.id === item.card.paymentAccountId)?.name ?? '—'}
                  {item.card.coverFundId
                    ? ` · cubre ${funds.find((row) => row.fund.id === item.card.coverFundId)?.fund.name ?? ''}`
                    : ''}
                </DataCell>
                <DataCell numeric>{formatUsd(item.saldoCents)}</DataCell>
                <EditCell onEdit={() => go({ name: 'card-edit', id: item.card.id })} />
              </DataRow>
            ))}
          </DataTable>
        )}
      </section>

      <section className="card space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-sm uppercase tracking-[0.2em] text-stone-500">Presupuesto</h2>
          <button type="button" className="text-sm text-duty" onClick={() => go({ name: 'budget-edit' })}>
            Nueva
          </button>
        </div>
        <button type="button" className="text-sm text-duty" onClick={() => go({ name: 'budgets' })}>
          Ver partidas
        </button>
        {budgetItems.length === 0 ? (
          <p className="text-sm text-stone-500">Sin partidas</p>
        ) : (
          <DataTable
            caption="Partidas de presupuesto"
            columns={[
              { key: 'nombre', label: 'Nombre' },
              { key: 'tipo', label: 'Alcance' },
              { key: 'z', label: 'Z', numeric: true },
              { key: 'a', label: 'A', numeric: true },
              { key: 'estado', label: 'Estado' },
              { key: 'acciones', label: '' },
            ]}
          >
            {budgetItems.map((item) => (
              <DataRow key={item.id} onOpen={() => go({ name: 'budget-edit', id: item.id })}>
                <DataCell>{item.name}</DataCell>
                <DataCell nowrap>{item.budgetScope === 'HOME' ? 'Hogar' : item.budgetScope}</DataCell>
                <DataCell numeric>{formatUsd(item.zShareCents)}</DataCell>
                <DataCell numeric>{formatUsd(item.aShareCents)}</DataCell>
                <DataCell nowrap>{item.active ? 'Activa' : 'Inactiva'}</DataCell>
                <EditCell onEdit={() => go({ name: 'budget-edit', id: item.id })} />
              </DataRow>
            ))}
          </DataTable>
        )}
      </section>

      <section className="card space-y-3">
        <div className="flex items-end justify-between gap-3">
          <h2 className="text-sm uppercase tracking-[0.2em] text-stone-500">Deudas / hipoteca</h2>
          <button type="button" className="text-sm text-duty" onClick={() => go({ name: 'debt-edit' })}>
            Nueva
          </button>
        </div>
        <button type="button" className="text-sm text-duty" onClick={() => go({ name: 'debts' })}>
          Ver préstamos
        </button>
        <button type="button" className="text-sm text-duty" onClick={() => go({ name: 'debt-plan' })}>
          Plan amortización
        </button>
        {debts.length === 0 ? (
          <p className="text-sm text-stone-500">Sin deudas</p>
        ) : (
          <DataTable
            caption="Deudas"
            columns={[
              { key: 'nombre', label: 'Nombre' },
              { key: 'tipo', label: 'Tipo' },
              { key: 'estado', label: 'Estado' },
              { key: 'acciones', label: '' },
            ]}
          >
            {debts.map((debt) => (
              <DataRow key={debt.id} onOpen={() => go({ name: 'debt-edit', id: debt.id })}>
                <DataCell>{debt.name}</DataCell>
                <DataCell nowrap>{KIND_LABEL[debt.kind] ?? debt.kind}</DataCell>
                <DataCell nowrap>{debt.active ? 'Activa' : 'Inactiva'}</DataCell>
                <EditCell onEdit={() => go({ name: 'debt-edit', id: debt.id })} />
              </DataRow>
            ))}
          </DataTable>
        )}
      </section>
    </div>
  );
}

function PersonRow({ id, code, displayName }: { id: string; code: string; displayName: string }) {
  const { ledger, refresh } = useFinance();
  const [name, setName] = useState(displayName);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setName(displayName);
  }, [displayName]);

  const onSave = async (event: FormEvent) => {
    event.preventDefault();
    if (!ledger) return;
    setMessage(null);
    try {
      await ledger.withTransaction((tx) => savePersonName(tx, id, name));
      await refresh();
      setEditing(false);
      setMessage('Guardado');
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  if (editing) {
    return (
      <tr>
        <td colSpan={3} className="py-2">
          <form onSubmit={onSave} className="flex flex-wrap items-end gap-2">
            <label className="min-w-[12rem] flex-1 text-sm">
              {code}
              <input
                className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </label>
            <button type="submit" className="btn-primary px-4 py-2 text-sm">
              Guardar
            </button>
            <button type="button" className="rounded-full bg-stone-200 px-4 py-2 text-sm" onClick={() => setEditing(false)}>
              Cancelar
            </button>
            {message && <p className="w-full text-xs text-stone-500">{message}</p>}
          </form>
        </td>
      </tr>
    );
  }

  return (
    <DataRow onOpen={() => setEditing(true)}>
      <DataCell>
        {displayName}
        {message ? <span className="mt-0.5 block text-xs text-stone-500">{message}</span> : null}
      </DataCell>
      <DataCell nowrap>{code}</DataCell>
      <EditCell onEdit={() => setEditing(true)} />
    </DataRow>
  );
}

function kindLabel(kind: AccountKind) {
  if (kind === 'CASH') return 'Efectivo';
  if (kind === 'FUND_HOLDER') return 'Tenedora de fondos';
  if (kind === 'CREDIT') return 'Crédito';
  return 'Banco';
}
