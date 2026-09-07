import { DomainError } from './ledger';
import { assertCents, type Cents } from './money';
import { assertBps, periodInterestCents, type Bps } from './rates';
import type { DebtAmortization, DebtCompounding } from './types';

export const DEFAULT_SEASONAL_MONTHS = [0, 6, 11] as const;
export const DEFAULT_SEASONAL_Z_CENTS = 20_000;
export const DEFAULT_SEASONAL_A_CENTS = 30_000;
/** Tres escenarios base: sin extra, $50, $100. $200 se puede agregar. */
export const BASE_EXTRA_MONTHLY_CENTS: readonly Cents[] = [0, 5_000, 10_000];
export const OPTIONAL_EXTRA_MONTHLY_CENTS: Cents = 20_000;

export interface AmortizationInput {
  principalCents: Cents;
  /** Base del interés SIMPLE. Por defecto el capital de esta simulación. */
  originalCents?: Cents;
  annualRateBps: Bps;
  installmentCents: Cents;
  termMonths: number;
  amortization: DebtAmortization;
  compounding: DebtCompounding;
  extraMonthlyCents?: Cents;
  extraFortnightCents?: Cents;
  extraEveryNMonths?: number | null;
  extraEveryNAmountCents?: Cents;
  /** ISO; sirve para abonos de enero/julio/diciembre. */
  startedAt?: string;
  /** Meses UTC 0–11. Por defecto ene, jul, dic. */
  seasonalMonths?: readonly number[];
  seasonalExtraCents?: Cents;
}

export interface AmortizationResult {
  months: number;
  totalPaidCents: Cents;
  totalInterestCents: Cents;
  totalPrincipalCents: Cents;
  remainingCents: Cents;
  paidOff: boolean;
}

export interface AmortizationRow {
  monthIndex: number;
  occurredAt: string;
  calendarMonth: number;
  interestCents: Cents;
  principalCents: Cents;
  extraCents: Cents;
  paidCents: Cents;
  remainingCents: Cents;
}

export function monthlyInterestCents(
  principalCents: Cents,
  annualRateBps: Bps,
  compounding: DebtCompounding = 'MONTHLY',
): Cents {
  assertCents(principalCents, 'capital');
  if (compounding === 'FORTNIGHTLY') {
    const fortnight = periodInterestCents(principalCents, annualRateBps, 24);
    return fortnight + periodInterestCents(principalCents + fortnight, annualRateBps, 24);
  }
  if (compounding === 'ANNUAL') {
    return 0;
  }
  return periodInterestCents(principalCents, annualRateBps, 12);
}

export function utcMonthAfter(startedAt: string | undefined, monthIndex: number): {
  occurredAt: string;
  calendarMonth: number;
} {
  const base = startedAt ? new Date(startedAt) : new Date(Date.UTC(2026, 0, 1));
  if (Number.isNaN(base.getTime())) {
    throw new DomainError('La fecha de inicio de la deuda no es válida');
  }
  const date = new Date(base.getTime());
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + monthIndex);
  return { occurredAt: date.toISOString(), calendarMonth: date.getUTCMonth() };
}

export function extraInMonthCents(
  input: Pick<
    AmortizationInput,
    | 'extraMonthlyCents'
    | 'extraFortnightCents'
    | 'extraEveryNMonths'
    | 'extraEveryNAmountCents'
    | 'startedAt'
    | 'seasonalMonths'
    | 'seasonalExtraCents'
  >,
  monthIndex: number,
): Cents {
  const monthly = input.extraMonthlyCents ?? 0;
  const fortnight = (input.extraFortnightCents ?? 0) * 2;
  const n = input.extraEveryNMonths ?? 0;
  const every =
    n > 0 && (monthIndex + 1) % n === 0 ? (input.extraEveryNAmountCents ?? 0) : 0;
  const seasonalAmount = input.seasonalExtraCents ?? 0;
  const months = input.seasonalMonths ?? DEFAULT_SEASONAL_MONTHS;
  const { calendarMonth } = utcMonthAfter(input.startedAt, monthIndex);
  const seasonal =
    seasonalAmount > 0 && months.includes(calendarMonth) ? seasonalAmount : 0;
  return monthly + fortnight + every + seasonal;
}

