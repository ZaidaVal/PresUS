import { useMemo } from 'react';
import { Plus, Sparkles } from 'lucide-react';
import {
  formatUsd,
  goalKindLabel,
  goalKindOf,
  goalMissingCents,
  splitGoalFunds,
  type GoalKind,
} from '../../domain';
import { useFinance } from '../../stores/financeStore';
import { ActionBtn, BackLink } from '../ui/Icon';
import { CollapsibleCard } from '../ui/CollapsibleCard';
import { DataCell, DataRow, DataTable, EditCell } from '../ui/DataTable';

export function ProjectsScreen() {
  const { funds, go } = useFinance();
  const { proyectos, suenos } = useMemo(
    () => splitGoalFunds(funds.map((row) => row.fund)),
    [funds],
  );
  const reserved = (id: string) => funds.find((row) => row.fund.id === id)?.reservedCents ?? 0;

  return (
    <div className="space-y-5">
      <BackLink />

      <section className="overflow-hidden rounded-[2rem] bg-emerald-950 p-6 text-amber-50 shadow-lg shadow-emerald-950/20">
        <p className="text-xs uppercase tracking-[0.28em] text-amber-200/80">Ahorros · metas</p>
        <h2 className="mt-2 font-display text-4xl">Proyectos</h2>
      </section>

      <GoalTable
        caption="Proyectos"
        title="Proyectos"
        kind="PROYECTO"
        rows={proyectos}
        reserved={reserved}
        onOpen={(_id, accountId) => go({ name: 'account', id: accountId })}
        onEdit={(id) => go({ name: 'fund-edit', id })}
        onCreate={() => go({ name: 'fund-edit', segment: 'SAVINGS', goalKind: 'PROYECTO' })}
      />
      <GoalTable
        caption="Sueños"
        title="Sueños"
        kind="SUEÑO"
        rows={suenos}
        reserved={reserved}
        onOpen={(_id, accountId) => go({ name: 'account', id: accountId })}
        onEdit={(id) => go({ name: 'fund-edit', id })}
        onCreate={() => go({ name: 'fund-edit', segment: 'SAVINGS', goalKind: 'SUEÑO' })}
      />

      <ActionBtn icon={Sparkles} label="Ahorros" variant="secondary" onClick={() => go({ name: 'savings' })} />
    </div>
  );
}

function GoalTable({
  caption,
  title,
  kind,
  rows,
  reserved,
  onOpen,
  onEdit,
  onCreate,
}: {
  caption: string;
  title: string;
  kind: GoalKind;
  rows: Array<{ id: string; name: string; purpose: string; accountId: string; targetAmountCents: number | null; priority: number | null }>;
  reserved: (id: string) => number;
  onOpen: (id: string, accountId: string) => void;
  onEdit: (id: string) => void;
  onCreate: () => void;
}) {
  const hint = kind === 'SUEÑO' ? 'Alta de un sueño en Ahorros' : 'Alta de un proyecto en Ahorros';
  return (
    <CollapsibleCard
      id={`projects.${kind}`}
      title={title}
      defaultOpen
      actions={<ActionBtn icon={Plus} label="Nuevo" variant="ghost" title={hint} onClick={onCreate} />}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-stone-500">Sin {title.toLowerCase()}</p>
      ) : (
        <DataTable
          caption={caption}
          columns={[
            { key: 'nombre', label: 'Nombre' },
            { key: 'prio', label: '#' },
            { key: 'meta', label: 'Meta', numeric: true },
            { key: 'hay', label: 'Apartado', numeric: true },
            { key: 'falta', label: 'Falta', numeric: true },
            { key: 'acciones', label: '' },
          ]}
        >
          {rows.map((fund) => {
            const have = reserved(fund.id);
            const target = fund.targetAmountCents ?? 0;
            return (
              <DataRow key={fund.id} onOpen={() => onOpen(fund.id, fund.accountId)}>
                <DataCell>
                  {fund.name}
                  <span className="mt-0.5 block text-xs text-stone-500">
                    {goalKindLabel(goalKindOf(fund) ?? kind)}
                  </span>
                </DataCell>
                <DataCell nowrap>{fund.priority ?? '—'}</DataCell>
                <DataCell numeric>{target > 0 ? formatUsd(target) : '—'}</DataCell>
                <DataCell numeric>{formatUsd(have)}</DataCell>
                <DataCell numeric>{formatUsd(goalMissingCents(fund, have))}</DataCell>
                <EditCell onEdit={() => onEdit(fund.id)} />
              </DataRow>
            );
          })}
        </DataTable>
      )}
    </CollapsibleCard>
  );
}
