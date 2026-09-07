import { useEffect, useMemo, useState } from 'react';
import { House, Save } from 'lucide-react';
import {
  DASHBOARD_PREFS_KEY,
  dashboardFeaturedCandidates,
  isDefaultDashboardAccount,
  serializeDashboardPrefs,
  type DashboardPrefs,
} from '../../domain';
import { errorMessage } from '../../App';
import { useFinance } from '../../stores/financeStore';
import { ActionBtn } from '../ui/Icon';

export function DashboardSettings() {
  const { ledger, refresh, dashboardPrefs, creditCards, accounts, go } = useFinance();
  const [prefs, setPrefs] = useState<DashboardPrefs>(dashboardPrefs);
  const [message, setMessage] = useState<string | null>(null);
  const limitedCards = creditCards.filter((card) => card.creditLimitCents != null);
  const slot1Id = prefs.limitedCardId ?? limitedCards.find((card) => card.id === 'card-one-limit')?.id ?? limitedCards[0]?.id;
  const extraCandidates = limitedCards.filter((card) => card.id !== slot1Id);
  const listed = useMemo(() => dashboardFeaturedCandidates(accounts), [accounts]);
  const extras = listed.filter((account) => !isDefaultDashboardAccount(account));
  const featured = new Set(prefs.featuredAccountIds);

  useEffect(() => {
    setPrefs(dashboardPrefs);
  }, [dashboardPrefs]);

  const toggleFeatured = (id: string) => {
    setPrefs((current) => {
      const next = new Set(current.featuredAccountIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...current, featuredAccountIds: [...next] };
    });
  };

  const onSave = async () => {
    if (!ledger) return;
    setMessage(null);
    try {
      await ledger.withTransaction((tx) => tx.setMeta(DASHBOARD_PREFS_KEY, serializeDashboardPrefs(prefs)));
      await refresh();
      setMessage('Inicio actualizado');
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  return (
    <div className="space-y-6">
      <section className="card space-y-3">
        <h2 className="text-sm uppercase tracking-[0.2em] text-stone-500">Cuentas en Inicio</h2>
        <ul className="divide-y divide-stone-200/80">
          {listed.map((account) => {
            const locked = isDefaultDashboardAccount(account);
            const checked = locked || featured.has(account.id);
            return (
              <li key={account.id} className="py-2">
                <label className="flex cursor-pointer items-center gap-3" title={locked ? 'Siempre visible' : 'Mostrar en Inicio'}>
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={checked}
                    disabled={locked}
                    onChange={() => toggleFeatured(account.id)}
                  />
                  <span>
                    <span className="font-medium">{account.name}</span>
                    {locked ? <span className="mt-0.5 block text-xs text-stone-400">Siempre (Barras / Atlántida)</span> : null}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {extras.length === 0 ? (
          <p className="text-xs text-stone-400">Barras y Atlántida siempre. Otras públicas se marcan aquí. Nunca privadas.</p>
        ) : null}
      </section>

      <section className="card space-y-3">
        <h2 className="text-sm uppercase tracking-[0.2em] text-stone-500">Slot 3 · otra con límite</h2>
        {extraCandidates.length === 0 ? (
          <p className="text-sm text-stone-500">Vacío. Cuando exista otra tarjeta con límite, elígela aquí.</p>
        ) : (
          <label className="block text-sm">
            Tarjeta extra
            <select
              className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
              value={prefs.extraLimitedCardId ?? ''}
              onChange={(event) => setPrefs({ ...prefs, extraLimitedCardId: event.target.value || null })}
            >
              <option value="">Ninguna</option>
              {extraCandidates.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </section>

      {message && <p className="text-sm text-stone-600">{message}</p>}
      <div className="flex flex-wrap gap-2">
        <ActionBtn icon={Save} label="Guardar" title="Guarda qué se ve en Inicio." onClick={() => void onSave()} />
        <ActionBtn
          icon={House}
          label="Ver Inicio"
          variant="secondary"
          title="Vuelve al tablero"
          onClick={() => go({ name: 'dashboard' })}
        />
      </div>
    </div>
  );
}
