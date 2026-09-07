import { useEffect, useMemo, useState } from 'react';
import { Landmark, Save } from 'lucide-react';
import {
  centsToInput,
  formatUsd,
  fundDueAnchorLabel,
  isSavingsFund,
  parseUsdToCents,
  saveFunds,
  type FundDueAnchor,
  type FundSegment,
} from '../../domain';
import { errorMessage } from '../../App';
import { useFinance } from '../../stores/financeStore';
import { ActionBtn, BackLink } from '../ui/Icon';
import { DataCell, DataRow, DataTable } from '../ui/DataTable';

type FundDraft = {
  id: string;
  name: string;
  purpose: string;
  accountId: string;
  segment: FundSegment;
  target: string;
  priority: string;
  dueAnchor: FundDueAnchor | '';
};

function draftsFromStore(
  funds: ReturnType<typeof useFinance.getState>['funds'],
): FundDraft[] {
  return funds.map((item) => ({
    id: item.fund.id,
    name: item.fund.name,
    purpose: item.fund.purpose,
    accountId: item.fund.accountId,
    segment: item.fund.segment,
    target: item.fund.targetAmountCents != null ? centsToInput(item.fund.targetAmountCents) : '',
    priority: item.fund.priority != null ? String(item.fund.priority) : '',
    dueAnchor: item.fund.dueAnchor ?? '',
  }));
}

