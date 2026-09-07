import { useEffect, useMemo, useState } from 'react';
import { Landmark, PiggyBank, University, Wallet } from 'lucide-react';
import {
  RELEASE_DESTINATIONS_META_KEY,
  isAtlantidaAccount,
  isBarrasAccount,
  isSavingsAccount,
  listedReleaseDestinationAccounts,
  serializeReleaseDestinations,
} from '../../domain';
import { errorMessage } from '../../App';
import { useFinance } from '../../stores/financeStore';
import { ActionBtn } from '../ui/Icon';

function accountIcon(account: { id: string; name: string; kind: 'BANK' | 'CASH' | 'FUND_HOLDER' | 'CREDIT'; isCardPaymentSource: boolean }) {
  if (isAtlantidaAccount(account)) return University;
  if (isBarrasAccount(account)) return Landmark;
  if (isSavingsAccount(account)) return PiggyBank;
  return Wallet;
}

function accountHint(account: { id: string; name: string; kind: 'BANK' | 'CASH' | 'FUND_HOLDER' | 'CREDIT'; isCardPaymentSource: boolean }): string {
  if (isAtlantidaAccount(account)) {
    return 'Atlántida no es caja general: solo el apartado a pagar ONE. Actívala solo si quieres desembolsar aquí al liberar.';
  }
  if (isBarrasAccount(account)) {
    return 'Barras: el disponible del día a día. Típico destino al soltar un apartado operativo.';
  }
  if (isSavingsAccount(account)) {
    return 'Cuenta de ahorro: puede recibir capital al liberar un apartado.';
  }
  return 'Cuenta pública. Si la marcas, podrá recibir el desembolso al liberar.';
}

export function ReleaseDestinationsSettings() {
  const { ledger, refresh, accounts, releaseDestinationAccountIds, go } = useFinance();
  const listed = useMemo(() => listedReleaseDestinationAccounts(accounts), [accounts]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(releaseDestinationAccountIds));
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSelected(new Set(releaseDestinationAccountIds));
  }, [releaseDestinationAccountIds]);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onSave = async () => {
    if (!ledger) return;
    setBusy(true);
    setMessage(null);
    try {
      const ids = listed.filter((row) => selected.has(row.id)).map((row) => row.id);
      await ledger.withTransaction((tx) => tx.setMeta(RELEASE_DESTINATIONS_META_KEY, serializeReleaseDestinations(ids)));
      await refresh();
      setMessage(ids.length === 0 ? 'Guardado. Hasta que marques una cuenta, no se puede liberar.' : 'Cuentas destino de liberación guardadas');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="card space-y-3">
        <h2 className="text-sm uppercase tracking-[0.2em] text-stone-500">Destino al liberar</h2>
        {listed.length === 0 ? (
          <p className="text-sm text-stone-500">No hay cuentas públicas.</p>
        ) : (
          <ul className="divide-y divide-stone-200/80">
            {listed.map((account) => {
              const Icon = accountIcon(account);
              const hint = accountHint(account);
              const checked = selected.has(account.id);
              const atlantida = isAtlantidaAccount(account);
              return (
                <li key={account.id} className="flex items-start gap-3 py-3">
                  <span
                    className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                      atlantida ? 'bg-spend/30 text-ink' : 'bg-duty text-cream'
                    }`}
                    title={hint}
                    aria-hidden
                  >
                    <Icon className="h-5 w-5" strokeWidth={1.75} />
                  </span>
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3" title={hint}>
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0"
                      checked={checked}
                      onChange={() => toggle(account.id)}
                      aria-label={`${account.name}. ${hint}`}
                    />
                    <span className="font-medium text-ink">{account.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {message && <p className="text-sm text-stone-600">{message}</p>}
      <div className="flex flex-wrap gap-2">
        <ActionBtn
          icon={Landmark}
          label="Guardar"
          title="Guarda qué cuentas pueden recibir el desembolso al liberar."
          disabled={busy}
          onClick={() => void onSave()}
        />
        <button type="button" className="rounded-full bg-stone-200 px-4 py-2 text-sm" onClick={() => go({ name: 'dashboard' })}>
          Ver Inicio
        </button>
      </div>
    </div>
  );
}
