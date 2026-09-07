import type {
  Account,
  BudgetItem,
  CardCharge,
  CreditCard,
  Debt,
  DebtPayment,
  Fund,
  Person,
  Reservation,
  SplitRow,
  TransactionRow,
} from '../domain/types';

export type BackupPayload = {
  format: 'finanzas-za-backup';
  schemaVersion: number;
  exportedAt: string;
  meta: Record<string, string>;
  people: Person[];
  accounts: Account[];
  funds: Fund[];
  transactions: TransactionRow[];
  splits: SplitRow[];
  reservations: Reservation[];
  budgetItems: BudgetItem[];
  creditCards?: CreditCard[];
  cardCharges?: CardCharge[];
  debts?: Debt[];
  debtPayments?: DebtPayment[];
};
