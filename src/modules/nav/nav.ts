import type { DashboardPanel, MoveIntent, Screen, SettingsTab } from '../../stores/financeStore';

export type BottomTab = 'home' | 'movements' | 'settings';

export const HOME_SCREEN: Screen = { name: 'dashboard' };

/** Atrás de chrome o hardware: Inicio. En Inicio no cierra la app. */
export function hardwareBackTarget(screen: Screen): Screen | null {
  if (screen.name === 'dashboard') return null;
  return HOME_SCREEN;
}

export type HacerAction = {
  id: string;
  label: string;
  hint: string;
  screen: Screen;
};

export function bottomTabFor(screen: Screen): BottomTab | null {
  switch (screen.name) {
    case 'dashboard':
    case 'monthly-spend':
    case 'accounts':
    case 'account':
    case 'funds':
    case 'savings':
    case 'projects':
    case 'debts':
    case 'debt-plan':
      return 'home';
    case 'movements':
      return 'movements';
    case 'move':
      return screen.id ? 'movements' : null;
    case 'settings':
    case 'account-edit':
    case 'fund-edit':
    case 'debt-edit':
    case 'card-edit':
      return 'settings';
    default:
      return null;
  }
}

export function dashboardPanelOf(screen: Screen): DashboardPanel {
  if (screen.name === 'monthly-spend') return 'este-mes';
  if (screen.name === 'dashboard') return screen.panel ?? 'hoy';
  return 'hoy';
}

export function settingsTabOf(screen: Screen): SettingsTab {
  if (screen.name === 'settings') {
    if (screen.tab === 'drive') return 'acceso';
    return screen.tab ?? 'catalogos';
  }
  return 'catalogos';
}

function isSpendIntent(intent?: MoveIntent): boolean {
  return (
    intent === 'GASTAR' ||
    intent === 'GASTO' ||
    intent === 'GASTO_X' ||
    intent === 'CARGO_TARJETA' ||
    intent === 'GASTAR_APARTADO'
  );
}

function moveScreensMatch(left: Extract<Screen, { name: 'move' }>, right: Extract<Screen, { name: 'move' }>): boolean {
  if (right.intent === 'GASTAR') return isSpendIntent(left.intent);
  if (right.intent === 'FONDOS') return left.intent === 'FONDOS';
  return left.intent === right.intent && Boolean(left.gastoX) === Boolean(right.gastoX);
}

/** Resalta el chip de Hacer que coincide con la pantalla actual. */
export function hacerActionActive(screen: Screen, action: HacerAction): boolean {
  const target = action.screen;
  if (target.name === 'move') {
    if (screen.name !== 'move' || screen.id) return false;
    return moveScreensMatch(screen, target);
  }
  if (target.name === 'account' && target.focus === 'cuadre') {
    return screen.name === 'account' && screen.id === target.id && screen.focus === 'cuadre';
  }
  if (target.name === 'budgets') return screen.name === 'budgets';
  if (target.name === 'budget-balance') return screen.name === 'budget-balance';
  if (target.name === 'debts') return screen.name === 'debts' || screen.name === 'debt-plan';
  if (target.name === 'projects') return screen.name === 'projects';
  return false;
}

/** @deprecated Usar hacerActionActive */
export function hacerChipActive(
  screen: Screen,
  chip: 'gastar' | 'mover' | 'presupuesto' | 'tarjeta',
): boolean {
  if (chip === 'gastar') {
    return (
      screen.name === 'move' &&
      !screen.id &&
      isSpendIntent(screen.intent)
    );
  }
  if (chip === 'mover') {
    return (
      screen.name === 'move' &&
      !screen.id &&
      (screen.intent === 'TRANSFERENCIA')
    );
  }
  if (chip === 'presupuesto') {
    return (
      screen.name === 'budgets' ||
      screen.name === 'budget-balance' ||
      screen.name === 'debts' ||
      (screen.name === 'move' && !screen.id && screen.intent === 'FONDOS')
    );
  }
  if (chip === 'tarjeta') {
    if (screen.name === 'account' && screen.focus === 'cuadre') return true;
    return screen.name === 'move' && !screen.id && screen.intent === 'PAGO_TARJETA';
  }
  return false;
}
