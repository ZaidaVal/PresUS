import { completeBudgetShares } from './budget';
import type { DomainDump, Ledger, LedgerTx } from './ledger';
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

interface State {
  meta: Map<string, string>;
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

function cloneState(state: State): State {
  return {
    meta: new Map(state.meta),
    people: state.people.map((row) => ({ ...row })),
    accounts: state.accounts.map((row) => ({ ...row })),
    funds: state.funds.map((row) => ({ ...row })),
    transactions: state.transactions.map((row) => ({ ...row })),
    splits: state.splits.map((row) => ({ ...row })),
    reservations: state.reservations.map((row) => ({ ...row })),
    budgetItems: state.budgetItems.map((row) => ({ ...row })),
    creditCards: state.creditCards.map((row) => ({ ...row })),
    cardCharges: state.cardCharges.map((row) => ({ ...row })),
    debts: state.debts.map((row) => ({ ...row })),
    debtPayments: state.debtPayments.map((row) => ({ ...row })),
  };
}

class MemoryTx implements LedgerTx {
  constructor(private readonly state: State) {}

  async getMeta(key: string) {
    return this.state.meta.get(key);
  }
  async setMeta(key: string, value: string) {
    this.state.meta.set(key, value);
  }
  async listMeta() {
    return Object.fromEntries(this.state.meta);
  }
  async replaceDomain(data: DomainDump) {
    this.state.meta = new Map(Object.entries(data.meta));
    this.state.people = data.people.map((row) => ({ ...row }));
    this.state.accounts = data.accounts.map((row) => ({ ...row }));
    this.state.funds = data.funds.map((row) => ({ ...row }));
    this.state.transactions = data.transactions.map((row) => ({ ...row }));
    this.state.splits = data.splits.map((row) => ({ ...row, cardId: row.cardId ?? null }));
    this.state.reservations = data.reservations.map((row) => ({ ...row }));
    this.state.budgetItems = data.budgetItems.map((row) => completeBudgetShares(row));
    this.state.creditCards = (data.creditCards ?? []).map((row) => ({ ...row }));
    this.state.cardCharges = (data.cardCharges ?? []).map((row) => ({ ...row }));
    this.state.debts = (data.debts ?? []).map((row) => ({ ...row }));
    this.state.debtPayments = (data.debtPayments ?? []).map((row) => ({ ...row }));
  }
  async listPeople() {
    return this.state.people.map((row) => ({ ...row }));
  }
  async getPerson(id: string) {
    return this.state.people.find((row) => row.id === id);
  }
  async insertPerson(row: Person) {
    this.state.people.push({ ...row });
  }
  async updatePerson(row: Person) {
    const index = this.state.people.findIndex((item) => item.id === row.id);
    if (index < 0) throw new Error(`Persona no encontrada: ${row.id}`);
    this.state.people[index] = { ...row };
  }
  async listAccounts() {
    return this.state.accounts.map((row) => ({ ...row }));
  }
  async getAccount(id: string) {
    return this.state.accounts.find((row) => row.id === id);
  }
  async insertAccount(row: Account) {
    this.state.accounts.push({ ...row });
  }
  async updateAccount(row: Account) {
    const index = this.state.accounts.findIndex((item) => item.id === row.id);
    if (index < 0) throw new Error(`Cuenta no encontrada: ${row.id}`);
    this.state.accounts[index] = { ...row };
  }
  async deleteAccount(id: string) {
    this.state.accounts = this.state.accounts.filter((row) => row.id !== id);
  }
  async listFunds() {
    return this.state.funds.map((row) => ({ ...row }));
  }
  async getFund(id: string) {
    return this.state.funds.find((row) => row.id === id);
  }
  async listFundsByAccount(accountId: string) {
    return this.state.funds.filter((row) => row.accountId === accountId).map((row) => ({ ...row }));
  }
  async insertFund(row: Fund) {
    this.state.funds.push({ ...row });
  }
  async updateFund(row: Fund) {
    const index = this.state.funds.findIndex((item) => item.id === row.id);
    if (index < 0) throw new Error(`Fondo no encontrado: ${row.id}`);
    this.state.funds[index] = { ...row };
  }
  async deleteFund(id: string) {
    this.state.funds = this.state.funds.filter((row) => row.id !== id);
  }
  async insertTransaction(row: TransactionRow) {
    this.state.transactions.push({ ...row });
  }
  async insertSplit(row: SplitRow) {
    this.state.splits.push({ ...row, cardId: row.cardId ?? null });
  }
  async updateTransactionStatus(id: string, status: TransactionStatus) {
    const row = this.state.transactions.find((item) => item.id === id);
    if (!row) throw new Error(`Transacción no encontrada: ${id}`);
    row.status = status;
  }
  async getTransaction(id: string) {
    return this.state.transactions.find((row) => row.id === id);
  }
  async listTransactions() {
    return this.state.transactions.map((row) => ({ ...row }));
  }
  async listSplitsForTransaction(id: string) {
    return this.state.splits.filter((row) => row.transactionId === id).map((row) => ({ ...row }));
  }
  async listSplits() {
    return this.state.splits.map((row) => ({ ...row }));
  }
  async listPostedSplits() {
    const posted = new Set(
      this.state.transactions.filter((row) => row.status === 'POSTED').map((row) => row.id),
    );
    return this.state.splits.filter((row) => posted.has(row.transactionId)).map((row) => ({ ...row }));
  }
  async listPostedSplitsForAccount(accountId: string) {
    const splits = await this.listPostedSplits();
    return splits.filter((row) => row.accountId === accountId);
  }
  async insertReservation(row: Reservation) {
    this.state.reservations.push({ ...row });
  }
  async updateReservation(row: Reservation) {
    const index = this.state.reservations.findIndex((item) => item.id === row.id);
    if (index < 0) throw new Error(`Reserva no encontrada: ${row.id}`);
    this.state.reservations[index] = { ...row };
  }
  async updateReservationStatus(id: string, status: ReservationStatus) {
    const row = this.state.reservations.find((item) => item.id === id);
    if (!row) throw new Error(`Reserva no encontrada: ${id}`);
    row.status = status;
  }
  async listReservations() {
    return this.state.reservations.map((row) => ({ ...row }));
  }
  async listActiveReservations() {
    return this.state.reservations
      .filter((row) => row.status === 'ACTIVE')
      .map((row) => ({ ...row }));
  }
  async getReservation(id: string) {
    return this.state.reservations.find((row) => row.id === id);
  }
  async listBudgetItems() {
    return this.state.budgetItems.map((row) => ({ ...row }));
  }
  async getBudgetItem(id: string) {
    return this.state.budgetItems.find((row) => row.id === id);
  }
  async insertBudgetItem(row: BudgetItemDraft) {
    this.state.budgetItems.push(completeBudgetShares(row));
  }
  async updateBudgetItem(row: BudgetItemDraft) {
    const index = this.state.budgetItems.findIndex((item) => item.id === row.id);
    if (index < 0) throw new Error(`Partida no encontrada: ${row.id}`);
    this.state.budgetItems[index] = completeBudgetShares(row);
  }
  async deleteBudgetItem(id: string) {
    this.state.budgetItems = this.state.budgetItems.filter((row) => row.id !== id);
  }

