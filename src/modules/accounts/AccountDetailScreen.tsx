import { useEffect, useState, type FormEvent } from 'react';
import { Banknote, Pencil, Scale, Unlock } from 'lucide-react';
import {
  centsToInput,
  changeReservationAmount,
  formatUsd,
  parseUsdToCents,
  planCardOwedCuadre,
  postLiberacion,
  setAccountBase,
  setCardOwedBase,
  type Reservation,
} from '../../domain';
import { errorMessage } from '../../App';
import { useFinance } from '../../stores/financeStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ActionBtn, BackLink, PencilBtn } from '../ui/Icon';
import { CollapsibleCard } from '../ui/CollapsibleCard';
import { DataCell, DataRow, DataTable, EditCell } from '../ui/DataTable';

export function AccountDetailScreen({ id, focus }: { id: string; focus?: 'cuadre' }) {
  const { balances, funds, reservations, cards, go, ledger, refresh, releaseDestinationAccountIds } = useFinance();
  const row = balances.find((item) => item.account.id === id);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reservationAction, setReservationAction] = useState<{
    kind: 'release' | 'change';
    reservation: Reservation;
    amount: string;
    toAccountId: string;
  } | null>(null);
  const [owedDrafts, setOwedDrafts] = useState<Record<string, string>>({});
  const [cuadre, setCuadre] = useState<{
    cardId: string;
    cardName: string;
    appCents: number;
    informedCents: number;
    summary: string;
  } | null>(null);
  const [baseConfirm, setBaseConfirm] = useState<{ targetCents: number } | null>(null);

  useEffect(() => {
    if (row) setAmount(centsToInput(row.saldoCents));
  }, [id, row?.saldoCents]);

  useEffect(() => {
    setOwedDrafts((current) => {
      const next = { ...current };
      for (const item of cards.filter((card) => card.card.paymentAccountId === id)) {
        if (next[item.card.id] == null) next[item.card.id] = centsToInput(item.saldoCents);
      }
      return next;
    });
  }, [id, cards]);

  useEffect(() => {
    if (focus !== 'cuadre') return;
    document.getElementById('cuadre-atlantida')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus, id]);

  if (!row) return <p>Cuenta no encontrada.</p>;
  const accountFunds = funds.filter((item) => item.fund.accountId === id);
  const accountCards = cards.filter((item) => item.card.paymentAccountId === id);
  const destAccounts = balances.filter((item) => releaseDestinationAccountIds.includes(item.account.id));
  const isPublic = row.account.visibility === 'PUBLIC';
  const isCredit = row.account.kind === 'CREDIT';

  const onSetBase = (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    try {
      setBaseConfirm({ targetCents: parseUsdToCents(amount) });
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const confirmBase = async () => {
    if (!ledger || !baseConfirm) return;
    setBusy(true);
    setMessage(null);
    try {
      await ledger.withTransaction((tx) =>
        setAccountBase(tx, {
          accountId: id,
          targetCents: baseConfirm.targetCents,
          note: note || undefined,
        }),
      );
      await refresh();
      setNote('');
      setBaseConfirm(null);
      setMessage('Saldo actualizado con un ajuste en el historial');
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const confirmReservationAction = async () => {
    if (!ledger || !reservationAction) return;
    setBusy(true);
    setMessage(null);
    try {
      const amountCents = parseUsdToCents(reservationAction.amount);
      await ledger.withTransaction(async (tx) => {
        if (reservationAction.kind === 'release') {
          await postLiberacion(tx, {
            reservationId: reservationAction.reservation.id,
            amountCents,
            toAccountId: reservationAction.toAccountId,
          });
        } else {
          await changeReservationAmount(tx, {
            reservationId: reservationAction.reservation.id,
            amountCents,
          });
        }
      });
      await refresh();
      setReservationAction(null);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const openCuadre = (cardId: string, cardName: string, appCents: number, informedText: string) => {
    setMessage(null);
    try {
      const informedCents = parseUsdToCents(informedText);
      const plan = planCardOwedCuadre(appCents, informedCents);
      setCuadre({
        cardId,
        cardName,
        appCents: plan.appCents,
        informedCents: plan.informedCents,
        summary: plan.summary,
      });
    } catch (error) {
      setMessage(errorMessage(error));
    }
  };

  const confirmCuadre = async () => {
    if (!ledger || !cuadre) return;
    setBusy(true);
    setMessage(null);
    try {
      await ledger.withTransaction((tx) =>
        setCardOwedBase(tx, {
          cardId: cuadre.cardId,
          targetCents: cuadre.informedCents,
        }),
      );
      await refresh();
      setCuadre(null);
      setMessage(`Cuadre de ${cuadre.cardName} registrado.`);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink />
        <ActionBtn icon={Pencil} label="Editar" variant="secondary" onClick={() => go({ name: 'account-edit', id })} />
      </div>

      <CollapsibleCard
        id="account.hero"
        title={row.account.name}
        surface="hero"
        defaultOpen
        summary={isPublic ? formatUsd(row.disponibleUiCents) : undefined}
      >
        <p className="text-xs uppercase tracking-[0.2em] text-hope">{kindLabel(row.account.kind)}</p>
        {isPublic ? (
          <>
            <p className="mt-3 text-xs uppercase tracking-[0.2em] text-hope">
              {row.account.isCardPaymentSource ? 'Para pagar ONE' : 'Disponible'}
            </p>
            <p className="mt-1 font-display text-5xl tabular-nums tracking-tight">
              {formatUsd(row.disponibleUiCents)}
            </p>
          </>
        ) : (
          <p className="mt-3 text-sm text-cream/85">Privada</p>
        )}
      </CollapsibleCard>

      {isPublic && (
        <section className="grid grid-cols-2 gap-3">
          <Mini label="Saldo" value={formatUsd(row.saldoCents)} />
          <Mini label="Apartado" value={formatUsd(row.reservedCents)} />
        </section>
      )}

      {isPublic && row.disponibleCents < 0 && (
        <p className="rounded-2xl bg-amber-100 px-4 py-3 text-sm">
          El disponible bruto es {formatUsd(row.disponibleCents)}. En pantalla se muestra 0.
        </p>
      )}

      {!isPublic && (
        <p className="rounded-2xl bg-amber-100 p-4 text-sm">Sin saldo privado</p>
      )}

      {isPublic && (
        <form className="card space-y-3" onSubmit={onSetBase}>
          <h3 className="text-sm uppercase tracking-[0.2em] text-stone-500">
            {isCredit ? 'Efectivo en la cuenta' : 'Saldo de base'}
          </h3>
          <p className="text-sm text-stone-600">
            {isCredit
              ? 'Fondos para pagar ONE. No es el límite ni el debe de la tarjeta.'
              : 'La diferencia se registra como ajuste.'}
          </p>
          <label className="block">
            <span className="text-xs uppercase tracking-[0.2em] text-stone-500">Nuevo saldo</span>
            <input
              className="mt-1 w-full rounded-2xl border border-emerald-950/10 bg-white px-4 py-3 tabular-nums"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-[0.2em] text-stone-500">Nota</span>
            <input
              className="mt-1 w-full rounded-2xl border border-emerald-950/10 bg-white px-4 py-3"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Apertura / conciliación"
            />
          </label>
          {message && <p className="text-sm">{message}</p>}
          <button
            type="submit"
            disabled={busy}
            className="btn-primary px-4 py-2 text-sm"
          >
            Registrar ajuste
          </button>
        </form>
      )}

      {isPublic && accountCards.length > 0 && (
        <CollapsibleCard id="account.one" htmlId="cuadre-atlantida" title="Tarjeta ONE" defaultOpen>
          <p className="rounded-2xl bg-emerald-950/5 px-4 py-3 text-sm">
            Debo{' '}
            <strong className="tabular-nums">
              {formatUsd(accountCards.reduce((sum, item) => sum + item.saldoCents, 0))}
            </strong>
          </p>
          <ul className="mt-3 space-y-4">
            {accountCards.map((item) => {
              const cover = funds.find((fundRow) => fundRow.fund.id === item.card.coverFundId);
              return (
                <li key={item.card.id} className="border-t border-stone-200/80 pt-3 first:border-t-0 first:pt-0">
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => go({ name: 'card-edit', id: item.card.id })}
                    >
                      <span>
                        {item.card.name}
                        {cover && (
                          <span className="mt-0.5 block text-xs text-stone-500">Cubre {cover.fund.name}</span>
                        )}
                      </span>
                    </button>
                    <span className="flex items-center gap-1">
                      <span className="tabular-nums">{formatUsd(item.saldoCents)}</span>
                      <PencilBtn onClick={() => go({ name: 'card-edit', id: item.card.id })} />
                    </span>
                  </div>
                  {item.limiteCents != null && (
                    <p className="mt-1 text-xs text-stone-500">
                      Límite {formatUsd(item.limiteCents)} · gastado {formatUsd(item.saldoCents)} · disponible{' '}
                      {formatUsd(item.disponibleTarjetaCents ?? 0)}
                    </p>
                  )}
                  <label className="mt-3 block text-sm">
                    Debo ahora (USD)
                    <input
                      className="mt-1 w-full rounded-2xl border border-emerald-950/10 bg-white px-4 py-3 tabular-nums"
                      value={owedDrafts[item.card.id] ?? centsToInput(item.saldoCents)}
                      onChange={(event) =>
                        setOwedDrafts((current) => ({ ...current, [item.card.id]: event.target.value }))
                      }
                      inputMode="decimal"
                    />
                  </label>
                  <ActionBtn
                    icon={Scale}
                    label="Cuadrar"
                    className="mt-2"
                    disabled={busy}
                    onClick={() =>
                      openCuadre(
                        item.card.id,
                        item.card.name,
                        item.saldoCents,
                        owedDrafts[item.card.id] ?? centsToInput(item.saldoCents),
                      )
                    }
                  />
                </li>
              );
            })}
          </ul>
        </CollapsibleCard>
      )}

      <CollapsibleCard
        id="account.funds"
        title="Fondos"
        defaultOpen
        actions={
          <button type="button" className="text-sm text-emerald-900" onClick={() => go({ name: 'fund-edit' })}>
            Nuevo
          </button>
        }
      >
        {accountFunds.length === 0 ? (
          <p className="text-sm text-stone-500">Esta cuenta aún no tiene fondos.</p>
        ) : (
          <DataTable
            caption="Fondos de la cuenta"
            columns={[
              { key: 'nombre', label: 'Nombre' },
              { key: 'tipo', label: 'Tipo' },
              { key: 'monto', label: 'Apartado', numeric: true },
              { key: 'acciones', label: '' },
            ]}
          >
            {accountFunds.map((item) => (
              <DataRow key={item.fund.id} onOpen={() => go({ name: 'fund-edit', id: item.fund.id })}>
                <DataCell>
                  {item.fund.name}
                  {item.fund.purpose ? (
                    <span className="mt-0.5 block text-xs text-stone-500">{item.fund.purpose}</span>
                  ) : null}
                </DataCell>
                <DataCell nowrap>{item.fund.segment === 'SAVINGS' ? 'Fondo · ahorro' : 'Fondo'}</DataCell>
                <DataCell numeric>{formatUsd(item.reservedCents)}</DataCell>
                <EditCell onEdit={() => go({ name: 'fund-edit', id: item.fund.id })} />
              </DataRow>
            ))}
          </DataTable>
        )}
      </CollapsibleCard>
      <CollapsibleCard id="account.reservas" title="Reservas activas">
        {reservations.filter(
          (res) => res.status === 'ACTIVE' && accountFunds.some((item) => item.fund.id === res.fundId),
        ).length === 0 ? (
          <p className="text-sm text-stone-500">No hay reservas activas en esta cuenta.</p>
        ) : (
          <ul className="space-y-3 text-sm">
          {reservations
            .filter((res) => res.status === 'ACTIVE' && accountFunds.some((item) => item.fund.id === res.fundId))
            .map((res) => (
              <li key={res.id} className="border-t border-stone-200/80 pt-3 first:border-t-0 first:pt-0">
                <div className="flex justify-between gap-3">
                  <span>{accountFunds.find((item) => item.fund.id === res.fundId)?.fund.name}</span>
                  <span className="tabular-nums">{formatUsd(res.amountCents)}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <ActionBtn
                    icon={Banknote}
                    label="Gastar apartado"
                    variant="secondary"
                    onClick={() => go({ name: 'move', fundId: res.fundId })}
                  />
                  <ActionBtn
                    icon={Unlock}
                    label="Liberar"
                    onClick={() => {
                      setMessage(null);
                      setReservationAction({
                        kind: 'release',
                        reservation: res,
                        amount: centsToInput(res.amountCents),
                        toAccountId: releaseDestinationAccountIds[0] ?? '',
                      });
                    }}
                  />
                  <ActionBtn
                    icon={Pencil}
                    label="Cambiar monto"
                    variant="ghost"
                    onClick={() => {
                      setMessage(null);
                      setReservationAction({
                        kind: 'change',
                        reservation: res,
                        amount: centsToInput(res.amountCents),
                        toAccountId: '',
                      });
                    }}
                  />
                </div>
              </li>
            ))}
        </ul>
        )}
      </CollapsibleCard>
      {baseConfirm && (
        <ConfirmDialog
          title="¿Registrar ajuste de saldo?"
          confirmLabel="Sí, registrar ajuste"
          busy={busy}
          onCancel={() => setBaseConfirm(null)}
          onConfirm={() => void confirmBase()}
        >
          <p>
            Nuevo saldo {formatUsd(baseConfirm.targetCents)}. La diferencia queda en el historial como ajuste. No es un
            cambio silencioso.
          </p>
          {message && <p className="text-sm text-red-800">{message}</p>}
        </ConfirmDialog>
      )}
      {cuadre && (
        <ConfirmDialog
          title={`¿Cuadrar ${cuadre.cardName}?`}
          confirmLabel="Sí, registrar ajuste"
          busy={busy}
          onCancel={() => setCuadre(null)}
          onConfirm={() => void confirmCuadre()}
        >
          <p>{cuadre.summary}</p>
          <p>No es un cargo nuevo ni saca efectivo de Barras. Queda en el historial como ajuste.</p>
          {message && <p className="text-sm text-red-800">{message}</p>}
        </ConfirmDialog>
      )}
      {reservationAction && (
        <ConfirmDialog
          title={reservationAction.kind === 'release' ? '¿Liberar este apartado?' : '¿Cambiar el apartado?'}
          confirmLabel={reservationAction.kind === 'release' ? 'Sí, liberar' : 'Sí, cambiar'}
          busy={busy}
          onCancel={() => setReservationAction(null)}
          onConfirm={() => void confirmReservationAction()}
        >
          {reservationAction.kind === 'release' ? (
            destAccounts.length === 0 ? (
              <p>
                No hay cuentas destino de liberación. Configúralas en Ajustes → Control.{' '}
                <button type="button" className="text-duty" onClick={() => go({ name: 'settings', tab: 'control' })}>
                  Abrir control
                </button>
              </p>
            ) : (
              <p>No es un gasto. El historial se conserva. Elige la cuenta que recibe el desembolso.</p>
            )
          ) : (
            <p>Se libera el actual y se aparta el nuevo monto. El historial se conserva.</p>
          )}
          {reservationAction.kind === 'release' && destAccounts.length > 0 && (
            <label className="block text-sm text-emerald-950">
              Cuenta destino
              <select
                className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
                value={reservationAction.toAccountId}
                onChange={(event) =>
                  setReservationAction({ ...reservationAction, toAccountId: event.target.value })
                }
                title="Cuentas marcadas en Ajustes → Control. No se listan cuentas privadas."
                aria-label="Cuenta destino de la liberación"
              >
                {destAccounts.map((item) => (
                  <option key={item.account.id} value={item.account.id}>
                    {item.account.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="block text-sm text-emerald-950">
            Monto (USD)
            <input
              className="mt-1 w-full rounded-2xl bg-stone-100 p-3 tabular-nums"
              value={reservationAction.amount}
              onChange={(event) =>
                setReservationAction({ ...reservationAction, amount: event.target.value })
              }
            />
          </label>
          {message && <p className="text-sm text-red-800">{message}</p>}
        </ConfirmDialog>
      )}
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile">
      <p className="text-[0.65rem] uppercase tracking-[0.2em] text-stone-500">{label}</p>
      <p className="mt-2 text-lg tabular-nums">{value}</p>
    </div>
  );
}

function kindLabel(kind: string) {
  if (kind === 'CASH') return 'Efectivo';
  if (kind === 'FUND_HOLDER') return 'Tenedora de fondos';
  if (kind === 'CREDIT') return 'Crédito';
  return 'Banco';
}
