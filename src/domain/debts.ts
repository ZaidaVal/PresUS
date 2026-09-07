import {
  extraInMonthCents,
  frenchInstallmentCents,
  monthlyInterestCents,
  simulateAmortization,
  splitDebtPayment,
  type AmortizationResult,
} from './amortization';
import { DomainError, type LedgerTx } from './ledger';
import { assertCents, type Cents } from './money';
import { assertBps } from './rates';
import type {
  BudgetItem,
  Debt,
  DebtAmortization,
  DebtCompounding,
  DebtKind,
  DebtPayment,
  TransactionRow,
} from './types';

const KINDS = new Set<DebtKind>(['MORTGAGE', 'PERSONAL', 'VEHICLE', 'OTHER']);
const AMORTIZATIONS = new Set<DebtAmortization>(['FRENCH', 'INTEREST_ONLY', 'SIMPLE']);
const COMPOUNDINGS = new Set<DebtCompounding>(['MONTHLY', 'FORTNIGHTLY', 'ANNUAL']);

function requireName(value: string, label: string): string {
  const name = value.trim();
  if (!name) throw new DomainError(`${label} no puede quedar vacío`);
  return name;
}

export function postedPrincipalPaidCents(
  originalCents: Cents,
  payments: DebtPayment[],
  transactions: TransactionRow[],
): Cents {
  assertCents(originalCents, 'capital original');
  const posted = new Set(transactions.filter((row) => row.status === 'POSTED').map((row) => row.id));
  let paid = 0;
  for (const payment of payments) {
    if (!posted.has(payment.transactionId)) continue;
    assertCents(payment.principalCents, 'capital pagado');
    paid += payment.principalCents;
  }
  return paid;
}

export function remainingDebtCents(
  originalCents: Cents,
  payments: DebtPayment[],
  transactions: TransactionRow[],
): Cents {
  return Math.max(0, originalCents - postedPrincipalPaidCents(originalCents, payments, transactions));
}

export function postedDebtPaymentCount(
  payments: DebtPayment[],
  transactions: TransactionRow[],
): number {
  const posted = new Set(transactions.filter((row) => row.status === 'POSTED').map((row) => row.id));
  return payments.filter((row) => posted.has(row.transactionId)).length;
}

export function nextDebtDueAt(startedAt: string, postedPaymentCount: number): string {
  if (!Number.isInteger(postedPaymentCount) || postedPaymentCount < 0) {
    throw new DomainError('El número de pagos debe ser un entero ≥ 0');
  }
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) {
    throw new DomainError('La fecha de inicio de la deuda no es válida');
  }
  date.setUTCMonth(date.getUTCMonth() + postedPaymentCount);
  return date.toISOString();
}

export function suggestedInstallmentCents(input: {
  principalCents: Cents;
  annualRateBps: number;
  termMonths: number;
  amortization: DebtAmortization;
  compounding: DebtCompounding;
}): Cents {
  assertCents(input.principalCents, 'capital');
  assertBps(input.annualRateBps);
  if (!Number.isInteger(input.termMonths) || input.termMonths <= 0) {
    throw new DomainError('El plazo debe ser un entero de meses mayor que cero');
  }
  if (input.amortization === 'FRENCH') {
    return frenchInstallmentCents(
      input.principalCents,
      input.annualRateBps,
      input.termMonths,
      input.compounding,
    );
  }
  const interest = monthlyInterestCents(
    input.principalCents,
    input.annualRateBps,
    input.compounding,
  );
  if (input.amortization === 'INTEREST_ONLY') {
    if (interest <= 0) {
      throw new DomainError('Solo interés requiere una tasa mayor que cero');
    }
    return interest;
  }
  const principalPart =
    Math.trunc(input.principalCents / input.termMonths) +
    (input.principalCents % input.termMonths === 0 ? 0 : 1);
  return interest + principalPart;
}

export function scheduledPayCents(debt: Debt, remainingCents: Cents, paymentIndex: number): Cents {
  assertCents(remainingCents, 'saldo');
  const extra = extraInMonthCents(debt, paymentIndex);
  const scheduled =
    debt.amortization === 'INTEREST_ONLY'
      ? monthlyInterestCents(remainingCents, debt.annualRateBps, debt.compounding) + extra
      : debt.installmentCents + extra;
  const base = debt.amortization === 'SIMPLE' ? debt.originalCents : remainingCents;
  const interest = monthlyInterestCents(base, debt.annualRateBps, debt.compounding);
  return Math.min(scheduled, remainingCents + interest);
}

