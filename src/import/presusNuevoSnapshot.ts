import type { Frequency } from '../domain/types';

export const PRESUS_NUEVO_SOURCE = 'PresUSNuevo.xlsx';
export const PRESUS_NUEVO_OPENED_AT = '2026-08-24T00:00:00.000Z';

export const PRESUS_NUEVO_GAPS = [] as const;

export const PRESUS_NUEVO_BALANCES = {
  barrasCents: 0,
  atlantidaCents: 0,
  ahorrosCents: 0,
  oneOwedCents: 0,
} as const;

export type SnapshotReservation = { fundId: string; amountCents: number; note: string };

export const PRESUS_NUEVO_RESERVATIONS: SnapshotReservation[] = [];

export type SnapshotBudget = {
  id: string;
  budgetScope: 'HOME' | 'Z';
  name: string;
  category: string;
  frequency: Frequency;
  amountCents: number;
  coverFundId: string | null;
  usualMedium: 'CARD' | 'TRANSFER' | 'CASH';
};

export const PRESUS_NUEVO_BUDGET: SnapshotBudget[] = [];

export const PRESUS_NUEVO_INCOME = {
  zAvailableCents: 0,
  aAvailableCents: 0,
} as const;

export const PRESUS_NUEVO_CACEROLA_DEBT = {
  id: 'debt-cacerolas',
  name: 'Cacerolas',
  originalCents: 0,
  installmentCents: 0,
  startedAt: '2026-05-01T00:00:00.000Z',
  termMonths: 0,
  note: '',
} as const;

export type SnapshotGoalFund = {
  id: string;
  name: string;
  purpose: string;
  targetAmountCents: number;
  priority: number;
};

export const PRESUS_NUEVO_GOAL_FUNDS: SnapshotGoalFund[] = [];

export type SnapshotPartnerIou = {
  cell: string;
  name: string;
  amountCents: number;
  sharedTotalCents: number | null;
};

export const PRESUS_NUEVO_A_DEBE_Z: SnapshotPartnerIou[] = [];

export type SnapshotOneCharge = {
  source: 'GENERAL' | 'A';
  note: string;
  amountCents: number;
  comment: string | null;
};

export const PRESUS_NUEVO_ONE_GENERAL: SnapshotOneCharge[] = [];
export const PRESUS_NUEVO_ONE_A: SnapshotOneCharge[] = [];
export const PRESUS_NUEVO_ONE_CHARGES: SnapshotOneCharge[] = [];

export type SnapshotListaPagoGasto = {
  name: string;
  amountCents: number;
  medium: 'TRANSFER' | 'CARD' | 'CASH';
  occurredAt: string;
};

export const PRESUS_NUEVO_LISTA_PAGOS_GASTOS: SnapshotListaPagoGasto[] = [];
export const PRESUS_NUEVO_LISTA_PAGOS_GASTOS_CENTS = 0;
export const PRESUS_NUEVO_LISTA_PAGOS_NOTE = 'Lista Pagos';
export const PRESUS_NUEVO_LISTA_PAGOS_REBUILD_AT = '2026-05-13T00:00:00.000Z';

export function hasPresusNuevoSnapshotData() {
  return (
    PRESUS_NUEVO_BALANCES.barrasCents > 0 ||
    PRESUS_NUEVO_BALANCES.atlantidaCents > 0 ||
    PRESUS_NUEVO_BALANCES.oneOwedCents > 0 ||
    PRESUS_NUEVO_BUDGET.length > 0 ||
    PRESUS_NUEVO_ONE_CHARGES.length > 0 ||
    PRESUS_NUEVO_LISTA_PAGOS_GASTOS.length > 0 ||
    PRESUS_NUEVO_GOAL_FUNDS.length > 0
  );
}
