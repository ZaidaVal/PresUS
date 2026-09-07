import { DomainError } from './ledger';
import { assertCents, type Cents } from './money';

export const PARTNER_IOU_META_KEY = 'partner_iou_a_to_z';
export const PARTNER_IOU_GAP =
  'Sin entidad PartnerDebt: el detalle no entra al disponible seguro ni se netea borrando filas.';

export type PartnerIouRow = {
  id: string;
  name: string;
  originalCents: Cents;
  paidCents: Cents;
  sharedTotalCents: Cents | null;
  cell: string;
};

export function pendingIouCents(row: Pick<PartnerIouRow, 'originalCents' | 'paidCents'>): Cents {
  assertCents(row.originalCents, 'original');
  assertCents(row.paidCents, 'abonos');
  if (row.paidCents > row.originalCents) {
    throw new DomainError('Los abonos no pueden superar el original');
  }
  return Math.max(0, row.originalCents - row.paidCents);
}

export function partnerIousFromExcel(
  rows: Array<{ cell: string; name: string; amountCents: number; sharedTotalCents: number | null }>,
): PartnerIouRow[] {
  return rows.map((row) => ({
    id: `iou-a-z-${row.cell.toLowerCase()}`,
    name: row.name,
    originalCents: row.amountCents,
    paidCents: 0,
    sharedTotalCents: row.sharedTotalCents,
    cell: row.cell,
  }));
}

export function partnerIouPendingTotal(rows: PartnerIouRow[]): Cents {
  return rows.reduce((sum, row) => sum + pendingIouCents(row), 0);
}

export function parsePartnerIous(
  raw: string | undefined | null,
  fallback: PartnerIouRow[] = [],
): PartnerIouRow[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return fallback;
    return parsed.map((row, index) => {
      if (!row || typeof row !== 'object') {
        throw new DomainError('Fila de préstamo A→Z inválida');
      }
      const rec = row as Partial<PartnerIouRow>;
      const originalCents = rec.originalCents;
      const paidCents = rec.paidCents ?? 0;
      if (typeof originalCents !== 'number' || !Number.isInteger(originalCents) || originalCents < 0) {
        throw new DomainError('Original A→Z debe ser centavos enteros');
      }
      if (typeof paidCents !== 'number' || !Number.isInteger(paidCents) || paidCents < 0) {
        throw new DomainError('Abonos A→Z deben ser centavos enteros');
      }
      return {
        id: typeof rec.id === 'string' && rec.id ? rec.id : `iou-a-z-${index}`,
        name: typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : `Ítem ${index + 1}`,
        originalCents,
        paidCents,
        sharedTotalCents:
          rec.sharedTotalCents == null || rec.sharedTotalCents === undefined
            ? null
            : Number.isInteger(rec.sharedTotalCents)
              ? rec.sharedTotalCents
              : null,
        cell: typeof rec.cell === 'string' ? rec.cell : '',
      };
    });
  } catch (error) {
    if (error instanceof DomainError) throw error;
    return fallback;
  }
}

export function serializePartnerIous(rows: PartnerIouRow[]): string {
  for (const row of rows) pendingIouCents(row);
  return JSON.stringify(rows);
}
