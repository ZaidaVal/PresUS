import { useEffect, useState } from 'react';
import {
  SAVINGS_PROJECTION_META_KEY,
  bpsToInput,
  centsToInput,
  defaultSavingsProjection,
  formatUsd,
  parsePercentToBps,
  parseSavingsProjections,
  parseUsdToCents,
  projectSavingsBalance,
  projectableSavingsAccounts,
  serializeSavingsProjections,
  type InterestKind,
  type SavingsProjectionsState,
} from '../../domain';
import { errorMessage } from '../../App';
import { useFinance } from '../../stores/financeStore';
import { DataCell, DataRow, DataTable } from '../ui/DataTable';
import { CollapsibleCard } from '../ui/CollapsibleCard';

export function SavingsProjectionPanel() {
  const { ledger, balances } = useFinance();
  const accounts = projectableSavingsAccounts(balances.map((row) => row.account));
  const [state, setState] = useState<SavingsProjectionsState>({ byAccountId: {} });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!ledger) return;
    void ledger.withTransaction(async (tx) => {
      setState(parseSavingsProjections(await tx.getMeta(SAVINGS_PROJECTION_META_KEY)));
    });
  }, [ledger]);

  const persist = async (next: SavingsProjectionsState) => {
    if (!ledger) return;
    await ledger.withTransaction(async (tx) => {
      await tx.setMeta(SAVINGS_PROJECTION_META_KEY, serializeSavingsProjections(next));
    });
    setState(next);
  };

  const rowOf = (id: string) => state.byAccountId[id] ?? defaultSavingsProjection();

  return (
    <CollapsibleCard id="savings.projection" title="Proyección por cuenta">
      {accounts.length === 0 ? (
        <p className="text-sm text-stone-500">Sin cuentas de ahorro</p>
      ) : (
        <DataTable
          caption="Proyección de ahorro"
          columns={[
            { key: 'cuenta', label: 'Cuenta' },
            { key: 'ok', label: '' },
            { key: 'aporte', label: 'Aporte/mes' },
            { key: 'tasa', label: 'Tasa %' },
            { key: 'meses', label: 'Meses' },
            { key: 'fin', label: 'Proyectado', numeric: true },
          ]}
        >
          {accounts.map((account) => {
            const saldo = balances.find((row) => row.account.id === account.id)?.saldoCents ?? 0;
            const prefs = rowOf(account.id);
            let ending = saldo;
            try {
              if (prefs.enabled) {
                ending = projectSavingsBalance({
                  principalCents: saldo,
                  monthlyContributionCents: prefs.monthlyContributionCents,
                  annualRateBps: prefs.annualRateBps,
                  kind: prefs.kind,
                  months: prefs.months,
                }).endingCents;
              }
            } catch {
              ending = saldo;
            }
            return (
              <DataRow key={account.id}>
                <DataCell>
                  {account.name}
                  <span className="mt-0.5 block text-xs text-stone-500">{formatUsd(saldo)}</span>
                </DataCell>
                <DataCell>
                  <input
                    type="checkbox"
                    checked={prefs.enabled}
                    aria-label={`Proyectar ${account.name}`}
                    onChange={(event) => {
                      const next = {
                        byAccountId: {
                          ...state.byAccountId,
                          [account.id]: { ...prefs, enabled: event.target.checked },
                        },
                      };
                      void persist(next).catch((err) => setMessage(errorMessage(err)));
                    }}
                  />
                </DataCell>
                <DataCell>
                  <input
                    className="w-24 rounded-xl bg-stone-100 p-2"
                    defaultValue={centsToInput(prefs.monthlyContributionCents)}
                    aria-label={`Aporte ${account.name}`}
                    onBlur={(event) => {
                      try {
                        const monthlyContributionCents = parseUsdToCents(event.target.value || '0');
                        void persist({
                          byAccountId: {
                            ...state.byAccountId,
                            [account.id]: { ...prefs, monthlyContributionCents },
                          },
                        }).catch((err) => setMessage(errorMessage(err)));
                      } catch (error) {
                        setMessage(errorMessage(error));
                      }
                    }}
                  />
                </DataCell>
                <DataCell>
                  <input
                    className="w-20 rounded-xl bg-stone-100 p-2"
                    defaultValue={bpsToInput(prefs.annualRateBps)}
                    aria-label={`Tasa ${account.name}`}
                    onBlur={(event) => {
                      try {
                        const annualRateBps = event.target.value.trim()
                          ? parsePercentToBps(event.target.value)
                          : 0;
                        const kind: InterestKind = annualRateBps > 0 ? 'COMPOUND_MONTHLY' : 'NONE';
                        void persist({
                          byAccountId: {
                            ...state.byAccountId,
                            [account.id]: { ...prefs, annualRateBps, kind },
                          },
                        }).catch((err) => setMessage(errorMessage(err)));
                      } catch (error) {
                        setMessage(errorMessage(error));
                      }
                    }}
                  />
                </DataCell>
                <DataCell>
                  <input
                    className="w-16 rounded-xl bg-stone-100 p-2"
                    defaultValue={String(prefs.months)}
                    aria-label={`Meses ${account.name}`}
                    onBlur={(event) => {
                      const months = Number(event.target.value);
                      if (!Number.isInteger(months) || months < 0) return;
                      void persist({
                        byAccountId: {
                          ...state.byAccountId,
                          [account.id]: { ...prefs, months },
                        },
                      }).catch((err) => setMessage(errorMessage(err)));
                    }}
                  />
                </DataCell>
                <DataCell numeric>{prefs.enabled ? formatUsd(ending) : '—'}</DataCell>
              </DataRow>
            );
          })}
        </DataTable>
      )}
      {message && <p className="text-sm text-red-800">{message}</p>}
    </CollapsibleCard>
  );
}
