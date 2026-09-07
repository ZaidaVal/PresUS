import { Scissors } from 'lucide-react';
import {
  areaOverrunRows,
  formatUsd,
  type BudgetCutoffRecord,
  type BudgetOverrunReport,
} from '../../domain';
import { ActionBtn } from '../ui/Icon';
import { CollapsibleCard } from '../ui/CollapsibleCard';

export function OverrunPanel({
  report,
  lastCutoff,
}: {
  report: BudgetOverrunReport;
  lastCutoff: BudgetCutoffRecord | null;
}) {
  const areas = areaOverrunRows(report.rows).filter((row) => row.overrunCents > 0);
  const title = report.closed ? report.label : 'Me pasé';
  return (
    <CollapsibleCard id="budget.overrun" title={title} surface="tile" defaultOpen={areas.length > 0}>
      {areas.length === 0 ? (
        <p className="text-sm text-stone-500">
          {report.closed ? 'Este corte no tenía sobrecostos.' : 'Ningún área se pasó de lo presupuestado.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {areas.map((row) => (
            <li key={row.area} className="flex items-baseline justify-between gap-3 border-t border-stone-200/80 pt-3 first:border-t-0 first:pt-0">
              <span>
                <span className="text-ink">{row.area}</span>
                <span className="mt-0.5 block text-xs text-stone-500">
                  Presupuestado {formatUsd(row.budgetedCents)} · gastado {formatUsd(row.spentCents)}
                </span>
              </span>
              <span className="tabular-nums text-spend">{formatUsd(row.overrunCents)}</span>
            </li>
          ))}
        </ul>
      )}
      {lastCutoff && lastCutoff.key !== report.key && (
        <p className="mt-3 text-xs text-stone-500">
          Último {lastCutoff.label}: sobrecosto {formatUsd(lastCutoff.totalOverrunCents)}.
        </p>
      )}
    </CollapsibleCard>
  );
}

export function CutoffBar({
  report,
  busy,
  onCutoff,
}: {
  report: BudgetOverrunReport;
  busy: boolean;
  onCutoff: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-emerald-950/5 px-4 py-3">
      <p className="text-sm text-stone-600">
        {report.closed
          ? `${report.label} ya está hecho`
          : `Quincena ${report.period.period === 'Q1' ? '1 ≈ día 14' : '2 ≈ día 29'}. Si hay excedente, elige a qué cuenta de ahorro va.`}
      </p>
      <ActionBtn
        icon={Scissors}
        label="Realizar corte"
        title="Cierra la quincena. Tienes que elegir a qué cuenta va el excedente; no hay destino por defecto."
        disabled={busy || report.closed}
        onClick={onCutoff}
      />
    </div>
  );
}