export function FundsScreen() {
  const { ledger, refresh, funds, accounts, go } = useFinance();
  const [drafts, setDrafts] = useState<FundDraft[]>(() => draftsFromStore(funds));
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDrafts(draftsFromStore(funds));
  }, [funds]);

  const publicAccounts = useMemo(
    () => accounts.filter((account) => account.visibility === 'PUBLIC'),
    [accounts],
  );
  const showMeta = useMemo(
    () => drafts.some((row) => isSavingsFund({ segment: row.segment })),
    [drafts],
  );

  const patch = (id: string, next: Partial<FundDraft>) => {
    setDrafts((current) => current.map((row) => (row.id === id ? { ...row, ...next } : row)));
  };

  const onSave = async () => {
    if (!ledger) return;
    setBusy(true);
    setMessage(null);
    try {
      await ledger.withTransaction(async (tx) => {
        await saveFunds(
          tx,
          drafts.map((row) => {
            const savings = row.segment === 'SAVINGS';
            let targetAmountCents: number | null = null;
            if (savings && row.target.trim()) targetAmountCents = parseUsdToCents(row.target);
            let priority: number | null = null;
            if (row.priority.trim()) {
              const parsed = Number(row.priority);
              if (!Number.isInteger(parsed)) throw new Error('La prioridad del fondo debe ser un entero');
              priority = parsed;
            }
            return {
              id: row.id,
              accountId: row.accountId,
              name: row.name,
              purpose: row.purpose,
              targetAmountCents,
              priority,
              segment: row.segment,
              dueAnchor: row.dueAnchor === '' ? null : row.dueAnchor,
            };
          }),
        );
      });
      await refresh();
      setMessage('Fondos guardados');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <BackLink />
      <div className="flex flex-wrap gap-2">
        <ActionBtn
          icon={Landmark}
          label="Ingreso / vaciar"
          title="Recargar lo presupuestado o vaciar fondos. No es un gasto."
          onClick={() => go({ name: 'move', intent: 'FONDOS' })}
        />
        <ActionBtn
          icon={Save}
          label="Guardar"
          title="Guarda todos los fondos de la tabla."
          disabled={busy || drafts.length === 0}
          onClick={() => void onSave()}
        />
        <button
          type="button"
          className="rounded-full bg-stone-200 px-4 py-2 text-sm"
          title="Alta de un fondo nuevo"
          onClick={() => go({ name: 'fund-edit' })}
        >
          Nuevo
        </button>
      </div>
      {message && <p className="text-sm text-stone-600">{message}</p>}
      {drafts.length === 0 ? (
        <p className="card text-sm text-stone-500">Sin fondos</p>
      ) : (
        <section className="card">
          <DataTable
            caption="Fondos"
            columns={[
              { key: 'nombre', label: 'Nombre' },
              { key: 'cuenta', label: 'Cuenta' },
              { key: 'tipo', label: 'Tipo' },
              { key: 'pago', label: 'Fecha de pago' },
              { key: 'apartado', label: 'Apartado', numeric: true },
              ...(showMeta ? [{ key: 'meta', label: 'Meta' }] : []),
              { key: 'prio', label: 'Prio.' },
            ]}
          >
            {drafts.map((row) => {
              const reserved = funds.find((item) => item.fund.id === row.id)?.reservedCents ?? 0;
              const savings = isSavingsFund({ segment: row.segment });
              return (
                <DataRow key={row.id}>
                  <DataCell>
                    <input
                      className="w-full min-w-[8rem] rounded-xl bg-stone-100 px-2 py-1"
                      value={row.name}
                      title="Nombre del fondo"
                      onChange={(event) => patch(row.id, { name: event.target.value })}
                    />
                    <input
                      className="mt-1 w-full rounded-xl bg-stone-100 px-2 py-1 text-xs"
                      value={row.purpose}
                      title="Propósito"
                      placeholder="Propósito"
                      onChange={(event) => patch(row.id, { purpose: event.target.value })}
                    />
                  </DataCell>
                  <DataCell>
                    <select
                      className="w-full min-w-[7rem] rounded-xl bg-stone-100 px-2 py-1"
                      value={row.accountId}
                      title="Cuenta donde vive el fondo. No es el fondo."
                      onChange={(event) => patch(row.id, { accountId: event.target.value })}
                    >
                      {publicAccounts
                        .filter((account) => account.id === row.accountId || account.visibility === 'PUBLIC')
                        .map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.name}
                          </option>
                        ))}
                    </select>
                  </DataCell>
                  <DataCell nowrap>
                    <select
                      className="rounded-xl bg-stone-100 px-2 py-1"
                      value={row.segment}
                      title={savings ? 'Fondo de ahorro' : 'Fondo operativo'}
                      onChange={(event) => patch(row.id, { segment: event.target.value as FundSegment })}
                    >
                      <option value="OPERATING">Operativo</option>
                      <option value="SAVINGS">Ahorro</option>
                    </select>
                  </DataCell>
                  <DataCell>
                    <select
                      className="min-w-[8rem] rounded-xl bg-stone-100 px-2 py-1"
                      value={row.dueAnchor}
                      title="Día destinado a pagarse: 1, 14 o fin de mes."
                      onChange={(event) =>
                        patch(row.id, { dueAnchor: event.target.value as FundDueAnchor | '' })
                      }
                    >
                      <option value="">{fundDueAnchorLabel(null)}</option>
                      <option value="MONTH_START">{fundDueAnchorLabel('MONTH_START')}</option>
                      <option value="MONTH_MID">{fundDueAnchorLabel('MONTH_MID')}</option>
                      <option value="MONTH_END">{fundDueAnchorLabel('MONTH_END')}</option>
                    </select>
                  </DataCell>
                  <DataCell numeric>{formatUsd(reserved)}</DataCell>
                  {showMeta ? (
                    <DataCell>
                      {savings ? (
                        <input
                          className="w-20 rounded-xl bg-stone-100 px-2 py-1 text-right"
                          value={row.target}
                          title="Meta opcional"
                          placeholder="—"
                          onChange={(event) => patch(row.id, { target: event.target.value })}
                        />
                      ) : (
                        '—'
                      )}
                    </DataCell>
                  ) : null}
                  <DataCell>
                    <input
                      className="w-14 rounded-xl bg-stone-100 px-2 py-1 text-right"
                      value={row.priority}
                      title="Prioridad opcional"
                      placeholder="—"
                      onChange={(event) => patch(row.id, { priority: event.target.value })}
                    />
                  </DataCell>
                </DataRow>
              );
            })}
          </DataTable>
          <p className="mt-2 text-xs text-stone-400">Guardar aplica todos los cambios de la tabla.</p>
        </section>
      )}
    </div>
  );
}
