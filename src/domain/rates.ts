import { DomainError } from './ledger';

/** Tasa anual en basis points. 550 = 5.50%. Entero; no es dinero. */
export type Bps = number;

export function assertBps(value: number, label = 'tasa'): Bps {
  if (!Number.isInteger(value)) {
    throw new DomainError(`${label} debe ser un entero en basis points (2 decimales de %)`);
  }
  if (value < 0 || value > 10000) {
    throw new DomainError(`${label} debe estar entre 0% y 100%`);
  }
  return value;
}

export function parsePercentToBps(input: string): Bps {
  const trimmed = input.trim().replace(/%/g, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new DomainError('Tasa inválida. Usa porcentaje con hasta 2 decimales, por ejemplo 5.50');
  }
  const [whole, frac = ''] = trimmed.split('.');
  return assertBps(Number.parseInt(whole, 10) * 100 + Number.parseInt((frac + '00').slice(0, 2), 10));
}

export function bpsToInput(bps: Bps): string {
  assertBps(bps);
  return `${Math.trunc(bps / 100)}.${(bps % 100).toString().padStart(2, '0')}`;
}

export function formatBps(bps: Bps): string {
  return `${bpsToInput(bps)}%`;
}

/** Interés de un período: trunc(principal * bps / (periodosAño * 10000)). */
export function periodInterestCents(
  principalCents: number,
  annualRateBps: Bps,
  periodsPerYear: number,
): number {
  if (!Number.isInteger(principalCents) || principalCents < 0) {
    throw new DomainError('El capital debe ser un entero en centavos, ≥ 0');
  }
  assertBps(annualRateBps);
  if (!Number.isInteger(periodsPerYear) || periodsPerYear <= 0) {
    throw new DomainError('Los períodos por año deben ser un entero positivo');
  }
  if (principalCents === 0 || annualRateBps === 0) return 0;
  return Math.trunc((principalCents * annualRateBps) / (periodsPerYear * 10000));
}
