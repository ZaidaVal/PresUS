import { useEffect, useState } from 'react';
import {
  PARTNER_IOU_GAP,
  PARTNER_IOU_META_KEY,
  centsToInput,
  formatUsd,
  parsePartnerIous,
  parseUsdToCents,
  partnerIouPendingTotal,
  partnerIousFromExcel,
  pendingIouCents,
  serializePartnerIous,
  type PartnerIouRow,
} from '../../domain';
import { PRESUS_NUEVO_A_DEBE_Z } from '../../import/presusNuevoSnapshot';
import { errorMessage } from '../../App';
import { useFinance } from '../../stores/financeStore';
import { DataCell, DataRow, DataTable } from '../ui/DataTable';
import { CollapsibleCard } from '../ui/CollapsibleCard';

export function PartnerIouPanel() {
  const { ledger } = useFinance();
  const fallback = partnerIousFromExcel(PRESUS_NUEVO_A_DEBE_Z);
  const [rows, setRows] = useState<PartnerIouRow[]>(fallback);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!ledger) return;
    void ledger.withTransaction(async (tx) => {
      setRows(parsePartnerIous(await tx.getMeta(PARTNER_IOU_META_KEY), fallback));
    });
  }, [ledger]);

  const persist = async (next: PartnerIouRow[]) => {
    if (!ledger) return;
    await ledger.withTransaction(async (tx) => {
      await tx.setMeta(PARTNER_IOU_META_KEY, serializePartnerIous(next));
    });
    setRows(next);
  };

  const patch = (id: string, field: 'name' | 'original' | 'paid', value: string) => {
    setMessage(null);
    const next = rows.map((row) => {
      if (row.id !== id) return row;
      if (field === 'name') return { ...row, name: value };
      try {
        const cents = parseUsdToCents(value || '0');
        return field === 'original' ? { ...row, originalCents: cents } : { ...row, paidCents: cents };
      } catch {
        return row;
      }
    });
    setRows(next);
  };

  return (
    <CollapsibleCard id="debts.iou" title="A debe a Z">
      <p className="text-xs text-stone-500">{PARTNER_IOU_GAP}</p>
      <DataTable
        caption="A debe a Z"
        columns={[
          { key: 'nombre', label: 'Ítem' },
          { key: 'orig', label: 'Original', numeric: true },
          { key: 'pago', label: 'Abonos', numeric: true },
          { key: 'pend', label: 'Pendiente', numeric: true },
        ]}
      >
        {rows.map((row) => (
          <DataRow key={row.id}>
            <DataCell>
              <input
                className="w-full bg-transparent"
                value={row.name}
                aria-label="Nombre"
                onChange={(event) => patch(row.id, 'name', event.target.value)}
                onBlur={() => void persist(rows).catch((err) => setMessage(errorMessage(err)))}
              />
            </DataCell>
            <DataCell numeric>
              <input
                className="w-full bg-transparent text-right"
                defaultValue={centsToInput(row.originalCents)}
                aria-label="Original"
                onBlur={(event) => {
                  patch(row.id, 'original', event.target.value);
                  const next = rows.map((item) =>
                    item.id === row.id
                      ? { ...item, originalCents: parseUsdToCents(event.target.value || '0') }
                      : item,
                  );
                  void persist(next).catch((err) => setMessage(errorMessage(err)));
                }}
              />
            </DataCell>
            <DataCell numeric>
              <input
                className="w-full bg-transparent text-right"
                defaultValue={centsToInput(row.paidCents)}
                aria-label="Abonos"
                onBlur={(event) => {
                  try {
                    const paidCents = parseUsdToCents(event.target.value || '0');
                    const next = rows.map((item) => (item.id === row.id ? { ...item, paidCents } : item));
                    void persist(next).catch((err) => setMessage(errorMessage(err)));
                  } catch (error) {
                    setMessage(errorMessage(error));
                  }
                }}
              />
            </DataCell>
            <DataCell numeric>{formatUsd(pendingIouCents(row))}</DataCell>
          </DataRow>
        ))}
      </DataTable>
      <p className="text-sm tabular-nums text-stone-600">Pendiente {formatUsd(partnerIouPendingTotal(rows))}</p>
      {message && <p className="text-sm text-red-800">{message}</p>}
    </CollapsibleCard>
  );
}
