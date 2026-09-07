import type { Cents } from './money';

export type PersonCode = 'Z' | 'A';
export type AccountKind = 'BANK' | 'CASH' | 'FUND_HOLDER' | 'CREDIT';
export type CardChargeClass = 'SHARED_BUDGETED' | 'SHARED_UNBUDGETED' | 'PERSONAL_Z' | 'PERSONAL_A';
export type CoverageStatus = 'SIN_COBERTURA' | 'CUBIERTO_PENDIENTE_TRASPASO' | 'TRANSFERIDO_A_ATLANTIDA';
export type AccountVisibility = 'PUBLIC' | 'PRIVATE';
export type TransactionType =
  | 'INGRESO'
  | 'GASTO'
  | 'TRANSFERENCIA'
  | 'APORTE'
  | 'RESERVA'
  | 'LIBERACION_RESERVA'
  | 'AJUSTE'
  | 'PAGO_DEUDA';
export type TransactionStatus = 'POSTED' | 'VOID';
export type SplitRole = 'SOURCE' | 'DESTINATION' | 'RESERVE' | 'EQUITY';
export type ReservationStatus = 'ACTIVE' | 'RELEASED' | 'CONSUMED';
export type BudgetScope = 'Z' | 'A' | 'HOME';
export type Frequency = 'QUINCENAL' | 'MENSUAL' | 'BIMESTRAL' | 'TRIMESTRAL' | 'ANUAL' | 'UNICO';
export type Fortnight = 'Q1' | 'Q2' | 'BOTH' | 'NONE';
export type PaymentMedium = 'CARD' | 'TRANSFER' | 'CASH';
export type BudgetCoverMode = 'PAY_NOW' | 'RESERVE_ONLY' | 'AUTO';
export type Period = 'Q1' | 'Q2';

/** Quincena de un mes UTC. `month` es 0–11, igual que `Date.getUTCMonth()`. */
export type PeriodRef = {
  year: number;
  month: number;
  period: Period;
};
export type FundSegment = 'OPERATING' | 'SAVINGS';
/** Ancla recurrente de pago del fondo: día 1, 14 o último día del mes (28/30/31). */
export type FundDueAnchor = 'MONTH_START' | 'MONTH_MID' | 'MONTH_END';
export type InterestKind =
  | 'NONE'
  | 'SIMPLE'
  | 'COMPOUND_MONTHLY'
  | 'COMPOUND_FORTNIGHTLY'
  | 'COMPOUND_ANNUAL';
export type DebtKind = 'MORTGAGE' | 'PERSONAL' | 'VEHICLE' | 'OTHER';
export type DebtAmortization = 'FRENCH' | 'INTEREST_ONLY' | 'SIMPLE';
export type DebtCompounding = 'MONTHLY' | 'FORTNIGHTLY' | 'ANNUAL';
export type DebtStatus = 'ACTIVE' | 'PAID';

export interface Person {
  id: string;
  code: PersonCode;
  displayName: string;
}

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  visibility: AccountVisibility;
  ownerPersonId: string | null;
  countsAsLiquidity: boolean;
  isCardPaymentSource: boolean;
}

export interface CreditCard {
  id: string;
  name: string;
  paymentAccountId: string;
  coverFundId: string | null;
  /** Tope de esta tarjeta. Null = usa toda la línea (o, sin línea, sin tope). */
  creditLimitCents: Cents | null;
  creditLineId?: string | null;
  creditLineLimitCents?: Cents | null;
  personId: string | null;
}

export interface CardCharge {
  id: string;
  cardId: string;
  transactionId: string;
  amountCents: Cents;
  chargeClass: CardChargeClass;
  coverageStatus: CoverageStatus;
  coverFundId: string | null;
}

export interface Fund {
  id: string;
  accountId: string;
  name: string;
  purpose: string;
  targetAmountCents: Cents | null;
  priority: number | null;
  segment: FundSegment;
  interestKind?: InterestKind;
  annualRateBps?: number | null;
  /** Ancla de pago (1 / 14 / fin de mes). Los OPERATING no priorizan en Inicio aunque la tengan. */
  dueAnchor?: FundDueAnchor | null;
}

