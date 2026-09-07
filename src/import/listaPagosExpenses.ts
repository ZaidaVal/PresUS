import { IDS } from '../database/seed';
import type { LedgerTx } from '../domain/ledger';
import { postAjuste, postGasto } from '../domain/posting';
import {
  PRESUS_NUEVO_LISTA_PAGOS_GASTOS,
  PRESUS_NUEVO_LISTA_PAGOS_GASTOS_CENTS,
  PRESUS_NUEVO_LISTA_PAGOS_NOTE,
  PRESUS_NUEVO_LISTA_PAGOS_REBUILD_AT,
  PRESUS_NUEVO_SOURCE,
} from './presusNuevoSnapshot';

function mediumLabel(medium: 'TRANSFER' | 'CARD' | 'CASH'): string {
  if (medium === 'TRANSFER') return 'transferencia';
  if (medium === 'CARD') return 'tarjeta (ciclo cerrado, no cargo ONE vigente)';
  return 'físico';
}

export function listaPagosGastoNote(name: string, medium: 'TRANSFER' | 'CARD' | 'CASH'): string {
  return `${name} · ${mediumLabel(medium)} · ${PRESUS_NUEVO_LISTA_PAGOS_NOTE} (${PRESUS_NUEVO_SOURCE})`;
}

export const LISTA_PAGOS_REBUILD_NOTE = `AJUSTE reconstrucción ${PRESUS_NUEVO_LISTA_PAGOS_NOTE} para no descuadrar Barras (${PRESUS_NUEVO_SOURCE})`;

export async function countPostedListaPagosGastos(tx: LedgerTx): Promise<number> {
  const txs = await tx.listTransactions();
  return txs.filter(
    (row) =>
      row.status === 'POSTED' &&
      row.type === 'GASTO' &&
      row.note.includes(PRESUS_NUEVO_LISTA_PAGOS_NOTE),
  ).length;
}

export async function ledgerHasListaPagosGastos(tx: LedgerTx): Promise<boolean> {
  return (await countPostedListaPagosGastos(tx)) > 0;
}

/**
 * Única escritura de las 21 líneas. Si el libro ya tiene alguna (o las 21), no asienta otra tanda.
 * Sin fundId: no consume el apartado vigente. AJUSTE explícito para no descuadrar Barras.
 * No crea cargos ONE.
 */
export async function postPresusNuevoListaPagosExpenses(tx: LedgerTx): Promise<boolean> {
  if ((await countPostedListaPagosGastos(tx)) > 0) return false;
  await postAjuste(tx, {
    accountId: IDS.accounts.barras,
    amountCents: PRESUS_NUEVO_LISTA_PAGOS_GASTOS_CENTS,
    note: LISTA_PAGOS_REBUILD_NOTE,
    occurredAt: PRESUS_NUEVO_LISTA_PAGOS_REBUILD_AT,
  });
  for (const row of PRESUS_NUEVO_LISTA_PAGOS_GASTOS) {
    await postGasto(tx, {
      accountId: IDS.accounts.barras,
      amountCents: row.amountCents,
      note: listaPagosGastoNote(row.name, row.medium),
      occurredAt: row.occurredAt,
    });
  }
  return true;
}