export function planDebtPayment(input: {
  debt: Debt;
  remainingCents: Cents;
  amountCents: Cents;
}): { interestCents: Cents; principalCents: Cents; remainingAfterCents: Cents; amountCents: Cents } {
  const split = splitDebtPayment({
    remainingCents: input.remainingCents,
    annualRateBps: input.debt.annualRateBps,
    compounding: input.debt.compounding,
    amortization: input.debt.amortization,
    originalCents: input.debt.originalCents,
    amountCents: input.amountCents,
  });
  return {
    ...split,
    amountCents: split.interestCents + split.principalCents,
    remainingAfterCents: input.remainingCents - split.principalCents,
  };
}

export function projectDebt(debt: Debt, remainingCents: Cents): AmortizationResult {
  if (remainingCents <= 0) {
    return {
      months: 0,
      totalPaidCents: 0,
      totalInterestCents: 0,
      totalPrincipalCents: 0,
      remainingCents: 0,
      paidOff: true,
    };
  }
  return simulateAmortization({
    principalCents: remainingCents,
    originalCents: debt.originalCents,
    annualRateBps: debt.annualRateBps,
    installmentCents: debt.installmentCents,
    termMonths: debt.termMonths,
    amortization: debt.amortization,
    compounding: debt.compounding,
    extraMonthlyCents: debt.extraMonthlyCents,
    extraFortnightCents: debt.extraFortnightCents,
    extraEveryNMonths: debt.extraEveryNMonths,
    extraEveryNAmountCents: debt.extraEveryNAmountCents,
    startedAt: debt.startedAt,
  });
}

export type DebtView = {
  debt: Debt;
  remainingCents: Cents;
  nextDueAt: string | null;
  nextAmountCents: Cents;
  nextInterestCents: Cents;
  nextPrincipalCents: Cents;
  projection: AmortizationResult;
};

export function debtViewsFromState(
  debts: Debt[],
  payments: DebtPayment[],
  transactions: TransactionRow[],
): DebtView[] {
  return debts.map((debt) => {
    const ofDebt = payments.filter((row) => row.debtId === debt.id);
    const remainingCents = remainingDebtCents(debt.originalCents, ofDebt, transactions);
    const paymentIndex = postedDebtPaymentCount(ofDebt, transactions);
    const nextDueAt = remainingCents > 0 ? nextDebtDueAt(debt.startedAt, paymentIndex) : null;
    let nextAmountCents = 0;
    let nextInterestCents = 0;
    let nextPrincipalCents = 0;
    if (remainingCents > 0) {
      const amountCents = scheduledPayCents(debt, remainingCents, paymentIndex);
      if (amountCents > 0) {
        const plan = planDebtPayment({ debt, remainingCents, amountCents });
        nextAmountCents = plan.amountCents;
        nextInterestCents = plan.interestCents;
        nextPrincipalCents = plan.principalCents;
      }
    }
    return {
      debt,
      remainingCents,
      nextDueAt,
      nextAmountCents,
      nextInterestCents,
      nextPrincipalCents,
      projection: projectDebt(debt, remainingCents),
    };
  });
}

/** Cuota próxima no reservada. El capital entero no entra: vivienda es stock. */
export function unreservedDebtInstallmentsCents(
  views: DebtView[],
  reservedByFund: Map<string, Cents>,
  budgetItems: BudgetItem[],
): Cents {
  const remaining = new Map(reservedByFund);
  const coveredByBudget = new Set(
    budgetItems
      .filter((item) => item.active && item.budgetScope === 'HOME' && item.coverFundId)
      .map((item) => item.coverFundId as string),
  );
  let total = 0;
  for (const view of views) {
    if (!view.debt.active || view.remainingCents <= 0 || view.nextAmountCents <= 0) continue;
    const fundId = view.debt.coverFundId;
    if (fundId && coveredByBudget.has(fundId)) continue;
    const reserved = fundId ? (remaining.get(fundId) ?? 0) : 0;
    const applied = Math.min(view.nextAmountCents, reserved);
    if (fundId) remaining.set(fundId, reserved - applied);
    total += view.nextAmountCents - applied;
  }
  return total;
}

