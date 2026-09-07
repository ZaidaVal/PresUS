import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { Ledger, LedgerTx, DomainDump } from '../domain/ledger';
import { DOMAIN_DELETE_ORDER } from './domainWipe';
import { completeBudgetShares } from '../domain/budget';
import type {
  Account,
  BudgetItem,
  BudgetItemDraft,
  CardCharge,
  CreditCard,
  Debt,
  DebtPayment,
  Fund,
  InterestKind,
  Person,
  Reservation,
  ReservationStatus,
  SplitRow,
  TransactionRow,
  TransactionStatus,
} from '../domain/types';

function bool(value: number): boolean {
  return value === 1;
}

type SplitDbRow = {
  id: string;
  transaction_id: string;
  account_id: string | null;
  fund_id: string | null;
  person_id: string | null;
  card_id: string | null;
  amount_cents: number;
  role: SplitRow['role'];
};

export class SqliteLedger implements Ledger {
  constructor(
    private readonly db: SQLiteDBConnection,
    private readonly persist: () => Promise<void>,
  ) {}

  async withTransaction<T>(fn: (tx: LedgerTx) => Promise<T>): Promise<T> {
    await this.db.beginTransaction();
    try {
      const result = await fn(new SqliteTx(this.db));
      await this.db.commitTransaction();
      await this.persist();
      return result;
    } catch (error) {
      try {
        await this.db.rollbackTransaction();
      } catch {
        /* ignore rollback errors */
      }
      throw error;
    }
  }
}

class SqliteTx implements LedgerTx {
  constructor(private readonly db: SQLiteDBConnection) {}

