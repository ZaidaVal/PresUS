import { IDS } from '../database/seed';
import type { LedgerTx } from '../domain/ledger';
import { postCardCharge, voidTransaction } from '../domain/posting';
import type { CardChargeClass } from '../domain/types';
import {
  PRESUS_NUEVO_ONE_CHARGES,
  PRESUS_NUEVO_OPENED_AT,
  PRESUS_NUEVO_SOURCE,
  type SnapshotOneCharge,
} from './presusNuevoSnapshot';

export function mapOneChargeCover(row: SnapshotOneCharge): {
  chargeClass: CardChargeClass;
  coverFundId: string | null;
  barrasLeftover: boolean;
} {
  const note = row.note.trim().toLowerCase();
  const comment = (row.comment ?? '').trim().toLowerCase();

  if (row.source === 'A') {
    return { chargeClass: 'PERSONAL_A', coverFundId: null, barrasLeftover: false };
  }
  if (comment === 'z') {
    return { chargeClass: 'PERSONAL_Z', coverFundId: null, barrasLeftover: false };
  }
  if (/compra x/.test(note)) {
    return { chargeClass: 'SHARED_UNBUDGETED', coverFundId: null, barrasLeftover: false };
  }

  const coverFundId = matchCoverFundId(note, comment);
  if (coverFundId) {
    return { chargeClass: 'SHARED_BUDGETED', coverFundId, barrasLeftover: false };
  }
  return { chargeClass: 'SHARED_BUDGETED', coverFundId: null, barrasLeftover: true };
}

function matchCoverFundId(note: string, comment: string): string | null {
  if (comment === 'salidas' || note.includes('salidas')) return IDS.funds.salidas;
  if (note.includes('despensa')) return IDS.funds.super;
  if (note.includes('spoty') || note.includes('spotify')) return IDS.funds.spotify;
  if (note.includes('cursor')) return IDS.funds.cursor;
  if (note.includes('gasolina')) return IDS.funds.gasolina;
  if (note.includes('youtube')) return IDS.funds.youtube;
  if (note.includes('chatgpt') || note.includes('chat gpt')) return IDS.funds.chatgpt;
  if (note.includes('master') || note.includes('maestr')) return IDS.funds.maestria;
  if (note.includes('claro z') || note.includes('internet celular')) return IDS.funds.internetCel;
  if (note.includes('claro ma') || note.includes('móvil') || note.includes('movil')) return IDS.funds.movil;
  if (note.includes('omnisport')) return IDS.funds.pagoOne;
  if (
    note.includes('casa') ||
    comment.includes('casa') ||
    note.includes('freund') ||
    note.includes('intereses')
  ) {
    return IDS.funds.casa;
  }
  return null;
}

export async function postPresusNuevoOneCharges(tx: LedgerTx, cardId: string) {
  for (const row of PRESUS_NUEVO_ONE_CHARGES) {
    const cover = mapOneChargeCover(row);
    const fromA = row.source === 'A' ? ' · One A' : '';
    await postCardCharge(tx, {
      cardId,
      amountCents: row.amountCents,
      chargeClass: cover.chargeClass,
      coverFundId: cover.coverFundId,
      barrasLeftover: cover.barrasLeftover,
      gastoX: cover.chargeClass === 'SHARED_UNBUDGETED',
      note: `${row.note}${fromA} (${PRESUS_NUEVO_SOURCE})`,
      occurredAt: PRESUS_NUEVO_OPENED_AT,
    });
  }
}

export async function replaceOpeningOneAjusteWithCharges(tx: LedgerTx, cardId: string) {
  const txs = await tx.listTransactions();
  const opening = txs.find(
    (row) =>
      row.status === 'POSTED' &&
      row.type === 'AJUSTE' &&
      /apertura debe ONE/i.test(row.note),
  );
  if (opening) {
    await voidTransaction(tx, opening.id);
  }
  await postPresusNuevoOneCharges(tx, cardId);
}
