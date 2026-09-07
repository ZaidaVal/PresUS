import { useEffect, type ReactNode } from 'react';
import { DomainError } from './domain';
import { useFinance } from './stores/financeStore';
import { attachLockOnHide, useLock } from './stores/lockStore';
import { useDrive } from './stores/driveStore';
import { PRODUCT_NAME } from './branding';
import { applyExplicitEmptyBookIfNeeded, EMPTY_BOOK_PENDING_PUSH_KEY, seedIfNeeded } from './database/seed';
import {
  applyPresusNuevoBootImports,
  importPresusNuevoExpensesIfNeeded,
  importPresusNuevoExtrasIfNeeded,
  importPresusNuevoOneChargesIfNeeded,
} from './import/importPresusNuevo';
import { peekAccessToken } from './sync';
import { DashboardScreen } from './modules/dashboard/DashboardScreen';
import { AccountsScreen } from './modules/accounts/AccountsScreen';
import { AccountDetailScreen } from './modules/accounts/AccountDetailScreen';
import { FundsScreen } from './modules/funds/FundsScreen';
import { SavingsScreen } from './modules/savings/SavingsScreen';
import { MovementScreen } from './modules/transactions/MovementScreen';
import { MovementsScreen } from './modules/transactions/MovementsScreen';
import { BudgetsScreen } from './modules/budgets/BudgetsScreen';
import { BudgetEditScreen } from './modules/budgets/BudgetEditScreen';
import { BudgetBalanceScreen } from './modules/budgets/BudgetBalanceScreen';
import { SettingsScreen } from './modules/settings/SettingsScreen';
import { MonthlySpendScreen } from './modules/spend/MonthlySpendScreen';
import { DebtsScreen } from './modules/debts/DebtsScreen';
import { DebtEditScreen } from './modules/debts/DebtEditScreen';
import { DebtPlanScreen } from './modules/debts/DebtPlanScreen';
import { ProjectsScreen } from './modules/projects/ProjectsScreen';
import { AccountEditScreen } from './modules/settings/AccountEditScreen';
import { FundEditScreen } from './modules/settings/FundEditScreen';
import { CardEditScreen } from './modules/settings/CardEditScreen';
import { LockScreen } from './modules/lock/LockScreen';
import { BottomNav } from './modules/nav/BottomNav';
import { HacerBar } from './modules/nav/HacerBar';
import { hardwareBackTarget } from './modules/nav/nav';