  private async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.db.query(sql, params);
    return (result.values ?? []) as T[];
  }

  private async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await this.all<T>(sql, params);
    return rows[0];
  }

  private async run(sql: string, params: unknown[] = []) {
    await this.db.run(sql, params, false);
  }

  private mapSplits(rows: SplitDbRow[]): SplitRow[] {
    return rows.map((row) => ({
      id: row.id,
      transactionId: row.transaction_id,
      accountId: row.account_id,
      fundId: row.fund_id,
      personId: row.person_id,
      cardId: row.card_id ?? null,
      amountCents: row.amount_cents,
      role: row.role,
    }));
  }

  async getMeta(key: string) {
    const row = await this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
    return row?.value;
  }

  async setMeta(key: string, value: string) {
    await this.run(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value],
    );
  }

  async listMeta() {
    const rows = await this.all<{ key: string; value: string }>('SELECT key, value FROM meta');
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  async replaceDomain(data: DomainDump) {
    for (const table of DOMAIN_DELETE_ORDER) {
      await this.run(`DELETE FROM ${table}`);
    }
    for (const [key, value] of Object.entries(data.meta)) {
      await this.setMeta(key, value);
    }
    for (const row of data.people) await this.insertPerson(row);
    for (const row of data.accounts) await this.insertAccount(row);
    for (const row of data.funds) await this.insertFund(row);
    for (const row of data.creditCards ?? []) await this.insertCreditCard(row);
    for (const row of data.debts ?? []) await this.insertDebt(row);
    for (const row of data.transactions) await this.insertTransaction(row);
    for (const row of data.splits) await this.insertSplit(row);
    for (const row of data.reservations) await this.insertReservation(row);
    for (const row of data.budgetItems) await this.insertBudgetItem(row);
    for (const row of data.cardCharges ?? []) await this.insertCardCharge(row);
    for (const row of data.debtPayments ?? []) await this.insertDebtPayment(row);
  }

  async listPeople() {
    const rows = await this.all<{ id: string; code: 'Z' | 'A'; display_name: string }>(
      'SELECT id, code, display_name FROM people ORDER BY code',
    );
    return rows.map((row) => ({ id: row.id, code: row.code, displayName: row.display_name }));
  }

  async getPerson(id: string) {
    return (await this.listPeople()).find((row) => row.id === id);
  }

  async insertPerson(row: Person) {
    await this.run('INSERT INTO people (id, code, display_name) VALUES (?, ?, ?)', [
      row.id,
      row.code,
      row.displayName,
    ]);
  }

  async updatePerson(row: Person) {
    await this.run('UPDATE people SET display_name = ?, code = ? WHERE id = ?', [
      row.displayName,
      row.code,
      row.id,
    ]);
  }

  private mapAccount(row: {
    id: string;
    name: string;
    kind: Account['kind'];
    visibility: Account['visibility'];
    owner_person_id: string | null;
    counts_as_liquidity: number;
    is_card_payment_source: number;
    is_credit?: number | null;
  }): Account {
    const isCredit = bool(row.is_credit ?? 0) || row.kind === 'CREDIT';
    return {
      id: row.id,
      name: row.name,
      kind: isCredit ? 'CREDIT' : row.kind,
      visibility: row.visibility,
      ownerPersonId: row.owner_person_id,
      countsAsLiquidity: bool(row.counts_as_liquidity),
      isCardPaymentSource: bool(row.is_card_payment_source),
    };
  }

  async listAccounts() {
    const rows = await this.all<Parameters<SqliteTx['mapAccount']>[0]>(
      `SELECT id, name, kind, visibility, owner_person_id, counts_as_liquidity, is_card_payment_source, is_credit
       FROM accounts ORDER BY name`,
    );
    return rows.map((row) => this.mapAccount(row));
  }

  async getAccount(id: string) {
    const row = await this.get<Parameters<SqliteTx['mapAccount']>[0]>(
      `SELECT id, name, kind, visibility, owner_person_id, counts_as_liquidity, is_card_payment_source, is_credit
       FROM accounts WHERE id = ?`,
      [id],
    );
    return row ? this.mapAccount(row) : undefined;
  }

  async insertAccount(row: Account) {
    await this.run(
      `INSERT INTO accounts (id, name, kind, visibility, owner_person_id, counts_as_liquidity, is_card_payment_source, is_credit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.name,
        row.kind === 'CREDIT' ? 'BANK' : row.kind,
        row.visibility,
        row.ownerPersonId,
        row.countsAsLiquidity ? 1 : 0,
        row.isCardPaymentSource ? 1 : 0,
        row.kind === 'CREDIT' ? 1 : 0,
      ],
    );
  }

  async updateAccount(row: Account) {
    await this.run(
      `UPDATE accounts SET name = ?, kind = ?, visibility = ?, owner_person_id = ?,
        counts_as_liquidity = ?, is_card_payment_source = ?, is_credit = ? WHERE id = ?`,
      [
        row.name,
        row.kind === 'CREDIT' ? 'BANK' : row.kind,
        row.visibility,
        row.ownerPersonId,
        row.countsAsLiquidity ? 1 : 0,
        row.isCardPaymentSource ? 1 : 0,
        row.kind === 'CREDIT' ? 1 : 0,
        row.id,
      ],
    );
  }

  async deleteAccount(id: string) {
    await this.run('DELETE FROM accounts WHERE id = ?', [id]);
  }

  private mapFund(row: {
    id: string;
    account_id: string;
    name: string;
    purpose: string;
    target_amount_cents: number | null;
    priority: number | null;
    segment?: string | null;
    interest_kind?: string | null;
    annual_rate_bps?: number | null;
    due_anchor?: string | null;
  }): Fund {
    const interestKind = (row.interest_kind ?? 'NONE') as InterestKind;
    const dueAnchor =
      row.due_anchor === 'MONTH_START' || row.due_anchor === 'MONTH_MID' || row.due_anchor === 'MONTH_END'
        ? row.due_anchor
        : null;
    return {
      id: row.id,
      accountId: row.account_id,
      name: row.name,
      purpose: row.purpose,
      targetAmountCents: row.target_amount_cents,
      priority: row.priority,
      segment: row.segment === 'SAVINGS' ? 'SAVINGS' : 'OPERATING',
      interestKind: interestKind || 'NONE',
      annualRateBps: row.annual_rate_bps ?? null,
      dueAnchor,
    };
  }

  async listFunds() {
    const rows = await this.all<Parameters<SqliteTx['mapFund']>[0]>(
      `SELECT id, account_id, name, purpose, target_amount_cents, priority, segment,
              interest_kind, annual_rate_bps, due_anchor FROM funds ORDER BY name`,
    );
    return rows.map((row) => this.mapFund(row));
  }

  async getFund(id: string) {
    const row = await this.get<Parameters<SqliteTx['mapFund']>[0]>(
      `SELECT id, account_id, name, purpose, target_amount_cents, priority, segment,
              interest_kind, annual_rate_bps, due_anchor FROM funds WHERE id = ?`,
      [id],
    );
    return row ? this.mapFund(row) : undefined;
  }

  async listFundsByAccount(accountId: string) {
    const rows = await this.all<Parameters<SqliteTx['mapFund']>[0]>(
      `SELECT id, account_id, name, purpose, target_amount_cents, priority, segment,
              interest_kind, annual_rate_bps, due_anchor FROM funds WHERE account_id = ? ORDER BY name`,
      [accountId],
    );
    return rows.map((row) => this.mapFund(row));
  }

  async insertFund(row: Fund) {
    await this.run(
      `INSERT INTO funds (id, account_id, name, purpose, target_amount_cents, priority, segment, interest_kind, annual_rate_bps, due_anchor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.accountId,
        row.name,
        row.purpose,
        row.targetAmountCents,
        row.priority,
        row.segment === 'SAVINGS' ? 'SAVINGS' : 'OPERATING',
        row.interestKind ?? 'NONE',
        row.annualRateBps ?? null,
        row.dueAnchor ?? null,
      ],
    );
  }

  async updateFund(row: Fund) {
    await this.run(
      `UPDATE funds SET account_id = ?, name = ?, purpose = ?, target_amount_cents = ?, priority = ?,
        segment = ?, interest_kind = ?, annual_rate_bps = ?, due_anchor = ? WHERE id = ?`,
      [
        row.accountId,
        row.name,
        row.purpose,
        row.targetAmountCents,
        row.priority,
        row.segment === 'SAVINGS' ? 'SAVINGS' : 'OPERATING',
        row.interestKind ?? 'NONE',
        row.annualRateBps ?? null,
        row.dueAnchor ?? null,
        row.id,
      ],
    );
  }

  async deleteFund(id: string) {
    await this.run('DELETE FROM funds WHERE id = ?', [id]);
  }

  private mapTx(row: {
    id: string;
    type: TransactionRow['type'];
    occurred_at: string;
    period: TransactionRow['period'];
    note: string;
    created_at: string;
    status: TransactionStatus;
    reverses_id: string | null;
  }): TransactionRow {
    return {
      id: row.id,
      type: row.type,
      occurredAt: row.occurred_at,
      period: row.period,
      note: row.note,
      createdAt: row.created_at,
      status: row.status,
      reversesId: row.reverses_id,
    };
  }

  async insertTransaction(row: TransactionRow) {
    await this.run(
      `INSERT INTO transactions (id, type, occurred_at, period, note, created_at, status, reverses_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.type, row.occurredAt, row.period, row.note, row.createdAt, row.status, row.reversesId],
    );
  }

  async insertSplit(row: SplitRow) {
    await this.run(
      `INSERT INTO transaction_splits (id, transaction_id, account_id, fund_id, person_id, card_id, amount_cents, role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.transactionId, row.accountId, row.fundId, row.personId, row.cardId ?? null, row.amountCents, row.role],
    );
  }

  async updateTransactionStatus(id: string, status: TransactionStatus) {
    await this.run('UPDATE transactions SET status = ? WHERE id = ?', [status, id]);
  }

  async getTransaction(id: string) {
    const row = await this.get<Parameters<SqliteTx['mapTx']>[0]>(
      `SELECT id, type, occurred_at, period, note, created_at, status, reverses_id
       FROM transactions WHERE id = ?`,
      [id],
    );
    return row ? this.mapTx(row) : undefined;
  }

  async listTransactions() {
    const rows = await this.all<Parameters<SqliteTx['mapTx']>[0]>(
      `SELECT id, type, occurred_at, period, note, created_at, status, reverses_id
       FROM transactions ORDER BY occurred_at DESC, created_at DESC`,
    );
    return rows.map((row) => this.mapTx(row));
  }

  async listSplitsForTransaction(id: string) {
    return this.mapSplits(
      await this.all<SplitDbRow>(
        `SELECT id, transaction_id, account_id, fund_id, person_id, card_id, amount_cents, role
         FROM transaction_splits WHERE transaction_id = ?`,
        [id],
      ),
    );
  }

  async listSplits() {
    return this.mapSplits(
      await this.all<SplitDbRow>(
        `SELECT id, transaction_id, account_id, fund_id, person_id, card_id, amount_cents, role
         FROM transaction_splits`,
      ),
    );
  }

  async listPostedSplits() {
    return this.mapSplits(
      await this.all<SplitDbRow>(
        `SELECT s.id, s.transaction_id, s.account_id, s.fund_id, s.person_id, s.card_id, s.amount_cents, s.role
         FROM transaction_splits s
         JOIN transactions t ON t.id = s.transaction_id
         WHERE t.status = 'POSTED'`,
      ),
    );
  }

  async listPostedSplitsForAccount(accountId: string) {
    const splits = await this.listPostedSplits();
    return splits.filter((row) => row.accountId === accountId);
  }

  async insertReservation(row: Reservation) {
    await this.run(
      `INSERT INTO reservations (id, fund_id, source_transaction_id, amount_cents, status)
       VALUES (?, ?, ?, ?, ?)`,
      [row.id, row.fundId, row.sourceTransactionId, row.amountCents, row.status],
    );
  }

  async updateReservation(row: Reservation) {
    await this.run(
      `UPDATE reservations SET fund_id = ?, source_transaction_id = ?, amount_cents = ?, status = ? WHERE id = ?`,
      [row.fundId, row.sourceTransactionId, row.amountCents, row.status, row.id],
    );
  }

  async updateReservationStatus(id: string, status: ReservationStatus) {
    await this.run('UPDATE reservations SET status = ? WHERE id = ?', [status, id]);
  }

  async listReservations() {
    const rows = await this.all<{
      id: string;
      fund_id: string;
      source_transaction_id: string;
      amount_cents: number;
      status: ReservationStatus;
    }>('SELECT id, fund_id, source_transaction_id, amount_cents, status FROM reservations');
    return rows.map((row) => ({
      id: row.id,
      fundId: row.fund_id,
      sourceTransactionId: row.source_transaction_id,
      amountCents: row.amount_cents,
      status: row.status,
    }));
  }

  async listActiveReservations() {
    return (await this.listReservations()).filter((row) => row.status === 'ACTIVE');
  }

  async getReservation(id: string) {
    return (await this.listReservations()).find((row) => row.id === id);
  }

  private mapBudget(row: {
    id: string;
    budget_scope: BudgetItem['budgetScope'];
    name: string;
    category: string;
    frequency: BudgetItem['frequency'];
    amount_cents: number;
    z_share_cents?: number | null;
    a_share_cents?: number | null;
    fortnight: BudgetItem['fortnight'];
    cover_fund_id: string | null;
    usual_medium: BudgetItem['usualMedium'];
    active: number;
  }): BudgetItem {
    return completeBudgetShares({
      id: row.id,
      budgetScope: row.budget_scope,
      name: row.name,
      category: row.category,
      frequency: row.frequency,
      amountCents: row.amount_cents,
      zShareCents: row.z_share_cents ?? undefined,
      aShareCents: row.a_share_cents ?? undefined,
      fortnight: row.fortnight,
      coverFundId: row.cover_fund_id,
      usualMedium: row.usual_medium,
      active: bool(row.active),
    });
  }

  async listBudgetItems() {
    const rows = await this.all<Parameters<SqliteTx['mapBudget']>[0]>(
      `SELECT id, budget_scope, name, category, frequency, amount_cents, z_share_cents, a_share_cents,
              fortnight, cover_fund_id, usual_medium, active
       FROM budget_items ORDER BY budget_scope, name`,
    );
    return rows.map((row) => this.mapBudget(row));
  }

  async getBudgetItem(id: string) {
    const row = await this.get<Parameters<SqliteTx['mapBudget']>[0]>(
      `SELECT id, budget_scope, name, category, frequency, amount_cents, z_share_cents, a_share_cents,
              fortnight, cover_fund_id, usual_medium, active
       FROM budget_items WHERE id = ?`,
      [id],
    );
    return row ? this.mapBudget(row) : undefined;
  }

  async insertBudgetItem(row: BudgetItemDraft) {
    const complete = completeBudgetShares(row);
    await this.run(
      `INSERT INTO budget_items (
        id, budget_scope, name, category, frequency, amount_cents, z_share_cents, a_share_cents,
        fortnight, cover_fund_id, usual_medium, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        complete.id,
        complete.budgetScope,
        complete.name,
        complete.category,
        complete.frequency,
        complete.amountCents,
        complete.zShareCents,
        complete.aShareCents,
        complete.fortnight,
        complete.coverFundId,
        complete.usualMedium,
        complete.active ? 1 : 0,
      ],
    );
  }

  async updateBudgetItem(row: BudgetItemDraft) {
    const complete = completeBudgetShares(row);
    await this.run(
      `UPDATE budget_items SET
        budget_scope = ?, name = ?, category = ?, frequency = ?, amount_cents = ?,
        z_share_cents = ?, a_share_cents = ?, fortnight = ?, cover_fund_id = ?, usual_medium = ?, active = ?
       WHERE id = ?`,
      [
        complete.budgetScope,
        complete.name,
        complete.category,
        complete.frequency,
        complete.amountCents,
        complete.zShareCents,
        complete.aShareCents,
        complete.fortnight,
        complete.coverFundId,
        complete.usualMedium,
        complete.active ? 1 : 0,
        complete.id,
      ],
    );
  }

  async deleteBudgetItem(id: string) {
    await this.run('DELETE FROM budget_items WHERE id = ?', [id]);
  }

  private mapCard(row: {
    id: string;
    name: string;
    payment_account_id: string;
    cover_fund_id: string | null;
    credit_limit_cents: number | null;
    credit_line_id: string | null;
    credit_line_limit_cents: number | null;
    person_id: string | null;
  }): CreditCard {
    return {
      id: row.id,
      name: row.name,
      paymentAccountId: row.payment_account_id,
      coverFundId: row.cover_fund_id,
      creditLimitCents: row.credit_limit_cents,
      creditLineId: row.credit_line_id,
      creditLineLimitCents: row.credit_line_limit_cents,
      personId: row.person_id,
    };
  }

  async listCreditCards() {
    const rows = await this.all<Parameters<SqliteTx['mapCard']>[0]>(
      `SELECT id, name, payment_account_id, cover_fund_id, credit_limit_cents,
              credit_line_id, credit_line_limit_cents, person_id
       FROM credit_cards ORDER BY name`,
    );
    return rows.map((row) => this.mapCard(row));
  }

  async getCreditCard(id: string) {
    const row = await this.get<Parameters<SqliteTx['mapCard']>[0]>(
      `SELECT id, name, payment_account_id, cover_fund_id, credit_limit_cents,
              credit_line_id, credit_line_limit_cents, person_id
       FROM credit_cards WHERE id = ?`,
      [id],
    );
    return row ? this.mapCard(row) : undefined;
  }

  async insertCreditCard(row: CreditCard) {
    await this.run(
      `INSERT INTO credit_cards (
         id, name, payment_account_id, cover_fund_id, credit_limit_cents,
         credit_line_id, credit_line_limit_cents, person_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.name,
        row.paymentAccountId,
        row.coverFundId,
        row.creditLimitCents,
        row.creditLineId ?? null,
        row.creditLineLimitCents ?? null,
        row.personId,
      ],
    );
  }

  async updateCreditCard(row: CreditCard) {
    await this.run(
      `UPDATE credit_cards SET name = ?, payment_account_id = ?, cover_fund_id = ?,
         credit_limit_cents = ?, credit_line_id = ?, credit_line_limit_cents = ?, person_id = ?
       WHERE id = ?`,
      [
        row.name,
        row.paymentAccountId,
        row.coverFundId,
        row.creditLimitCents,
        row.creditLineId ?? null,
        row.creditLineLimitCents ?? null,
        row.personId,
        row.id,
      ],
    );
  }

  async deleteCreditCard(id: string) {
    await this.run('DELETE FROM credit_cards WHERE id = ?', [id]);
  }

  private mapCharge(row: {
    id: string;
    card_id: string;
    transaction_id: string;
    amount_cents: number;
    charge_class: CardCharge['chargeClass'];
    coverage_status: CardCharge['coverageStatus'];
    cover_fund_id: string | null;
  }): CardCharge {
    return {
      id: row.id,
      cardId: row.card_id,
      transactionId: row.transaction_id,
      amountCents: row.amount_cents,
      chargeClass: row.charge_class,
      coverageStatus: row.coverage_status,
      coverFundId: row.cover_fund_id,
    };
  }

  async listCardCharges() {
    const rows = await this.all<Parameters<SqliteTx['mapCharge']>[0]>(
      `SELECT id, card_id, transaction_id, amount_cents, charge_class, coverage_status, cover_fund_id
       FROM card_charges`,
    );
    return rows.map((row) => this.mapCharge(row));
  }

  async getCardCharge(id: string) {
    const row = await this.get<Parameters<SqliteTx['mapCharge']>[0]>(
      `SELECT id, card_id, transaction_id, amount_cents, charge_class, coverage_status, cover_fund_id
       FROM card_charges WHERE id = ?`,
      [id],
    );
    return row ? this.mapCharge(row) : undefined;
  }

  async insertCardCharge(row: CardCharge) {
    await this.run(
      `INSERT INTO card_charges (
        id, card_id, transaction_id, amount_cents, charge_class, coverage_status, cover_fund_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.cardId,
        row.transactionId,
        row.amountCents,
        row.chargeClass,
        row.coverageStatus,
        row.coverFundId,
      ],
    );
  }

  async updateCardCharge(row: CardCharge) {
    await this.run(
      `UPDATE card_charges SET
        card_id = ?, transaction_id = ?, amount_cents = ?, charge_class = ?, coverage_status = ?, cover_fund_id = ?
       WHERE id = ?`,
      [
        row.cardId,
        row.transactionId,
        row.amountCents,
        row.chargeClass,
        row.coverageStatus,
        row.coverFundId,
        row.id,
      ],
    );
  }

  private mapDebt(row: {
    id: string;
    name: string;
    kind: Debt['kind'];
    original_cents: number;
    annual_rate_bps: number;
    term_months: number;
    installment_cents: number;
    started_at: string;
    payment_account_id: string | null;
    cover_fund_id: string | null;
    amortization: Debt['amortization'];
    compounding: Debt['compounding'];
    extra_monthly_cents: number;
    extra_fortnight_cents: number;
    extra_every_n_months: number | null;
    extra_every_n_amount_cents: number;
    note: string;
    active: number;
  }): Debt {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      originalCents: row.original_cents,
      annualRateBps: row.annual_rate_bps,
      termMonths: row.term_months,
      installmentCents: row.installment_cents,
      startedAt: row.started_at,
      paymentAccountId: row.payment_account_id,
      coverFundId: row.cover_fund_id,
      amortization: row.amortization,
      compounding: row.compounding,
      extraMonthlyCents: row.extra_monthly_cents,
      extraFortnightCents: row.extra_fortnight_cents,
      extraEveryNMonths: row.extra_every_n_months,
      extraEveryNAmountCents: row.extra_every_n_amount_cents,
      note: row.note,
      active: bool(row.active),
    };
  }

  async listDebts() {
    const rows = await this.all<Parameters<SqliteTx['mapDebt']>[0]>(
      `SELECT id, name, kind, original_cents, annual_rate_bps, term_months, installment_cents, started_at,
              payment_account_id, cover_fund_id, amortization, compounding, extra_monthly_cents,
              extra_fortnight_cents, extra_every_n_months, extra_every_n_amount_cents, note, active
       FROM debts ORDER BY name`,
    );
    return rows.map((row) => this.mapDebt(row));
  }

  async getDebt(id: string) {
    const row = await this.get<Parameters<SqliteTx['mapDebt']>[0]>(
      `SELECT id, name, kind, original_cents, annual_rate_bps, term_months, installment_cents, started_at,
              payment_account_id, cover_fund_id, amortization, compounding, extra_monthly_cents,
              extra_fortnight_cents, extra_every_n_months, extra_every_n_amount_cents, note, active
       FROM debts WHERE id = ?`,
      [id],
    );
    return row ? this.mapDebt(row) : undefined;
  }

  async insertDebt(row: Debt) {
    await this.run(
      `INSERT INTO debts (
        id, name, kind, original_cents, annual_rate_bps, term_months, installment_cents, started_at,
        payment_account_id, cover_fund_id, amortization, compounding, extra_monthly_cents,
        extra_fortnight_cents, extra_every_n_months, extra_every_n_amount_cents, note, active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.name,
        row.kind,
        row.originalCents,
        row.annualRateBps,
        row.termMonths,
        row.installmentCents,
        row.startedAt,
        row.paymentAccountId,
        row.coverFundId,
        row.amortization,
        row.compounding,
        row.extraMonthlyCents,
        row.extraFortnightCents,
        row.extraEveryNMonths,
        row.extraEveryNAmountCents,
        row.note,
        row.active ? 1 : 0,
      ],
    );
  }

  async updateDebt(row: Debt) {
    await this.run(
      `UPDATE debts SET
        name = ?, kind = ?, original_cents = ?, annual_rate_bps = ?, term_months = ?, installment_cents = ?,
        started_at = ?, payment_account_id = ?, cover_fund_id = ?, amortization = ?, compounding = ?,
        extra_monthly_cents = ?, extra_fortnight_cents = ?, extra_every_n_months = ?,
        extra_every_n_amount_cents = ?, note = ?, active = ?
       WHERE id = ?`,
      [
        row.name,
        row.kind,
        row.originalCents,
        row.annualRateBps,
        row.termMonths,
        row.installmentCents,
        row.startedAt,
        row.paymentAccountId,
        row.coverFundId,
        row.amortization,
        row.compounding,
        row.extraMonthlyCents,
        row.extraFortnightCents,
        row.extraEveryNMonths,
        row.extraEveryNAmountCents,
        row.note,
        row.active ? 1 : 0,
        row.id,
      ],
    );
  }

  async deleteDebt(id: string) {
    await this.run('DELETE FROM debts WHERE id = ?', [id]);
  }

  private mapDebtPayment(row: {
    id: string;
    debt_id: string;
    transaction_id: string;
    principal_cents: number;
    interest_cents: number;
    occurred_at: string;
  }): DebtPayment {
    return {
      id: row.id,
      debtId: row.debt_id,
      transactionId: row.transaction_id,
      principalCents: row.principal_cents,
      interestCents: row.interest_cents,
      occurredAt: row.occurred_at,
    };
  }

  async listDebtPayments() {
    const rows = await this.all<Parameters<SqliteTx['mapDebtPayment']>[0]>(
      `SELECT id, debt_id, transaction_id, principal_cents, interest_cents, occurred_at FROM debt_payments`,
    );
    return rows.map((row) => this.mapDebtPayment(row));
  }

  async listDebtPaymentsByDebt(debtId: string) {
    const rows = await this.all<Parameters<SqliteTx['mapDebtPayment']>[0]>(
      `SELECT id, debt_id, transaction_id, principal_cents, interest_cents, occurred_at
       FROM debt_payments WHERE debt_id = ?`,
      [debtId],
    );
    return rows.map((row) => this.mapDebtPayment(row));
  }

  async insertDebtPayment(row: DebtPayment) {
    await this.run(
      `INSERT INTO debt_payments (id, debt_id, transaction_id, principal_cents, interest_cents, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.debtId, row.transactionId, row.principalCents, row.interestCents, row.occurredAt],
    );
  }
}
