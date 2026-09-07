import {
  BASE_EXTRA_MONTHLY_CENTS,
  DEFAULT_SEASONAL_A_CENTS,
  DEFAULT_SEASONAL_MONTHS,
  DEFAULT_SEASONAL_Z_CENTS,
  OPTIONAL_EXTRA_MONTHLY_CENTS,
  simulateAmortization,
  type AmortizationInput,
  type AmortizationResult,
} from './amortization';
import { DomainError } from './ledger';
import { assertCents, type Cents } from './money';

export const AMORTIZATION_PLAN_META_KEY = 'amortization_plans';

export type SeasonalExtras = {
  zCents: Cents;
  aCents: Cents;
  months: number[];
};

export type DebtPlanState = {
  extraMonthlyListCents: Cents[];
  includeSeasonal: boolean;
  checkedMonthIndices: number[];
  currentMonthIndex: number;
};

export type AmortizationPlansState = {
  seasonal: SeasonalExtras;
  byDebt: Record<string, DebtPlanState>;
};

export const DEFAULT_SEASONAL: SeasonalExtras = {
  zCents: DEFAULT_SEASONAL_Z_CENTS,
  aCents: DEFAULT_SEASONAL_A_CENTS,
  months: [...DEFAULT_SEASONAL_MONTHS],
};

export function defaultDebtPlanState(): DebtPlanState {
  return {
    extraMonthlyListCents: [...BASE_EXTRA_MONTHLY_CENTS],
    includeSeasonal: true,
    checkedMonthIndices: [],
    currentMonthIndex: 0,
  };
}

export function seasonalTotalCents(seasonal: SeasonalExtras): Cents {
  assertCents(seasonal.zCents, 'abono Z');
  assertCents(seasonal.aCents, 'abono A');
  return seasonal.zCents + seasonal.aCents;
}

function asCents(value: unknown, label: string): Cents {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new DomainError(`${label} debe ser un entero en centavos ≥ 0`);
  }
  return value;
}

export function parseAmortizationPlans(raw: string | undefined | null): AmortizationPlansState {
  const fallback: AmortizationPlansState = { seasonal: { ...DEFAULT_SEASONAL, months: [...DEFAULT_SEASONAL.months] }, byDebt: {} };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<AmortizationPlansState>;
    if (!parsed || typeof parsed !== 'object') return fallback;
    const seasonalRaw = parsed.seasonal;
    const months = Array.isArray(seasonalRaw?.months)
      ? seasonalRaw.months.filter((m): m is number => Number.isInteger(m) && m >= 0 && m <= 11)
      : [...DEFAULT_SEASONAL_MONTHS];
    const seasonal: SeasonalExtras = {
      zCents: typeof seasonalRaw?.zCents === 'number' && Number.isInteger(seasonalRaw.zCents)
        ? Math.max(0, seasonalRaw.zCents)
        : DEFAULT_SEASONAL_Z_CENTS,
      aCents: typeof seasonalRaw?.aCents === 'number' && Number.isInteger(seasonalRaw.aCents)
        ? Math.max(0, seasonalRaw.aCents)
        : DEFAULT_SEASONAL_A_CENTS,
      months: months.length > 0 ? months : [...DEFAULT_SEASONAL_MONTHS],
    };
    const byDebt: Record<string, DebtPlanState> = {};
    if (parsed.byDebt && typeof parsed.byDebt === 'object') {
      for (const [id, row] of Object.entries(parsed.byDebt)) {
        if (!id || !row || typeof row !== 'object') continue;
        const extras = Array.isArray(row.extraMonthlyListCents)
          ? row.extraMonthlyListCents.filter((c): c is number => Number.isInteger(c) && c >= 0)
          : [...BASE_EXTRA_MONTHLY_CENTS];
        const checked = Array.isArray(row.checkedMonthIndices)
          ? row.checkedMonthIndices.filter((m): m is number => Number.isInteger(m) && m >= 0)
          : [];
        byDebt[id] = {
          extraMonthlyListCents: extras.length > 0 ? extras : [...BASE_EXTRA_MONTHLY_CENTS],
          includeSeasonal: row.includeSeasonal !== false,
          checkedMonthIndices: [...new Set(checked)].sort((a, b) => a - b),
          currentMonthIndex: Number.isInteger(row.currentMonthIndex) && row.currentMonthIndex >= 0
            ? row.currentMonthIndex
            : 0,
        };
      }
    }
    return { seasonal, byDebt };
  } catch {
    return fallback;
  }
}

export function serializeAmortizationPlans(state: AmortizationPlansState): string {
  return JSON.stringify(state);
}

export function addExtraScenario(list: Cents[], extraMonthlyCents: Cents): Cents[] {
  const cents = asCents(extraMonthlyCents, 'abono extra');
  if (list.includes(cents)) return list;
  return [...list, cents].sort((a, b) => a - b);
}

export function ensureOptionalExtra200(list: Cents[]): Cents[] {
  return addExtraScenario(list, OPTIONAL_EXTRA_MONTHLY_CENTS);
}

export type ScenarioProjection = {
  extraMonthlyCents: Cents;
  label: string;
  result: AmortizationResult;
};

export function extraScenarioLabel(extraMonthlyCents: Cents): string {
  if (extraMonthlyCents === 0) return 'Normal';
  return `Extra $${Math.trunc(extraMonthlyCents / 100)}`;
}

export function projectExtraScenarios(
  base: Omit<AmortizationInput, 'extraMonthlyCents'>,
  extraMonthlyListCents: Cents[],
): ScenarioProjection[] {
  return extraMonthlyListCents.map((extraMonthlyCents) => ({
    extraMonthlyCents,
    label: extraScenarioLabel(extraMonthlyCents),
    result: simulateAmortization({ ...base, extraMonthlyCents }),
  }));
}
