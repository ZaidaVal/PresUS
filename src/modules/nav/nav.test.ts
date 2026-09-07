import { describe, expect, it } from 'vitest';
import {
  HOME_SCREEN,
  bottomTabFor,
  dashboardPanelOf,
  hacerActionActive,
  hacerChipActive,
  hardwareBackTarget,
  settingsTabOf,
} from './nav';

describe('nav chrome', () => {
  it('marca Inicio en lectura de saldos', () => {
    expect(bottomTabFor({ name: 'dashboard' })).toBe('home');
    expect(bottomTabFor({ name: 'account', id: 'acc-1' })).toBe('home');
    expect(bottomTabFor({ name: 'savings' })).toBe('home');
    expect(bottomTabFor({ name: 'projects' })).toBe('home');
    expect(bottomTabFor({ name: 'debt-plan' })).toBe('home');
  });

  it('marca Movimientos en historial y ficha, no en un alta de Hacer', () => {
    expect(bottomTabFor({ name: 'movements' })).toBe('movements');
    expect(bottomTabFor({ name: 'movements', list: 'gastos' })).toBe('movements');
    expect(bottomTabFor({ name: 'movements', list: 'todos' })).toBe('movements');
    expect(bottomTabFor({ name: 'move', id: 'tx-1' })).toBe('movements');
    expect(bottomTabFor({ name: 'move', intent: 'GASTO' })).toBeNull();
  });

  it('marca Ajustes en catálogo y Drive', () => {
    expect(bottomTabFor({ name: 'settings', tab: 'drive' })).toBe('settings');
    expect(bottomTabFor({ name: 'account-edit' })).toBe('settings');
    expect(bottomTabFor({ name: 'card-edit' })).toBe('settings');
  });

  it('no marca barra en corte ni partidas', () => {
    expect(bottomTabFor({ name: 'budget-balance' })).toBeNull();
    expect(bottomTabFor({ name: 'budgets' })).toBeNull();
  });

  it('el atrás de chrome y hardware van a Inicio, no al historial', () => {
    expect(HOME_SCREEN).toEqual({ name: 'dashboard' });
    expect(hardwareBackTarget({ name: 'movements' })).toEqual({ name: 'dashboard' });
    expect(hardwareBackTarget({ name: 'move', id: 'tx-1' })).toEqual({ name: 'dashboard' });
    expect(hardwareBackTarget({ name: 'account', id: 'acc-1' })).toEqual({ name: 'dashboard' });
    expect(hardwareBackTarget({ name: 'settings', tab: 'catalogos' })).toEqual({ name: 'dashboard' });
    expect(hardwareBackTarget({ name: 'dashboard' })).toBeNull();
  });

  it('resuelve paneles de Inicio y tabs de Ajustes', () => {
    expect(dashboardPanelOf({ name: 'dashboard' })).toBe('hoy');
    expect(dashboardPanelOf({ name: 'dashboard', panel: 'puedo-usar' })).toBe('puedo-usar');
    expect(dashboardPanelOf({ name: 'monthly-spend' })).toBe('este-mes');
    expect(settingsTabOf({ name: 'settings' })).toBe('catalogos');
    expect(settingsTabOf({ name: 'settings', tab: 'acceso' })).toBe('acceso');
    expect(settingsTabOf({ name: 'settings', tab: 'control' })).toBe('control');
  });

  it('enciende el chip de Hacer según la intención', () => {
    expect(hacerChipActive({ name: 'move', intent: 'CARGO_TARJETA' }, 'gastar')).toBe(true);
    expect(hacerChipActive({ name: 'move', intent: 'GASTAR' }, 'gastar')).toBe(true);
    expect(hacerChipActive({ name: 'move', intent: 'APORTE' }, 'mover')).toBe(false);
    expect(hacerChipActive({ name: 'move', intent: 'TRANSFERENCIA' }, 'mover')).toBe(true);
    expect(hacerChipActive({ name: 'move', intent: 'FONDOS' }, 'presupuesto')).toBe(true);
    expect(hacerChipActive({ name: 'budget-balance' }, 'presupuesto')).toBe(true);
    expect(hacerChipActive({ name: 'move', intent: 'PAGO_TARJETA' }, 'tarjeta')).toBe(true);
    expect(hacerChipActive({ name: 'account', id: 'x', focus: 'cuadre' }, 'tarjeta')).toBe(true);
    expect(hacerChipActive({ name: 'move', id: 'tx-1', intent: 'GASTO' }, 'gastar')).toBe(false);
  });

  it('resalta acciones directas de Hacer', () => {
    expect(
      hacerActionActive({ name: 'move', intent: 'GASTO_X' }, {
        id: 'gastar',
        label: 'Gastar',
        hint: 'gasto',
        screen: { name: 'move', intent: 'GASTAR' },
      }),
    ).toBe(true);
    expect(
      hacerActionActive({ name: 'move', intent: 'TRANSFERENCIA' }, {
        id: 'gastar',
        label: 'Gastar',
        hint: 'gasto',
        screen: { name: 'move', intent: 'GASTAR' },
      }),
    ).toBe(false);
    expect(
      hacerActionActive({ name: 'move', intent: 'FONDOS' }, {
        id: 'fondos',
        label: 'Fondos',
        hint: 'fondos',
        screen: { name: 'move', intent: 'FONDOS' },
      }),
    ).toBe(true);
  });
});
