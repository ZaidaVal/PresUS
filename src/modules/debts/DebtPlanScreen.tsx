import { useEffect, useMemo, useState } from 'react';
import { Calculator, Plus, Save } from 'lucide-react';
import {
  AMORTIZATION_PLAN_META_KEY,
  BASE_EXTRA_MONTHLY_CENTS,
  OPTIONAL_EXTRA_MONTHLY_CENTS,
  addExtraScenario,
  bpsToInput,
  centsToInput,
  defaultDebtPlanState,
  formatUsd,
  parseAmortizationPlans,
  parsePercentToBps,
  parseUsdToCents,
  plannedRemainingAfterMonth,
  projectExtraScenarios,
  remainingDebtCents,
  saveDebt,
  seasonalTotalCents,
  serializeAmortizationPlans,
  simulateAmortizationSchedule,
  suggestedInstallmentCents,
  type AmortizationPlansState,
  type Debt,
  type DebtAmortization,
  type DebtCompounding,
  type DebtKind,
} from '../../domain';
import { errorMessage } from '../../App';
import { useFinance } from '../../stores/financeStore';
import { ActionBtn, BackLink } from '../ui/Icon';
import { CollapsibleCard } from '../ui/CollapsibleCard';
import { DataCell, DataRow, DataTable } from '../ui/DataTable';

function isoFromDateInput(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Usa una fecha válida');
  }
  return `${value}T00:00:00.000Z`;
}