export function assertDebt(row: Debt): Debt {
  const name = requireName(row.name, 'El nombre de la deuda');
  if (!KINDS.has(row.kind)) throw new DomainError('Tipo de deuda inválido');
  if (!AMORTIZATIONS.has(row.amortization)) {
    throw new DomainError('Amortización inválida');
  }
  if (!COMPOUNDINGS.has(row.compounding)) {
    throw new DomainError('Capitalización inválida');
  }
  assertCents(row.originalCents, 'capital');
  if (row.originalCents <= 0) throw new DomainError('El capital debe ser mayor que cero');
  assertBps(row.annualRateBps, 'tasa');
  if (!Number.isInteger(row.termMonths) || row.termMonths <= 0) {
    throw new DomainError('El plazo debe ser un entero de meses mayor que cero');
  }
  assertCents(row.installmentCents, 'cuota');
  if (row.installmentCents <= 0) throw new DomainError('La cuota debe ser mayor que cero');
  assertCents(row.extraMonthlyCents, 'extra mensual');
  assertCents(row.extraFortnightCents, 'extra quincenal');
  assertCents(row.extraEveryNAmountCents, 'extra cada N meses');
  if (row.extraMonthlyCents < 0 || row.extraFortnightCents < 0 || row.extraEveryNAmountCents < 0) {
    throw new DomainError('Los extras no pueden ser negativos');
  }
  if (row.extraEveryNMonths != null) {
    if (!Number.isInteger(row.extraEveryNMonths) || row.extraEveryNMonths <= 0) {
      throw new DomainError('Cada N meses debe ser un entero positivo');
    }
  }
  const started = new Date(row.startedAt);
  if (Number.isNaN(started.getTime())) {
    throw new DomainError('La fecha de inicio no es válida');
  }
  return {
    id: requireName(row.id, 'El id de la deuda'),
    name,
    kind: row.kind,
    originalCents: row.originalCents,
    annualRateBps: row.annualRateBps,
    termMonths: row.termMonths,
    installmentCents: row.installmentCents,
    startedAt: started.toISOString(),
    paymentAccountId: row.paymentAccountId?.trim() ? row.paymentAccountId : null,
    coverFundId: row.coverFundId?.trim() ? row.coverFundId : null,
    amortization: row.amortization,
    compounding: row.compounding,
    extraMonthlyCents: row.extraMonthlyCents,
    extraFortnightCents: row.extraFortnightCents,
    extraEveryNMonths: row.extraEveryNMonths,
    extraEveryNAmountCents: row.extraEveryNAmountCents,
    note: row.note.trim(),
    active: Boolean(row.active),
  };
}

export async function saveDebt(tx: LedgerTx, input: Debt, isNew: boolean): Promise<Debt> {
  const installmentCents =
    input.installmentCents > 0
      ? input.installmentCents
      : suggestedInstallmentCents({
          principalCents: input.originalCents,
          annualRateBps: input.annualRateBps,
          termMonths: input.termMonths,
          amortization: input.amortization,
          compounding: input.compounding,
        });
  const row = assertDebt({ ...input, installmentCents });

  if (row.paymentAccountId) {
    const account = await tx.getAccount(row.paymentAccountId);
    if (!account) throw new DomainError('Cuenta de pago no encontrada');
    if (account.visibility === 'PRIVATE') {
      throw new DomainError('La cuenta de pago no puede ser privada');
    }
  }
  if (row.coverFundId) {
    const fund = await tx.getFund(row.coverFundId);
    if (!fund) throw new DomainError('Fondo de cobertura no encontrado');
  }

  const existing = await tx.getDebt(row.id);
  if (isNew) {
    if (existing) throw new DomainError('Ya existe una deuda con ese id');
    await tx.insertDebt(row);
    return row;
  }
  if (!existing) throw new DomainError('Deuda no encontrada');
  const payments = await tx.listDebtPaymentsByDebt(row.id);
  const transactions = await tx.listTransactions();
  const paid = postedPrincipalPaidCents(existing.originalCents, payments, transactions);
  if (paid > 0 && row.originalCents !== existing.originalCents) {
    throw new DomainError('No se cambia el capital original si ya hay pagos');
  }
  await tx.updateDebt(row);
  return row;
}

export async function removeDebt(
  tx: LedgerTx,
  debtId: string,
): Promise<{ outcome: 'deleted' } | { outcome: 'deactivated' }> {
  const debt = await tx.getDebt(debtId);
  if (!debt) throw new DomainError('Deuda no encontrada');
  const payments = await tx.listDebtPaymentsByDebt(debtId);
  if (payments.length > 0) {
    if (debt.active) {
      await tx.updateDebt({ ...debt, active: false });
      return { outcome: 'deactivated' };
    }
    throw new DomainError(
      `No se puede quitar ${debt.name}: hay pagos en el historial. Queda inactiva. El libro no se borra.`,
    );
  }
  await tx.deleteDebt(debtId);
  return { outcome: 'deleted' };
}
