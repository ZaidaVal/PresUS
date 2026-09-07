/** Integer cents. Never use float for money. */
export type Cents = number;

export function assertCents(value: number, label = 'monto'): Cents {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} debe ser un entero en centavos`);
  }
  return value;
}

export function formatUsd(cents: Cents): string {
  assertCents(cents);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const frac = abs % 100;
  return `${sign}$${dollars.toLocaleString('en-US')}.${frac.toString().padStart(2, '0')}`;
}

export function centsToInput(cents: Cents): string {
  assertCents(cents);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${(abs % 100).toString().padStart(2, '0')}`;
}

export function parseUsdToCents(input: string): Cents {
  const trimmed = input.trim().replace(/\$/g, '').replace(/,/g, '');
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new Error('Monto inválido. Usa dólares con hasta 2 decimales.');
  }
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, frac = ''] = unsigned.split('.');
  const cents = Number.parseInt(whole, 10) * 100 + Number.parseInt((frac + '00').slice(0, 2), 10);
  return negative ? -cents : cents;
}