export function DebtPlanScreen({ id }: { id?: string }) {
  const { ledger, refresh, go, debts, debtPayments, transactions } = useFinance();
  const existing = id ? debts.find((row) => row.id === id) : undefined;
  const remaining = existing
    ? remainingDebtCents(existing.originalCents, debtPayments.filter((row) => row.debtId === existing.id), transactions)
    : 0;

  const [plans, setPlans] = useState<AmortizationPlansState>(() => parseAmortizationPlans(null));
  const [name, setName] = useState(existing?.name ?? 'Hipoteca');
  const [kind, setKind] = useState<DebtKind>(existing?.kind ?? 'MORTGAGE');
  const [principal, setPrincipal] = useState(existing ? centsToInput(existing.originalCents) : '');
  const [rate, setRate] = useState(existing ? bpsToInput(existing.annualRateBps) : '');
  const [term, setTerm] = useState(existing ? String(existing.termMonths) : '');
  const [installment, setInstallment] = useState(existing ? centsToInput(existing.installmentCents) : '');
  const [started, setStarted] = useState(existing ? existing.startedAt.slice(0, 10) : '');
  const [amortization, setAmortization] = useState<DebtAmortization>(existing?.amortization ?? 'FRENCH');
  const [compounding, setCompounding] = useState<DebtCompounding>(existing?.compounding ?? 'MONTHLY');
  const [zSeasonal, setZSeasonal] = useState('');
  const [aSeasonal, setASeasonal] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const planKey = existing?.id ?? 'draft-hipoteca';
  const debtPlan = plans.byDebt[planKey] ?? defaultDebtPlanState();

  useEffect(() => {
    if (!ledger) return;
    void ledger.withTransaction(async (tx) => {
      const parsed = parseAmortizationPlans(await tx.getMeta(AMORTIZATION_PLAN_META_KEY));
      setPlans(parsed);
      setZSeasonal(centsToInput(parsed.seasonal.zCents));
      setASeasonal(centsToInput(parsed.seasonal.aCents));
    });
  }, [ledger]);

  const parsedFields = useMemo(() => {
    try {
      const originalCents = principal.trim() ? parseUsdToCents(principal) : 0;
      const annualRateBps = rate.trim() ? parsePercentToBps(rate) : 0;
      const termMonths = term.trim() ? Number(term) : 0;
      if (!Number.isInteger(termMonths) || termMonths <= 0) return null;
      const startedAt = started ? isoFromDateInput(started) : '2026-01-01T00:00:00.000Z';
      const installmentCents = installment.trim()
        ? parseUsdToCents(installment)
        : originalCents > 0
          ? suggestedInstallmentCents({
              principalCents: originalCents,
              annualRateBps,
              termMonths,
              amortization,
              compounding,
            })
          : 0;
      return { originalCents, annualRateBps, termMonths, startedAt, installmentCents };
    } catch {
      return null;
    }
  }, [principal, rate, term, installment, started, amortization, compounding]);

  const seasonalCents = (() => {
    try {
      const z = zSeasonal.trim() ? parseUsdToCents(zSeasonal) : plans.seasonal.zCents;
      const a = aSeasonal.trim() ? parseUsdToCents(aSeasonal) : plans.seasonal.aCents;
      return z + a;
    } catch {
      return seasonalTotalCents(plans.seasonal);
    }
  })();

  const scenarios = useMemo(() => {
    if (!parsedFields || parsedFields.originalCents <= 0 || parsedFields.installmentCents <= 0) return [];
    const extraList =
      debtPlan.extraMonthlyListCents.length > 0 ? debtPlan.extraMonthlyListCents : [...BASE_EXTRA_MONTHLY_CENTS];
    return projectExtraScenarios(
      {
        principalCents: remaining > 0 ? remaining : parsedFields.originalCents,
        originalCents: parsedFields.originalCents,
        annualRateBps: parsedFields.annualRateBps,
        installmentCents: parsedFields.installmentCents,
        termMonths: parsedFields.termMonths,
        amortization,
        compounding,
        startedAt: parsedFields.startedAt,
        seasonalMonths: plans.seasonal.months,
        seasonalExtraCents: debtPlan.includeSeasonal ? seasonalCents : 0,
      },
      extraList,
    );
  }, [parsedFields, remaining, amortization, compounding, debtPlan, plans.seasonal.months, seasonalCents]);

  const schedule = useMemo(() => {
    if (!parsedFields || parsedFields.originalCents <= 0 || parsedFields.installmentCents <= 0) return [];
    const extraMonthly = debtPlan.extraMonthlyListCents.includes(0)
      ? 0
      : (debtPlan.extraMonthlyListCents[0] ?? 0);
    return simulateAmortizationSchedule({
      principalCents: remaining > 0 ? remaining : parsedFields.originalCents,
      originalCents: parsedFields.originalCents,
      annualRateBps: parsedFields.annualRateBps,
      installmentCents: parsedFields.installmentCents,
      termMonths: parsedFields.termMonths,
      amortization,
      compounding,
      extraMonthlyCents: extraMonthly,
      startedAt: parsedFields.startedAt,
      seasonalMonths: plans.seasonal.months,
      seasonalExtraCents: debtPlan.includeSeasonal ? seasonalCents : 0,
    });
  }, [parsedFields, remaining, amortization, compounding, debtPlan, plans.seasonal.months, seasonalCents]);

  const persistPlans = async (next: AmortizationPlansState) => {
    if (!ledger) return;
    await ledger.withTransaction(async (tx) => {
      await tx.setMeta(AMORTIZATION_PLAN_META_KEY, serializeAmortizationPlans(next));
    });
    setPlans(next);
  };

  const patchDebtPlan = async (patch: Partial<typeof debtPlan>) => {
    const next: AmortizationPlansState = {
      ...plans,
      seasonal: {
        ...plans.seasonal,
        zCents: zSeasonal.trim() ? parseUsdToCents(zSeasonal) : plans.seasonal.zCents,
        aCents: aSeasonal.trim() ? parseUsdToCents(aSeasonal) : plans.seasonal.aCents,
      },
      byDebt: {
        ...plans.byDebt,
        [planKey]: { ...debtPlan, ...patch },
      },
    };
    await persistPlans(next);
  };

  const onSaveDebt = async () => {
    if (!ledger || !parsedFields || parsedFields.originalCents <= 0) {
      setMessage('Sin capital no se persiste (el Excel no trae hipoteca).');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const row: Debt = {
        id: existing?.id ?? crypto.randomUUID(),
        name,
        kind,
        originalCents: parsedFields.originalCents,
        annualRateBps: parsedFields.annualRateBps,
        termMonths: parsedFields.termMonths,
        installmentCents: parsedFields.installmentCents,
        startedAt: parsedFields.startedAt,
        paymentAccountId: existing?.paymentAccountId ?? null,
        coverFundId: existing?.coverFundId ?? null,
        amortization,
        compounding,
        extraMonthlyCents: existing?.extraMonthlyCents ?? 0,
        extraFortnightCents: existing?.extraFortnightCents ?? 0,
        extraEveryNMonths: existing?.extraEveryNMonths ?? null,
        extraEveryNAmountCents: existing?.extraEveryNAmountCents ?? 0,
        note: existing?.note ?? '',
        active: existing?.active ?? true,
      };
      await ledger.withTransaction((tx) => saveDebt(tx, row, !existing));
      await refresh();
      go({ name: 'debt-plan', id: row.id });
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const lastChecked =
    debtPlan.checkedMonthIndices.length > 0
      ? debtPlan.checkedMonthIndices[debtPlan.checkedMonthIndices.length - 1]!
      : debtPlan.currentMonthIndex;
  const plannedLeft = plannedRemainingAfterMonth(
    schedule,
    remaining > 0 ? remaining : parsedFields?.originalCents ?? 0,
    schedule.length === 0 ? null : lastChecked,
  );
  const visible = schedule.filter(
    (row) => Math.abs(row.monthIndex - debtPlan.currentMonthIndex) <= 18,
  );

  return (
    <div className="space-y-5">
      <BackLink />

      <section className="overflow-hidden rounded-[2rem] bg-emerald-950 p-6 text-amber-50 shadow-lg shadow-emerald-950/20">
        <p className="text-xs uppercase tracking-[0.28em] text-amber-200/80">Amortización</p>
        <h2 className="mt-2 font-display text-4xl">{name}</h2>
      </section>

      <CollapsibleCard id="debt-plan.datos" title="Datos" defaultOpen>
        <div className="space-y-3">
        <label className="block text-sm">
          Nombre
          <input className="mt-1 w-full rounded-2xl bg-stone-100 p-3" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block text-sm">
          Tipo
          <select className="mt-1 w-full rounded-2xl bg-stone-100 p-3" value={kind} onChange={(e) => setKind(e.target.value as DebtKind)}>
            <option value="MORTGAGE">Hipoteca</option>
            <option value="PERSONAL">Personal</option>
            <option value="VEHICLE">Vehículo</option>
            <option value="OTHER">Otra</option>
          </select>
        </label>
        <Field label="Capital" value={principal} onChange={setPrincipal} placeholder="0.00" />
        <Field label="Tasa anual %" value={rate} onChange={setRate} placeholder="0.00" />
        <Field label="Plazo meses" value={term} onChange={setTerm} placeholder="360" />
        <Field label="Cuota" value={installment} onChange={setInstallment} placeholder="0.00" />
        <label className="block text-sm">
          Inicio
          <input type="date" className="mt-1 w-full rounded-2xl bg-stone-100 p-3" value={started} onChange={(e) => setStarted(e.target.value)} />
        </label>
        <label className="block text-sm">
          Amortización
          <select className="mt-1 w-full rounded-2xl bg-stone-100 p-3" value={amortization} onChange={(e) => setAmortization(e.target.value as DebtAmortization)}>
            <option value="FRENCH">Francesa</option>
            <option value="INTEREST_ONLY">Solo interés</option>
            <option value="SIMPLE">Simple</option>
          </select>
        </label>
        <label className="block text-sm">
          Capitalización
          <select className="mt-1 w-full rounded-2xl bg-stone-100 p-3" value={compounding} onChange={(e) => setCompounding(e.target.value as DebtCompounding)}>
            <option value="MONTHLY">Mensual</option>
            <option value="FORTNIGHTLY">Quincenal</option>
            <option value="ANNUAL">Anual</option>
          </select>
        </label>
        {message && <p className="text-sm text-red-800">{message}</p>}
        <ActionBtn icon={Save} label="Guardar deuda" disabled={busy} onClick={() => void onSaveDebt()} />
        </div>
      </CollapsibleCard>

      <CollapsibleCard id="debt-plan.seasonal" title="Abonos ene / jul / dic">
        <Field label="Z" value={zSeasonal} onChange={setZSeasonal} placeholder="200.00" />
        <Field label="A" value={aSeasonal} onChange={setASeasonal} placeholder="300.00" />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={debtPlan.includeSeasonal}
            onChange={(event) => void patchDebtPlan({ includeSeasonal: event.target.checked }).catch((err) => setMessage(errorMessage(err)))}
          />
          Incluir en los escenarios
        </label>
        <p className="text-sm tabular-nums text-stone-600">Total {formatUsd(seasonalCents)} × 3 / año</p>
      </CollapsibleCard>

      <CollapsibleCard id="debt-plan.scenarios" title="Escenarios" defaultOpen>
        <div className="flex flex-wrap gap-2">
          <ActionBtn
            icon={Plus}
            label="Extra $200"
            variant="secondary"
            onClick={() =>
              void patchDebtPlan({
                extraMonthlyListCents: addExtraScenario(debtPlan.extraMonthlyListCents, OPTIONAL_EXTRA_MONTHLY_CENTS),
              }).catch((err) => setMessage(errorMessage(err)))
            }
          />
        </div>
        {scenarios.length === 0 ? (
          <p className="text-sm text-stone-500">Sin capital/cuota no hay plan. Hipoteca Excel: vacío.</p>
        ) : (
          <DataTable
            caption="Escenarios"
            columns={[
              { key: 'esc', label: 'Escenario' },
              { key: 'extra', label: 'Extra/mes', numeric: true },
              { key: 'meses', label: 'Meses', numeric: true },
              { key: 'int', label: 'Interés', numeric: true },
              { key: 'ahorro', label: 'Ahorro', numeric: true },
            ]}
          >
            {scenarios.map((row) => {
              const base = scenarios[0]?.result.totalInterestCents ?? row.result.totalInterestCents;
              return (
                <DataRow key={row.extraMonthlyCents}>
                  <DataCell>{row.label}</DataCell>
                  <DataCell numeric>{formatUsd(row.extraMonthlyCents)}</DataCell>
                  <DataCell numeric>{row.result.months}</DataCell>
                  <DataCell numeric>{formatUsd(row.result.totalInterestCents)}</DataCell>
                  <DataCell numeric>{formatUsd(Math.max(0, base - row.result.totalInterestCents))}</DataCell>
                </DataRow>
              );
            })}
          </DataTable>
        )}
      </CollapsibleCard>

      <CollapsibleCard id="debt-plan.avance" title="Avance">
        <label className="block text-sm">
          Mes actual
          <input
            className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
            value={String(debtPlan.currentMonthIndex)}
            onChange={(event) => {
              const value = Number(event.target.value);
              if (!Number.isInteger(value) || value < 0) return;
              void patchDebtPlan({ currentMonthIndex: value }).catch((err) => setMessage(errorMessage(err)));
            }}
          />
        </label>
        <p className="text-sm tabular-nums text-stone-600">
          Plan {formatUsd(plannedLeft)}
          {existing ? ` · real ${formatUsd(remaining)}` : ''}
          {schedule.length > 0
            ? ` · ${debtPlan.checkedMonthIndices.length}/${schedule.length}`
            : ''}
        </p>
        {visible.length > 0 && (
          <DataTable
            caption="Plan mensual"
            columns={[
              { key: 'ok', label: '' },
              { key: 'mes', label: 'Mes' },
              { key: 'pago', label: 'Pago', numeric: true },
              { key: 'saldo', label: 'Saldo', numeric: true },
            ]}
          >
            {visible.map((row) => {
              const checked = debtPlan.checkedMonthIndices.includes(row.monthIndex);
              const label = row.occurredAt.slice(0, 7);
              return (
                <DataRow key={row.monthIndex}>
                  <DataCell>
                    <input
                      type="checkbox"
                      checked={checked}
                      aria-label={`Mes ${label}`}
                      onChange={() => {
                        const next = checked
                          ? debtPlan.checkedMonthIndices.filter((m) => m !== row.monthIndex)
                          : [...debtPlan.checkedMonthIndices, row.monthIndex].sort((a, b) => a - b);
                        void patchDebtPlan({
                          checkedMonthIndices: next,
                          currentMonthIndex: row.monthIndex,
                        }).catch((err) => setMessage(errorMessage(err)));
                      }}
                    />
                  </DataCell>
                  <DataCell nowrap>{label}</DataCell>
                  <DataCell numeric>{formatUsd(row.paidCents)}</DataCell>
                  <DataCell numeric>{formatUsd(row.remainingCents)}</DataCell>
                </DataRow>
              );
            })}
          </DataTable>
        )}
      </CollapsibleCard>

      <ActionBtn icon={Calculator} label="Editar catálogo" variant="secondary" onClick={() => go({ name: 'debt-edit', id: existing?.id })} />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm">
      {label}
      <input
        className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