export interface Debt {
  id: string;
  name: string;
  kind: DebtKind;
  originalCents: Cents;
  annualRateBps: number;
  termMonths: number;
  installmentCents: Cents;
  startedAt: string;
  paymentAccountId: string | null;
  coverFundId: string | null;
  amortization: DebtAmortization;
  compounding: DebtCompounding;
  extraMonthlyCents: Cents;
  extraFortnightCents: Cents;
  extraEveryNMonths: number | null;
  extraEveryNAmountCents: Cents;
  note: string;
  active: boolean;
}

export interface DebtPayment {
  id: string;
  debtId: string;
  transactionId: string;
  principalCents: Cents;
  interestCents: Cents;
  occurredAt: string;
}

export interface TransactionRow {
  id: string;
  type: TransactionType;
  occurredAt: string;
  period: Period | null;
  note: string;
  createdAt: string;
  status: TransactionStatus;
  reversesId: string | null;
}

export interface SplitRow {
  id: string;
  transactionId: string;
  accountId: string | null;
  fundId: string | null;
  personId: string | null;
  cardId: string | null;
  amountCents: Cents;
  role: SplitRole;
}

export interface Reservation {
  id: string;
  fundId: string;
  sourceTransactionId: string;
  amountCents: Cents;
  status: ReservationStatus;
}

export interface BudgetItem {
  id: string;
  budgetScope: BudgetScope;
  name: string;
  category: string;
  frequency: Frequency;
  amountCents: Cents;
  /** Parte de Z, en centavos. En HOME: zShareCents + aShareCents = amountCents. */
  zShareCents: Cents;
  /** Parte de A, en centavos. En HOME: zShareCents + aShareCents = amountCents. */
  aShareCents: Cents;
  fortnight: Fortnight;
  coverFundId: string | null;
  usualMedium: PaymentMedium;
  active: boolean;
}

/** Alta/edición: las shares pueden omitirse y se completan según alcance y nombre. */
export type BudgetItemDraft = Omit<BudgetItem, 'zShareCents' | 'aShareCents'> & {
  zShareCents?: Cents;
  aShareCents?: Cents;
};

export interface AccountBalance {
  account: Account;
  saldoCents: Cents;
  reservedCents: Cents;
  disponibleCents: Cents;
  disponibleUiCents: Cents;
}

export interface FundBalance {
  fund: Fund;
  reservedCents: Cents;
}

export interface CardBalance {
  card: CreditCard;
  saldoCents: Cents;
  cubiertoCents: Cents;
  sinCubrirCents: Cents;
  limiteCents: Cents | null;
  coberturaDisponibleCents: Cents;
  /** Disponible de esta tarjeta sobre la línea, no la suma de topes. */
  disponibleTarjetaCents: Cents | null;
  lineSpentCents: Cents;
  lineAvailableCents: Cents | null;
}

export interface SafeAvailable {
  tengoCents: Cents;
  apartadoCents: Cents;
  deboCents: Cents;
  obligacionesNoReservadasCents: Cents;
  disponibleSeguroCents: Cents;
  disponibleSeguroUiCents: Cents;
  disponibleSeguroRawCents: Cents;
  /** Slot 2: `max(0, linea − gastadoTotal)` de ONE. No sumar el tope de $100. */
  limitedCardRemainingCents: Cents;
  limitedCardId: string | null;
  creditLineRemainingCents: Cents;
  creditLineId: string | null;
  /** Slot 2: `max(0, saldo − apartado)` de la cuenta Atlántida (fondos para pagar). */
  paymentAccountDisponibleCents: Cents;
  paymentAccountId: string | null;
  /** Slot 3: otra tarjeta con límite. 0 si el slot está vacío. */
  extraLimitedRemainingCents: Cents;
  extraLimitedCardId: string | null;
  /** Hero de Inicio: `max(0, saldo − apartado)` de Barras. No mezcla ONE ni Ahorros. */
  barrasDisponibleUiCents: Cents;
  barrasAccountId: string | null;
}
