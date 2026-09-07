import { describe, expect, it } from 'vitest';
import { DomainError } from './ledger';
import { projectSavingsBalance, projectableSavingsAccounts, assertProjectableSavingsAccount } from './savingsProjection';

describe('proyección de ahorro', () => {
  it('aporte e interés quedan en centavos enteros', () => {
    const result = projectSavingsBalance({
      principalCents: 10_000,
      monthlyContributionCents: 5_000,
      annualRateBps: 0,
      kind: 'NONE',
      months: 12,
    });
    expect(result.contributionsCents).toBe(60_000);
    expect(result.interestCents).toBe(0);
    expect(result.endingCents).toBe(70_000);
    expect(Number.isInteger(result.endingCents)).toBe(true);
  });

  it('compuesto mensual acumula interés entero sobre saldo + aporte', () => {
    const none = projectSavingsBalance({
      principalCents: 100_000,
      monthlyContributionCents: 10_000,
      annualRateBps: 600,
      kind: 'NONE',
      months: 6,
    });
    const compound = projectSavingsBalance({
      principalCents: 100_000,
      monthlyContributionCents: 10_000,
      annualRateBps: 600,
      kind: 'COMPOUND_MONTHLY',
      months: 6,
    });
    expect(compound.endingCents).toBeGreaterThan(none.endingCents);
    expect(Number.isInteger(compound.interestCents)).toBe(true);
    expect(() =>
      projectSavingsBalance({
        principalCents: 100.5,
        monthlyContributionCents: 0,
        annualRateBps: 0,
        kind: 'NONE',
        months: 1,
      }),
    ).toThrow(/entero en centavos/);
  });

  it('no proyecta Atlántida; sí Ahorros y Ahorros 2 si el usuario las elige', () => {
    const accounts = [
      { id: 'acc-ahorro', name: 'Ahorros', isCardPaymentSource: false, visibility: 'PUBLIC' as const },
      { id: 'acc-ahorros-2', name: 'Ahorros 2', isCardPaymentSource: false, visibility: 'PUBLIC' as const },
      { id: 'acc-atlantida', name: 'Atlántida', isCardPaymentSource: true, visibility: 'PUBLIC' as const },
      { id: 'acc-barras', name: 'Barras', isCardPaymentSource: false, visibility: 'PUBLIC' as const },
    ];
    expect(projectableSavingsAccounts(accounts).map((row) => row.id)).toEqual(['acc-ahorro', 'acc-ahorros-2']);
    expect(() => assertProjectableSavingsAccount(accounts[2]!)).toThrow(DomainError);
    expect(() => assertProjectableSavingsAccount(accounts[3]!)).toThrow(DomainError);
  });
});