export function frenchInstallmentCents(
  principalCents: Cents,
  annualRateBps: Bps,
  termMonths: number,
  compounding: DebtCompounding = 'MONTHLY',
): Cents {
  assertCents(principalCents, 'capital');
  assertBps(annualRateBps);
  if (!Number.isInteger(termMonths) || termMonths <= 0) {
    throw new DomainError('El plazo debe ser un entero de meses mayor que cero');
  }
  if (principalCents === 0) return 0;
  if (annualRateBps === 0) {
    return Math.trunc(principalCents / termMonths) + (principalCents % termMonths === 0 ? 0 : 1);
  }
  let lo = monthlyInterestCents(principalCents, annualRateBps, compounding) + 1;
  let hi = principalCents;
  while (lo < hi) {
    const mid = Math.trunc((lo + hi) / 2);
    const result = simulateAmortization({
      principalCents,
      annualRateBps,
      installmentCents: mid,
      termMonths,
      amortization: 'FRENCH',
      compounding,
    });
    if (result.paidOff && result.months <= termMonths) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  return lo;
}

export function simulateAmortizationSchedule(input: AmortizationInput): AmortizationRow[] {
  assertCents(input.principalCents, 'capital');
  assertCents(input.installmentCents, 'cuota');
  assertBps(input.annualRateBps);
  if (!Number.isInteger(input.termMonths) || input.termMonths <= 0) {
    throw new DomainError('El plazo debe ser un entero de meses mayor que cero');
  }
  if (input.principalCents === 0) return [];
  if (input.installmentCents <= 0 && input.amortization !== 'INTEREST_ONLY') {
    throw new DomainError('La cuota debe ser mayor que cero');
  }

  let remaining = input.principalCents;
  const rows: AmortizationRow[] = [];
  const maxMonths = Math.max(input.termMonths * 3, input.termMonths);
  const original = input.originalCents ?? input.principalCents;
  assertCents(original, 'capital original');
  let annualBucket = 0;

  while (remaining > 0 && rows.length < maxMonths) {
    const monthIndex = rows.length;
    let interest: Cents;
    if (input.amortization === 'SIMPLE') {
      interest = monthlyInterestCents(original, input.annualRateBps, input.compounding);
    } else if (input.compounding === 'ANNUAL') {
      annualBucket += 1;
      interest = annualBucket % 12 === 0
        ? periodInterestCents(remaining, input.annualRateBps, 1)
        : 0;
    } else {
      interest = monthlyInterestCents(remaining, input.annualRateBps, input.compounding);
    }

    const extra = extraInMonthCents(input, monthIndex);
    let pay = input.installmentCents + extra;
    if (input.amortization === 'INTEREST_ONLY') {
      pay = interest + extra;
    }
    if (pay <= interest && remaining > 0 && extra === 0 && input.amortization !== 'INTEREST_ONLY') {
      break;
    }
    const towardPrincipal = Math.min(Math.max(0, pay - interest), remaining);
    const interestPaid = Math.min(interest, pay);
    const actualPay = towardPrincipal + interestPaid;
    remaining -= towardPrincipal;
    const { occurredAt, calendarMonth } = utcMonthAfter(input.startedAt, monthIndex);
    rows.push({
      monthIndex,
      occurredAt,
      calendarMonth,
      interestCents: interestPaid,
      principalCents: towardPrincipal,
      extraCents: extra,
      paidCents: actualPay,
      remainingCents: remaining,
    });
    if (remaining <= 0) {
      remaining = 0;
      break;
    }
  }

  return rows;
}

export function simulateAmortization(input: AmortizationInput): AmortizationResult {
  const rows = simulateAmortizationSchedule(input);
  const last = rows[rows.length - 1];
  const totalPaidCents = rows.reduce((sum, row) => sum + row.paidCents, 0);
  const totalInterestCents = rows.reduce((sum, row) => sum + row.interestCents, 0);
  const totalPrincipalCents = rows.reduce((sum, row) => sum + row.principalCents, 0);
  const remainingCents = last?.remainingCents ?? input.principalCents;
  return {
    months: rows.length,
    totalPaidCents,
    totalInterestCents,
    totalPrincipalCents,
    remainingCents,
    paidOff: remainingCents === 0 && (input.principalCents === 0 || rows.length > 0),
  };
}

export function plannedRemainingAfterMonth(
  rows: AmortizationRow[],
  originalRemainingCents: Cents,
  lastCheckedMonthIndex: number | null,
): Cents {
  assertCents(originalRemainingCents, 'saldo');
  if (lastCheckedMonthIndex == null || lastCheckedMonthIndex < 0) return originalRemainingCents;
  const row = rows.find((item) => item.monthIndex === lastCheckedMonthIndex);
  return row ? row.remainingCents : originalRemainingCents;
}

export function splitDebtPayment(input: {
  remainingCents: Cents;
  annualRateBps: Bps;
  compounding: DebtCompounding;
  amortization: DebtAmortization;
  originalCents: Cents;
  amountCents: Cents;
}): { interestCents: Cents; principalCents: Cents } {
  assertCents(input.remainingCents, 'saldo');
  assertCents(input.amountCents, 'pago');
  if (input.amountCents <= 0) throw new DomainError('El pago debe ser mayor que cero');
  if (input.remainingCents <= 0) throw new DomainError('La deuda ya está saldada');
  const base =
    input.amortization === 'SIMPLE' ? input.originalCents : input.remainingCents;
  const interestCents = Math.min(
    monthlyInterestCents(base, input.annualRateBps, input.compounding),
    input.amountCents,
  );
  const principalCents = Math.min(input.amountCents - interestCents, input.remainingCents);
  if (principalCents + interestCents < input.amountCents) {
    throw new DomainError('El pago supera el saldo más el interés del período');
  }
  return { interestCents, principalCents };
}

export function compareAmortization(base: AmortizationInput, withExtras: AmortizationInput) {
  const normal = simulateAmortization({ ...base, extraMonthlyCents: 0, extraFortnightCents: 0, extraEveryNMonths: null });
  const extra = simulateAmortization(withExtras);
  return {
    normal,
    extra,
    monthsSaved: normal.paidOff && extra.paidOff ? Math.max(0, normal.months - extra.months) : 0,
    interestSavedCents: Math.max(0, normal.totalInterestCents - extra.totalInterestCents),
  };
}
