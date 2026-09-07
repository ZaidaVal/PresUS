import type {
  Account,
  BudgetItem,
  BudgetItemDraft,
  CardCharge,
  CreditCard,
  Debt,
  DebtPayment,
  Fund,
  Person,
  Reservation,
  ReservationStatus,
  SplitRow,
  TransactionRow,
  TransactionStatus,
} from './types';

export interface LedgerTx {
  getMeta(key: string): Promise<string | undefined>;
  setMeta(key: string, value: string): Promise<void>;
  listMeta(): Promise<Record<string, string>>;
  replaceDomain(data: DomainDump): Promise<void>;

  listPeople(): Promise<Person[]>;
  getPerson(id: string): Promise<Person | undefined>;
  insertPerson(row: Person): Promise<void>;
  updatePerson(row: Person): Promise<void>;

  listAccounts(): Promise<Account[]>;
  getAccount(id: string): Promise<Account | undefined>;
  insertAccount(row: Account): Promise<void>;
  updateAccount(row: Account): Promise<void>;
  deleteAccount(id: string): Promise<void>;

  listFunds(): Promise<Fund[]>;
  getFund(id: string): Promise<Fund | undefined>;
  listFundsByAccount(accountId: string): Promise<Fund[]>;
  insertFund(row: Fund): Promise<void>;
  updateFund(row: Fund): Promise<void>;
  deleteFund(id: string): Promise<void>;

  insertTransaction(row: TransactionRow): Promise<void>;
  insertSplit(row: SplitRow): Promise<void>;
  updateTransactionStatus(id: string, status: TransactionStatus): Promise<void>;
  getTransaction(id: string): Promise<TransactionRow | undefined>;
  listTransactions(): Promise<TransactionRow[]>;
  listSplitsForTransaction(id: string): Promise<SplitRow[]>;
  listSplits(): Promise<SplitRow[]>;
  listPostedSplits(): Promise<SplitRow[]>;
  listPostedSplitsForAccount(accountId: string): Promise<SplitRow[]>;

  insertReservation(row: Reservation): Promise<void>;
  updateReservation(row: Reservation): Promise<void>;
  updateReservationStatus(id: string, status: ReservationStatus): Promise<void>;
  listReservations(): Promise<Reservation[]>;
  listActiveReservations(): Promise<Reservation[]>;
  getReservation(id: string): Promise<Reservation | undefined>;

  listBudgetItems(): Promise<BudgetItem[]>;
  getBudgetItem(id: string): Promise<BudgetItem | undefined>;
  insertBudgetItem(row: BudgetItemDraft): Promise<void>;
  updateBudgetItem(row: BudgetItemDraft): Promise<void>;
  deleteBudgetItem(id: string): Promise<void>;

  listCreditCards(): Promise<CreditCard[]>;
  getCreditCard(id: string): Promise<CreditCard | undefined>;
  insertCreditCard(row: CreditCard): Promise<void>;
  updateCreditCard(row: CreditCard): Promise<void>;
  deleteCreditCard(id: string): Promise<void>;

  listCardCharges(): Promise<CardCharge[]>;
  getCardCharge(id: string): Promise<CardCharge | undefined>;
  insertCardCharge(row: CardCharge): Promise<void>;
  updateCardCharge(row: CardCharge): Promise<void>;

  listDebts(): Promise<Debt[]>;
  getDebt(id: string): Promise<Debt | undefined>;
  insertDebt(row: Debt): Promise<void>;
  updateDebt(row: Debt): Promise<void>;
  deleteDebt(id: string): Promise<void>;

  listDebtPayments(): Promise<DebtPayment[]>;
  listDebtPaymentsByDebt(debtId: string): Promise<DebtPayment[]>;
  insertDebtPayment(row: DebtPayment): Promise<void>;
}

export interface DomainDump {
  meta: Record<string, string>;
  people: Person[];
  accounts: Account[];
  funds: Fund[];
  transactions: TransactionRow[];
  splits: SplitRow[];
  reservations: Reservation[];
  budgetItems: BudgetItem[];
  creditCards: CreditCard[];
  cardCharges: CardCharge[];
  debts: Debt[];
  debtPayments: DebtPayment[];
}

export interface Ledger {
  withTransaction<T>(fn: (tx: LedgerTx) => Promise<T>): Promise<T>;
}

export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