export default function App() {
  const { ready, error, sqliteStatus, screen, go, ledger, people, refresh } = useFinance();
  const { initialized, unlocked, init, linkedEmail } = useLock();
  const refreshDrive = useDrive((state) => state.refreshMeta);
  const pullOnAccess = useDrive((state) => state.pullOnAccess);
  const accessPulling = useDrive((state) => state.accessPulling);

  useEffect(() => {
    void init();
    return attachLockOnHide();
  }, [init]);

  useEffect(() => {
    if (!unlocked || !ready) return;
    const trapHistory = () => {
      window.history.pushState({ presusHomeBack: true }, '');
    };
    trapHistory();
    const onPopState = () => {
      const target = hardwareBackTarget(useFinance.getState().screen);
      if (target) useFinance.getState().go(target);
      trapHistory();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [unlocked, ready]);

  useEffect(() => {
    if (!ledger || !unlocked) return;
    let cancelled = false;
    void (async () => {
      await refreshDrive(ledger);
      const replaced = await applyExplicitEmptyBookIfNeeded(ledger);
      if (replaced) {
        await seedIfNeeded(ledger);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(EMPTY_BOOK_PENDING_PUSH_KEY, '1');
        }
      }
      const storage = typeof localStorage !== 'undefined' ? localStorage : null;
      const { imported, extras, expenses } = await applyPresusNuevoBootImports(ledger, storage);
      const oneLines = await importPresusNuevoOneChargesIfNeeded(ledger);
      let expenseLines = expenses;
      const pendingPush =
        typeof localStorage !== 'undefined' && localStorage.getItem(EMPTY_BOOK_PENDING_PUSH_KEY) === '1';
      if (peekAccessToken()) {
        await pullOnAccess(ledger);
        expenseLines = (await importPresusNuevoExpensesIfNeeded(ledger, storage)) || expenseLines;
        await importPresusNuevoOneChargesIfNeeded(ledger);
        await importPresusNuevoExtrasIfNeeded(ledger);
      } else if (imported || oneLines || extras || expenseLines) {
        useDrive.setState({
          status: 'Libro importado de PresUSNuevo. Subir a Drive cuando conectes; no se sube el vacío.',
          error: null,
        });
      } else if (replaced || pendingPush) {
        useDrive.setState({
          status:
            'Libro local pendiente de subir a Drive; no se restaura el latest viejo.',
          error: null,
        });
      }
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [ledger, unlocked, refreshDrive, pullOnAccess, refresh]);

  const peopleLabel =
    people.length > 0
      ? people
          .slice()
          .sort((left, right) => left.code.localeCompare(right.code))
          .map((person) => person.displayName)
          .join(' / ')
      : 'Z / A';

  if (!initialized) {
    return (
      <Shell>
        <h1 className="font-display text-4xl text-ink">{PRODUCT_NAME}</h1>
        <p className="mt-4 text-sm uppercase tracking-[0.2em] text-stone-500">
          {linkedEmail ? 'Reabriendo sesión de Google…' : 'Comprobando acceso local'}
        </p>
      </Shell>
    );
  }

  if (!unlocked) {
    return <LockScreen />;
  }

  if (error) {
    return (
      <Shell>
        <h1 className="text-3xl font-semibold">{PRODUCT_NAME}</h1>
        <p className="mt-4 text-sm uppercase tracking-[0.2em] text-stone-500">Archivo local</p>
        <p className="mt-6 rounded-2xl bg-red-950/90 p-4 text-red-50">{error}</p>
      </Shell>
    );
  }

  if (!ready) {
    return (
      <Shell>
        <h1 className="text-3xl font-semibold">{PRODUCT_NAME}</h1>
        <p className="mt-4 text-sm uppercase tracking-[0.2em] text-stone-500">Abriendo</p>
        <p className="mt-8 text-lg">{sqliteStatus}</p>
      </Shell>
    );
  }

  return (
    <Shell>
      <HacerBar screen={screen} peopleLabel={peopleLabel} linkedEmail={linkedEmail} />
      {accessPulling && (
        <p className="mt-4 rounded-2xl bg-stone-100 px-4 py-3 text-sm text-stone-700">
          Trayendo el latest de Drive. El libro local se sustituye por esa copia…
        </p>
      )}
      <div className="mt-6">
        {screen.name === 'dashboard' && <DashboardScreen />}
        {screen.name === 'accounts' && <AccountsScreen />}
        {screen.name === 'account' && <AccountDetailScreen id={screen.id} focus={screen.focus} />}
        {screen.name === 'account-edit' && <AccountEditScreen key={screen.id ?? 'new-account'} id={screen.id} />}
        {screen.name === 'funds' && <FundsScreen />}
        {screen.name === 'fund-edit' && (
          <FundEditScreen
            key={screen.id ?? `new-fund-${screen.segment ?? ''}-${screen.goalKind ?? ''}`}
            id={screen.id}
            segment={screen.segment}
            goalKind={screen.goalKind}
          />
        )}
        {screen.name === 'card-edit' && <CardEditScreen key={screen.id ?? 'new-card'} id={screen.id} />}
        {screen.name === 'savings' && <SavingsScreen />}
        {screen.name === 'projects' && <ProjectsScreen />}
        {screen.name === 'debts' && <DebtsScreen />}
        {screen.name === 'debt-edit' && <DebtEditScreen key={screen.id ?? 'new-debt'} id={screen.id} />}
        {screen.name === 'debt-plan' && <DebtPlanScreen key={screen.id ?? 'draft-hipoteca'} id={screen.id} />}
        {screen.name === 'movements' && <MovementsScreen />}
        {screen.name === 'move' && (
          <MovementScreen
            key={`${screen.id ?? 'new'}-${screen.fundId ?? ''}-${screen.intent ?? ''}-${screen.edit ? 'edit' : 'view'}`}
            transactionId={screen.id}
            fundId={screen.fundId}
            intent={screen.intent}
            gastoX={screen.gastoX}
            startEditing={Boolean(screen.edit)}
          />
        )}
        {screen.name === 'budgets' && <BudgetsScreen />}
        {screen.name === 'budget-balance' && <BudgetBalanceScreen />}
        {screen.name === 'budget-edit' && <BudgetEditScreen key={screen.id ?? 'new-budget'} id={screen.id} />}
        {screen.name === 'monthly-spend' && <MonthlySpendScreen />}
        {screen.name === 'settings' && <SettingsScreen tab={screen.tab} />}
      </div>
      <BottomNav screen={screen} onGo={go} />
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto min-h-dvh max-w-3xl px-4 py-6 pb-28">{children}</div>;
}

export function errorMessage(error: unknown): string {
  if (error instanceof DomainError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