  async listCreditCards() {
    return this.state.creditCards.map((row) => ({ ...row }));
  }
  async getCreditCard(id: string) {
    return this.state.creditCards.find((row) => row.id === id);
  }
  async insertCreditCard(row: CreditCard) {
    this.state.creditCards.push({ ...row });
  }
  async updateCreditCard(row: CreditCard) {
    const index = this.state.creditCards.findIndex((item) => item.id === row.id);
    if (index < 0) throw new Error(`Tarjeta no encontrada: ${row.id}`);
    this.state.creditCards[index] = { ...row };
  }
  async deleteCreditCard(id: string) {
    this.state.creditCards = this.state.creditCards.filter((row) => row.id !== id);
  }

  async listCardCharges() {
    return this.state.cardCharges.map((row) => ({ ...row }));
  }
  async getCardCharge(id: string) {
    return this.state.cardCharges.find((row) => row.id === id);
  }
  async insertCardCharge(row: CardCharge) {
    this.state.cardCharges.push({ ...row });
  }
  async updateCardCharge(row: CardCharge) {
    const index = this.state.cardCharges.findIndex((item) => item.id === row.id);
    if (index < 0) throw new Error(`Cargo de tarjeta no encontrado: ${row.id}`);
    this.state.cardCharges[index] = { ...row };
  }

  async listDebts() {
    return this.state.debts.map((row) => ({ ...row }));
  }
  async getDebt(id: string) {
    return this.state.debts.find((row) => row.id === id);
  }
  async insertDebt(row: Debt) {
    this.state.debts.push({ ...row });
  }
  async updateDebt(row: Debt) {
    const index = this.state.debts.findIndex((item) => item.id === row.id);
    if (index < 0) throw new Error(`Deuda no encontrada: ${row.id}`);
    this.state.debts[index] = { ...row };
  }
  async deleteDebt(id: string) {
    this.state.debts = this.state.debts.filter((row) => row.id !== id);
  }

  async listDebtPayments() {
    return this.state.debtPayments.map((row) => ({ ...row }));
  }
  async listDebtPaymentsByDebt(debtId: string) {
    return this.state.debtPayments.filter((row) => row.debtId === debtId).map((row) => ({ ...row }));
  }
  async insertDebtPayment(row: DebtPayment) {
    this.state.debtPayments.push({ ...row });
  }
}

export class MemoryLedger implements Ledger {
  private state: State = {
    meta: new Map(),
    people: [],
    accounts: [],
    funds: [],
    transactions: [],
    splits: [],
    reservations: [],
    budgetItems: [],
    creditCards: [],
    cardCharges: [],
    debts: [],
    debtPayments: [],
  };

  async withTransaction<T>(fn: (tx: LedgerTx) => Promise<T>): Promise<T> {
    const snapshot = cloneState(this.state);
    const working = cloneState(this.state);
    try {
      const result = await fn(new MemoryTx(working));
      this.state = working;
      return result;
    } catch (error) {
      this.state = snapshot;
      throw error;
    }
  }
}
