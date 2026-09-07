import { create } from 'zustand';
import type { Ledger } from '../domain/ledger';
import { scheduleLatestPush } from '../sync/accessSync';
import {
  computeCardBalances,
  computeFundBalances,
  computeSafeAvailable,
  parseDashboardPrefs,
  parseBudgetCutoffs,
  parseReleaseDestinations,
  resolveReleaseDestinationIds,
  snapshot,
  retireExpenseBudgetsBeyondHorizon,
  DASHBOARD_PREFS_KEY,
  BUDGET_CUTOFFS_META_KEY,
  LAST_CUTOFF_AT_META_KEY,
  RELEASE_DESTINATIONS_META_KEY,
  type Account,
  type AccountBalance,
  type BudgetCutoffRecord,
  type BudgetItem,
  type CardBalance,
  type CardCharge,
  type CreditCard,
  type DashboardPrefs,
  type Debt,
  type DebtPayment,
  type FundSegment,
  type GoalKind,
  type FundBalance,
  type Person,
  type Reservation,
  type SafeAvailable,
  type SplitRow,
  type TransactionRow,
} from '../domain';

export type SettingsTab = 'catalogos' | 'hoy' | 'acceso' | 'drive' | 'control';
export type DashboardPanel = 'hoy' | 'puedo-usar' | 'este-mes';
export type MoveIntent =
  | 'GASTAR'
  | 'GASTO'
  | 'GASTO_X'
  | 'CARGO_TARJETA'
  | 'TRANSFERENCIA'
  | 'APORTE'
  | 'RESERVA'
  | 'FONDOS'
  | 'GASTAR_APARTADO'
  | 'PAGO_TARJETA';

export type Screen =
  | { name: 'dashboard'; panel?: DashboardPanel }
  | { name: 'accounts' }
  | { name: 'account'; id: string; focus?: 'cuadre' }
  | { name: 'account-edit'; id?: string }
  | { name: 'funds' }
  | { name: 'fund-edit'; id?: string; segment?: FundSegment; goalKind?: GoalKind }
  | { name: 'card-edit'; id?: string }
  | { name: 'move'; id?: string; fundId?: string; intent?: MoveIntent; gastoX?: boolean; edit?: boolean }
  | { name: 'movements'; list?: 'gastos' | 'todos' }
  | { name: 'budgets' }
  | { name: 'budget-balance' }
  | { name: 'budget-edit'; id?: string }
  | { name: 'savings' }
  | { name: 'projects' }
  | { name: 'debts' }
  | { name: 'debt-edit'; id?: string }
  | { name: 'debt-plan'; id?: string }
  | { name: 'monthly-spend' }
  | { name: 'settings'; tab?: SettingsTab };

interface FinanceState {
  ledger: Ledger | null;
  ready: boolean;
  error: string | null;
  sqliteStatus: string;
  deviceId: string | null;
  schemaVersion: string | null;
  screen: Screen;
  people: Person[];
  accounts: Account[];
  balances: AccountBalance[];
  funds: FundBalance[];
  cards: CardBalance[];
  creditCards: CreditCard[];
  debts: Debt[];
  debtPayments: DebtPayment[];
  safe: SafeAvailable | null;
  transactions: TransactionRow[];
  reservations: Reservation[];
  budgetItems: BudgetItem[];
  cardCharges: CardCharge[];
  splitsByTx: Map<string, SplitRow[]>;
  dashboardPrefs: DashboardPrefs;
  releaseDestinationAccountIds: string[];
  budgetCutoffs: BudgetCutoffRecord[];
  lastCutoffAt: string | null;
  setLedger: (ledger: Ledger) => Promise<void>;
  setError: (error: string) => void;
  setSqliteStatus: (status: string) => void;
  go: (screen: Screen) => void;
  goHome: () => void;
  refresh: () => Promise<void>;
}

export const useFinance = create<FinanceState>((set, get) => ({
  ledger: null,
  ready: false,
  error: null,
  sqliteStatus: 'Iniciando archivo local…',
  deviceId: null,
  schemaVersion: null,
  screen: { name: 'dashboard' },
  people: [],
  accounts: [],
  balances: [],
  funds: [],
  cards: [],
  creditCards: [],
  debts: [],
  debtPayments: [],
  safe: null,
  transactions: [],
  reservations: [],
  budgetItems: [],
  cardCharges: [],
  splitsByTx: new Map(),
  dashboardPrefs: parseDashboardPrefs(null),
  releaseDestinationAccountIds: [],
  budgetCutoffs: [],
  lastCutoffAt: null,
  setError: (error) => set({ error, ready: false }),
  setSqliteStatus: (sqliteStatus) => set({ sqliteStatus }),
  go: (screen) => set({ screen }),
  goHome: () => set({ screen: { name: 'dashboard' } }),
  setLedger: async (ledger) => {
    set({ ledger, sqliteStatus: 'SQLite local OK' });
    await get().refresh();
    set({ ready: true });
  },
  refresh: async () => {
    const ledger = get().ledger;
    if (!ledger) return;
    await ledger.withTransaction(async (tx) => {
      await retireExpenseBudgetsBeyondHorizon(tx);
      const snap = await snapshot(tx);
      const funds = await computeFundBalances(tx);
      const cards = await computeCardBalances(tx);
      const creditCards = await tx.listCreditCards();
      const safe = await computeSafeAvailable(tx);
      const deviceId = (await tx.getMeta('device_id')) ?? null;
      const schemaVersion = (await tx.getMeta('schema_version')) ?? null;
      const dashboardPrefs = parseDashboardPrefs(await tx.getMeta(DASHBOARD_PREFS_KEY));
      const releaseDestinationAccountIds = resolveReleaseDestinationIds(
        snap.accounts,
        parseReleaseDestinations(await tx.getMeta(RELEASE_DESTINATIONS_META_KEY)),
      );
      const budgetCutoffs = parseBudgetCutoffs(await tx.getMeta(BUDGET_CUTOFFS_META_KEY));
      const lastCutoffAt = (await tx.getMeta(LAST_CUTOFF_AT_META_KEY)) ?? null;
      set({
        people: snap.people,
        accounts: snap.accounts,
        balances: snap.balances,
        funds,
        cards,
        creditCards,
        debts: snap.debts,
        debtPayments: snap.debtPayments,
        safe,
        transactions: snap.transactions,
        reservations: snap.reservations,
        budgetItems: snap.budgetItems,
        cardCharges: snap.cardCharges,
        splitsByTx: snap.splitsByTx,
        deviceId,
        schemaVersion,
        dashboardPrefs,
        releaseDestinationAccountIds,
        budgetCutoffs,
        lastCutoffAt,
      });
    });
    scheduleLatestPush(ledger);
  },
}));

