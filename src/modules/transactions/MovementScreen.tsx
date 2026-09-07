import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Ban, CreditCard, Landmark, Pencil, Wallet } from 'lucide-react';
import {
  assignGastoToBudgetItem,
  budgetItemsForAccount,
  DomainError,
  centsToInput,
  correctTransaction,
  describeMovement,
  describeVoidEffect,
  executeBudgetCover,
  formatUsd,
  injectBudgetedFortnightReserves,
  emptyFundToAvailable,
  emptyFundsToAvailable,
  emptyFundThenSpendFromLeftover,
  RELEASE_DESTINATIONS_EMPTY_MESSAGE,
  isOperatingExpenseBeyondHorizon,
  movementTypeLabel,
  parseUsdToCents,
  planBudgetCover,
  planReserveCover,
  postAjuste,
  postAporte,
  postCardCharge,
  postCardPayment,
  postGasto,
  postGastoX,
  postIngreso,
  postLiberacion,
  postReserva,
  postTransferencia,
  coverCashExpenseFromFund,
  voidTransaction,
  isBarrasAccount,
  isSavingsAccount,
  type BudgetCoverMode,
  type CardChargeClass,
  type CoverageStatus,
} from '../../domain';
import type { LedgerTx } from '../../domain/ledger';
import { errorMessage } from '../../App';
import { useFinance, type MoveIntent } from '../../stores/financeStore';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ActionBtn, BackLink } from '../ui/Icon';

const TYPES: { id: string; label: string }[] = [
  { id: 'INGRESO', label: 'Ingreso' },
  { id: 'GASTO', label: 'Gasto (efectivo)' },
  { id: 'CARGO_TARJETA', label: 'Gasto con tarjeta' },
  { id: 'PAGO_TARJETA', label: 'Pagar tarjeta' },
  { id: 'TRANSFERENCIA', label: 'Transferencia' },
  { id: 'APORTE', label: 'Aporte' },
  { id: 'RESERVA', label: 'Reserva' },
  { id: 'LIBERACION_RESERVA', label: 'Liberar reserva' },
  { id: 'AJUSTE', label: 'Ajuste' },
];

function typeFromIntent(intent?: MoveIntent): string {
  if (intent === 'GASTAR' || intent === 'GASTAR_APARTADO') return 'GASTO';
  if (intent === 'FONDOS') return 'FONDOS';
  if (intent === 'GASTO_X') return 'GASTO_X';
  if (intent === 'PAGO_TARJETA') return 'PAGO_TARJETA';
  if (
    intent === 'GASTO' ||
    intent === 'CARGO_TARJETA' ||
    intent === 'TRANSFERENCIA' ||
    intent === 'APORTE' ||
    intent === 'RESERVA'
  ) {
    return intent;
  }
  return 'GASTO';
}

function intentFormTitle(intent?: MoveIntent): string {
  switch (intent) {
    case 'GASTAR':
    case 'GASTO':
    case 'GASTAR_APARTADO':
      return 'Gastar';
    case 'GASTO_X':
      return 'Gastos X';
    case 'CARGO_TARJETA':
      return 'Gastar';
    case 'TRANSFERENCIA':
      return 'Mover';
    case 'APORTE':
      return 'Aporte a ahorros';
    case 'RESERVA':
      return 'Apartar';
    case 'FONDOS':
      return 'Fondos';
    case 'PAGO_TARJETA':
      return 'Pagar ONE';
    default:
      return 'Movimiento';
  }
}

type SpendMedium = 'BARRAS' | 'ONE' | 'GASTO_X' | 'BOLSILLO_A' | 'BOLSILLO_Z';
type SpendCover = 'FUND' | 'LEFTOVER' | 'EMPTY_THEN_LEFTOVER' | 'PERSONAL';

const COVER_MODES: { id: BudgetCoverMode; label: string; hint: string }[] = [
  {
    id: 'AUTO',
    label: 'Consumir apartado (parcial ok)',
    hint: 'Gasta lo indicado del apartado. Si el gasto es mayor, el resto sale del disponible de esta cuenta.',
  },
  {
    id: 'PAY_NOW',
    label: 'Pagar ya con el presupuesto',
    hint: 'Igual: consume apartado y el sobrecosto sale del disponible. No toma otros fondos.',
  },
  {
    id: 'RESERVE_ONLY',
    label: 'Solo apartar (retenido)',
    hint: 'No hay gasto todavía. El dinero queda apartado en el fondo.',
  },
];

export function MovementScreen({
  transactionId,
  fundId: prefillFundId,
  intent,
  gastoX = false,
  startEditing = false,
}: {
  transactionId?: string;
  fundId?: string;
  intent?: MoveIntent;
  gastoX?: boolean;
  startEditing?: boolean;
}) {
  const store = useFinance();
  const publicAccounts = store.balances.filter((row) => row.account.visibility === 'PUBLIC');
  const releaseDestAccounts = store.balances.filter((row) =>
    store.releaseDestinationAccountIds.includes(row.account.id),
  );
  const editingRow = transactionId
    ? store.transactions.find((row) => row.id === transactionId)
    : undefined;
  const editingSplits = transactionId ? (store.splitsByTx.get(transactionId) ?? []) : [];
  const immutable = Boolean(editingRow && (editingRow.status === 'VOID' || editingRow.reversesId));

  const [type, setType] = useState<string>('GASTO');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [occurredAt, setOccurredAt] = useState<string | undefined>(undefined);
  const [accountId, setAccountId] = useState(publicAccounts[0]?.account.id ?? '');
  const [fromId, setFromId] = useState(publicAccounts[0]?.account.id ?? '');
  const [toId, setToId] = useState(publicAccounts[1]?.account.id ?? publicAccounts[0]?.account.id ?? '');
  const [fundId, setFundId] = useState('');
  const [toFundId, setToFundId] = useState('');
  const [personId, setPersonId] = useState(
    () => store.people.find((row) => row.code === 'Z')?.id ?? 'person-z',
  );
  const [reservationId, setReservationId] = useState('');
  const [releaseToId, setReleaseToId] = useState(store.releaseDestinationAccountIds[0] ?? '');
  const [budgetItemId, setBudgetItemId] = useState('');
  const [coverMode, setCoverMode] = useState<BudgetCoverMode>('AUTO');
  const [coverAmount, setCoverAmount] = useState('');
  const [cardId, setCardId] = useState(store.cards[0]?.card.id ?? '');
  const [spendMedium, setSpendMedium] = useState<SpendMedium>('BARRAS');
  const [spendCover, setSpendCover] = useState<SpendCover>('FUND');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingCents, setPendingCents] = useState<number | null>(null);
  const [pendingCoverCents, setPendingCoverCents] = useState<number | null>(null);
  const [pendingKind, setPendingKind] = useState<'save' | 'void' | null>(null);
  const [editing, setEditing] = useState(() => startEditing || !transactionId);

  useEffect(() => {
    if (!transactionId || !editingRow) return;
    const draft = describeMovement(editingRow, editingSplits, store.reservations);
    setType(draft.type);
    setAmount(centsToInput(draft.amountCents));
    setNote(draft.note);
    setOccurredAt(draft.occurredAt);
    if (draft.accountId) setAccountId(draft.accountId);
    if (draft.fromAccountId) setFromId(draft.fromAccountId);
    if (draft.toAccountId) setToId(draft.toAccountId);
    setFundId(draft.fundId);
    setToFundId(draft.toFundId);
    if (draft.personId) setPersonId(draft.personId);
    if (draft.reservationId) setReservationId(draft.reservationId);
    if (draft.toAccountId) setReleaseToId(draft.toAccountId);
    if (draft.cardId) setCardId(draft.cardId);
    const match = store.budgetItems.find((item) => item.active && item.coverFundId === draft.fundId);
    setBudgetItemId(match?.id ?? '');
    setCoverMode('AUTO');
    // Hydrate once per movement id; store snapshots would otherwise reset in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionId, editingRow?.id]);

  useEffect(() => {
    if (transactionId || !prefillFundId) return;
    const cover = store.funds.find((row) => row.fund.id === prefillFundId);
    if (!cover) return;
    setType('GASTO');
    setAccountId(cover.fund.accountId);
    setFundId(cover.fund.id);
    const match = store.budgetItems.find((item) => item.active && item.coverFundId === prefillFundId);
    setBudgetItemId(match?.id ?? '');
    setCoverMode('AUTO');
    setCoverAmount(cover.reservedCents > 0 ? centsToInput(cover.reservedCents) : '0.00');
    // Prefill from the account reservation once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillFundId, transactionId]);

  useEffect(() => {
    if (transactionId || !intent) return;
    setType(typeFromIntent(intent));
    if (intent === 'PAGO_TARJETA') {
      const payer =
        store.balances.find((row) => row.account.isCardPaymentSource && row.account.kind === 'CREDIT') ??
        store.balances.find((row) => row.account.isCardPaymentSource);
      if (payer) setAccountId(payer.account.id);
    }
    if (intent === 'GASTAR' || intent === 'GASTO' || intent === 'GASTAR_APARTADO') {
      const barras = publicAccounts.find((row) => isBarrasAccount(row.account));
      if (barras) setAccountId(barras.account.id);
      setSpendMedium('BARRAS');
      setSpendCover('FUND');
    }
    if (intent === 'CARGO_TARJETA') {
      setSpendMedium('ONE');
      setSpendCover('FUND');
    }
    if (intent === 'GASTO_X') {
      const nonBarras = publicAccounts.find((row) => !isBarrasAccount(row.account));
      if (nonBarras) setAccountId(nonBarras.account.id);
      setSpendMedium('GASTO_X');
      setSpendCover('PERSONAL');
    }
    if (intent === 'TRANSFERENCIA') {
      const savings = publicAccounts.filter((row) => isSavingsAccount(row.account));
      if (savings.length >= 2) {
        setFromId(savings[0]!.account.id);
        setToId(savings[1]!.account.id);
      } else if (savings.length === 1) {
        const other = publicAccounts.find((row) => row.account.id !== savings[0]!.account.id);
        setFromId(savings[0]!.account.id);
        if (other) setToId(other.account.id);
      }
    }
    if (intent === 'APORTE') {
      const savings = publicAccounts.filter((row) => isSavingsAccount(row.account));
      if (savings[0]) setAccountId(savings[0].account.id);
    }
    // Intent only seeds the form; later field edits must stick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, transactionId]);

  const originAccountId = type === 'TRANSFERENCIA' ? fromId : accountId;
  const selectedOrigin = publicAccounts.find((row) => row.account.id === originAccountId);
  const selectedDest = publicAccounts.find((row) => row.account.id === toId);
  const originFunds = useMemo(
    () => store.funds.filter((item) => item.fund.accountId === originAccountId),
    [store.funds, originAccountId],
  );
  const destFunds = useMemo(
    () => store.funds.filter((item) => item.fund.accountId === toId),
    [store.funds, toId],
  );
  const transferDestAccounts = fundId ? releaseDestAccounts : publicAccounts;

  useEffect(() => {
    if (transactionId) return;
    if (releaseToId && store.releaseDestinationAccountIds.includes(releaseToId)) return;
    setReleaseToId(store.releaseDestinationAccountIds[0] ?? '');
  }, [store.releaseDestinationAccountIds, releaseToId, transactionId]);

  useEffect(() => {
    if (transactionId || type !== 'TRANSFERENCIA' || !fundId) return;
    if (store.releaseDestinationAccountIds.includes(toId)) return;
    setToId(store.releaseDestinationAccountIds[0] ?? '');
  }, [transactionId, type, fundId, store.releaseDestinationAccountIds, toId]);
  const activeReservations = store.reservations.filter((row) => row.status === 'ACTIVE');

  const budgeted = useMemo(
    () =>
      budgetItemsForAccount(store.budgetItems, store.funds, accountId).filter(
        (item) => item.active && !isOperatingExpenseBeyondHorizon(item, store.funds),
      ),
    [store.budgetItems, store.funds, accountId],
  );
  const selectedBudget = budgeted.find((item) => item.id === budgetItemId);
  const selectedFund = store.funds.find((item) => item.fund.id === fundId);
  const selectedCard = store.cards.find((item) => item.card.id === cardId);
  const cardCover = selectedCard?.card.coverFundId
    ? store.funds.find((item) => item.fund.id === selectedCard.card.coverFundId)
    : undefined;
  const coverPlan =
    type === 'GASTO' &&
    selectedBudget &&
    selectedOrigin &&
    selectedFund &&
    pendingCents != null &&
    coverMode === 'RESERVE_ONLY'
      ? planBudgetCover({
          mode: coverMode,
          amountCents: pendingCents,
          reservedCents: selectedFund.reservedCents,
          availableCents: selectedOrigin.disponibleCents,
          fundName: selectedFund.fund.name,
          accountName: selectedOrigin.account.name,
        })
      : null;
  const reserveCoverPlan =
    type === 'GASTO' &&
    selectedBudget &&
    selectedOrigin &&
    selectedFund &&
    pendingCents != null &&
    pendingCoverCents != null &&
    coverMode !== 'RESERVE_ONLY'
      ? planReserveCover({
          amountCents: pendingCents,
          reservedCents: selectedFund.reservedCents,
          availableCents: selectedOrigin.disponibleCents,
          coverFromReserveCents: pendingCoverCents,
          fundName: selectedFund.fund.name,
          accountName: selectedOrigin.account.name,
        })
      : null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    try {
      const total = parseUsdToCents(amount);
      setPendingKind('save');
      setPendingCents(total);
      if (budgetItemId && type === 'GASTO' && coverMode !== 'RESERVE_ONLY') {
        const reserved = selectedFund?.reservedCents ?? 0;
        const indicated = coverAmount.trim() ? parseUsdToCents(coverAmount) : Math.min(total, reserved);
        setPendingCoverCents(indicated);
      } else {
        setPendingCoverCents(null);
      }
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function confirmPost() {
    if (!store.ledger || pendingCents == null) return;
    setBusy(true);
    setMessage(null);
    try {
      const amountCents = pendingCents;
      await store.ledger.withTransaction(async (tx) => {
        const isCashBudgetCover = type === 'GASTO' && Boolean(budgetItemId);
        const assignPartial =
          isCashBudgetCover && coverMode !== 'RESERVE_ONLY' && pendingCoverCents != null;
        if (transactionId) {
          if (assignPartial) {
            await voidTransaction(tx, transactionId);
            await assignGastoToBudgetItem(tx, {
              budgetItemId,
              accountId,
              amountCents,
              coverFromReserveCents: pendingCoverCents,
              note,
              occurredAt,
            });
            return;
          }
          if (isCashBudgetCover) {
            await voidTransaction(tx, transactionId);
            await executeBudgetCover(tx, {
              budgetItemId,
              accountId,
              amountCents,
              mode: coverMode,
              note,
              occurredAt,
            });
            return;
          }
          await correctTransaction(tx, transactionId, {
            type,
            amountCents,
            note,
            occurredAt,
            accountId,
            fromAccountId: fromId,
            toAccountId: toId,
            fundId: fundId || null,
            toFundId: toFundId || null,
            personId,
            cardId,
            reservationId,
          });
          return;
        }
        const unifiedSpend =
          intent === 'GASTAR' ||
          intent === 'GASTO' ||
          intent === 'GASTO_X' ||
          intent === 'CARGO_TARJETA' ||
          intent === 'GASTAR_APARTADO';
        if (unifiedSpend) {
          await postUnifiedSpend(tx, {
            spendMedium,
            spendCover,
            amountCents,
            note,
            accountId,
            fundId,
            budgetItemId,
            coverMode,
            pendingCoverCents,
            cardId,
            barrasAccountId: publicAccounts.find((row) => isBarrasAccount(row.account))?.account.id ?? accountId,
          });
          return;
        }
        if (assignPartial) {
          await assignGastoToBudgetItem(tx, {
            budgetItemId,
            accountId,
            amountCents,
            coverFromReserveCents: pendingCoverCents,
            note,
          });
          return;
        }
        if (isCashBudgetCover) {
          await executeBudgetCover(tx, {
            budgetItemId,
            accountId,
            amountCents,
            mode: coverMode,
            note,
          });
          return;
        }
        switch (type) {
          case 'INGRESO':
            await postIngreso(tx, { accountId, amountCents, note });
            break;
          case 'GASTO':
            await postGasto(tx, { accountId, amountCents, fundId: fundId || null, note });
            break;
          case 'GASTO_X':
            await postGastoX(tx, { accountId, amountCents, note });
            break;
          case 'CARGO_TARJETA':
            await postCardCharge(tx, {
              cardId,
              amountCents,
              note,
              gastoX,
            });
            break;
          case 'PAGO_TARJETA':
            await postCardPayment(tx, {
              cardId,
              fromAccountId: accountId,
              amountCents,
              note,
            });
            break;
          case 'TRANSFERENCIA':
            await postTransferencia(tx, {
              fromAccountId: fromId,
              toAccountId: toId,
              amountCents,
              fromFundId: fundId || null,
              toFundId: toFundId || null,
              note,
            });
            break;
          case 'APORTE':
            await postAporte(tx, { personId, toAccountId: accountId, amountCents, note });
            break;
          case 'RESERVA':
            await postReserva(tx, { fundId, amountCents, note });
            break;
          case 'LIBERACION_RESERVA':
            await postLiberacion(tx, { reservationId, amountCents, note, toAccountId: releaseToId });
            break;
          case 'AJUSTE':
            await postAjuste(tx, { accountId, amountCents, note });
            break;
        }
      });
      await store.refresh();
      store.go(transactionId ? { name: 'movements' } : { name: 'dashboard' });
    } catch (error) {
      setMessage(errorMessage(error));
      setPendingCents(null);
      setPendingCoverCents(null);
      setPendingKind(null);
    } finally {
      setBusy(false);
    }
  }

  async function confirmVoid() {
    if (!store.ledger || !transactionId) return;
    setBusy(true);
    setMessage(null);
    try {
      await store.ledger.withTransaction((tx) => voidTransaction(tx, transactionId));
      await store.refresh();
      store.go({ name: 'movements' });
    } catch (error) {
      setMessage(errorMessage(error));
      setPendingCents(null);
      setPendingCoverCents(null);
      setPendingKind(null);
    } finally {
      setBusy(false);
    }
  }

  function selectAccount(value: string) {
    setAccountId(value);
    setBudgetItemId('');
    if (fundId && !store.funds.some((row) => row.fund.id === fundId && row.fund.accountId === value)) {
      setFundId('');
    }
  }

  const gastoHint =
    reserveCoverPlan?.summary ??
    coverPlan?.summary ??
    (selectedBudget
      ? `Sale del presupuesto ${selectedBudget.name}${selectedFund ? ` (apartado ${formatUsd(selectedFund.reservedCents)})` : ''}.`
      : fundId
        ? `Sale del fondo ${selectedFund?.fund.name ?? fundId}. Baja saldo y apartado.`
        : `Sale del disponible de ${selectedOrigin?.account.name ?? 'la cuenta'}. El apartado no se toca.`);

  const payerAccounts = publicAccounts.filter((row) => row.account.isCardPaymentSource);
  const draft =
    editingRow && transactionId ? describeMovement(editingRow, editingSplits, store.reservations) : null;
  const lockedIntent = Boolean(intent && !transactionId);
  const unifiedSpendForm =
    lockedIntent &&
    (intent === 'GASTAR' ||
      intent === 'GASTO' ||
      intent === 'GASTO_X' ||
      intent === 'CARGO_TARJETA' ||
      intent === 'GASTAR_APARTADO');
  const gastoXAccounts = publicAccounts.filter((row) => !isBarrasAccount(row.account));

  if (!transactionId && intent === 'FONDOS') {
    return <FundsOpsPanel />;
  }

  if (!transactionId && lockedIntent) {
    if ((type === 'GASTO' || type === 'GASTO_X' || type === 'APORTE' || type === 'AJUSTE' || type === 'INGRESO') && publicAccounts.length === 0) {
      return (
        <div className="space-y-3">
          <BackLink />
          <p className="rounded-2xl bg-stone-100 px-4 py-3 text-sm text-stone-700">
            Sin cuentas públicas todavía. Configura el catálogo en Ajustes cuando importes datos.
          </p>
        </div>
      );
    }
    if (type === 'GASTO_X' && gastoXAccounts.length === 0) {
      return (
        <div className="space-y-3">
          <BackLink />
          <p className="rounded-2xl bg-stone-100 px-4 py-3 text-sm text-stone-700">
            Gastos X no usan Barras. Añade otra cuenta pública en Ajustes.
          </p>
        </div>
      );
    }
    if ((type === 'CARGO_TARJETA' || type === 'PAGO_TARJETA') && store.cards.length === 0) {
      return (
        <div className="space-y-3">
          <BackLink />
          <p className="rounded-2xl bg-stone-100 px-4 py-3 text-sm text-stone-700">
            Sin tarjetas en el catálogo. Configura ONE en Ajustes.
          </p>
        </div>
      );
    }
    if (type === 'RESERVA' && store.funds.length === 0) {
      return (
        <div className="space-y-3">
          <BackLink />
          <p className="rounded-2xl bg-stone-100 px-4 py-3 text-sm text-stone-700">
            Sin fondos todavía. Importa el catálogo o crea fondos en Ajustes.
          </p>
        </div>
      );
    }
  }

  if (transactionId && !editingRow) {
    return (
      <div className="space-y-3">
        <BackLink />
        <p>Movimiento no encontrado.</p>
      </div>
    );
  }

  if (transactionId && editingRow && draft && !editing) {
    const accountName =
      store.accounts.find((item) => item.id === draft.accountId)?.name ??
      store.accounts.find((item) => item.id === draft.fromAccountId)?.name;
    const fromName = store.accounts.find((item) => item.id === draft.fromAccountId)?.name;
    const toName = store.accounts.find((item) => item.id === draft.toAccountId)?.name;
    const fundName = store.funds.find((item) => item.fund.id === draft.fundId)?.fund.name;
    const toFundName = store.funds.find((item) => item.fund.id === draft.toFundId)?.fund.name;
    const cardName = store.cards.find((item) => item.card.id === draft.cardId)?.card.name;
    const personName = store.people.find((item) => item.id === draft.personId)?.displayName;
    const charge = store.cardCharges.find((item) => item.transactionId === transactionId);
    return (
      <>
        <div className="mb-3">
          <BackLink />
        </div>
        <section className="card space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-stone-500">
                {movementTypeLabel(draft.type)}
                {editingRow.status === 'VOID' ? ' · anulado' : ''}
              </p>
              <h2 className="mt-1 font-display text-4xl tabular-nums">{formatUsd(draft.amountCents)}</h2>
              <p className="mt-2 text-sm text-stone-600">{draft.note || 'Sin nota'}</p>
            </div>
            {!immutable && (
              <ActionBtn icon={Pencil} label="Editar" variant="secondary" onClick={() => setEditing(true)} />
            )}
          </div>
          <dl className="space-y-2 text-sm">
            <Fact label="Estado" value={editingRow.status === 'VOID' ? 'Anulado' : 'Registrado'} />
            <Fact label="Fecha" value={new Date(draft.occurredAt).toLocaleString()} />
            {accountName && <Fact label="Cuenta" value={accountName} />}
            {draft.type === 'TRANSFERENCIA' && fromName && toName && (
              <Fact label="De → a" value={`${fromName} → ${toName}`} />
            )}
            {cardName && <Fact label="Tarjeta" value={cardName} />}
            {fundName && <Fact label="Fondo" value={fundName} />}
            {toFundName && <Fact label="Fondo destino" value={toFundName} />}
            {personName && <Fact label="Persona" value={personName} />}
            {charge && (
              <>
                <Fact label="Clase" value={chargeClassLabel(charge.chargeClass)} />
                <Fact label="Cobertura" value={coverageLabel(charge.coverageStatus)} />
              </>
            )}
          </dl>
          {immutable ? (
            <p className="text-sm text-stone-600">Este movimiento ya está anulado. El historial se conserva.</p>
          ) : (
            <p className="text-sm text-stone-600">Corregir anula el original y registra el nuevo. No se borra.</p>
          )}
          {message && <p className="text-sm text-red-800">{message}</p>}
          {!immutable && (
            <ActionBtn
              icon={Ban}
              label="Eliminar"
              title="Anula este movimiento (VOID + inversa). El historial no se borra."
              variant="secondary"
              className="w-full"
              disabled={busy}
              onClick={() => {
                setPendingKind('void');
                setPendingCents(0);
              }}
            />
          )}
        </section>
        {pendingKind === 'void' && (
          <ConfirmDialog
            title="¿Eliminar este movimiento?"
            confirmLabel="Sí, anular"
            busy={busy}
            onCancel={() => {
              setPendingCents(null);
              setPendingKind(null);
            }}
            onConfirm={() => void confirmVoid()}
          >
            <p>{describeVoidEffect(editingRow, editingSplits)}</p>
          </ConfirmDialog>
        )}
      </>
    );
  }

  return (
    <>
      <div className="mb-3">
        <BackLink />
      </div>
      {transactionId && (
        <p className="mb-3 text-sm text-stone-600">
          {immutable
            ? 'Este movimiento ya está anulado.'
            : 'Corregir anula el original y registra el nuevo.'}
        </p>
      )}
      <form onSubmit={submit} className="space-y-4 rounded-3xl bg-white/80 p-4">
        {lockedIntent ? (
          <h2 className="font-display text-2xl text-ink">{intentFormTitle(intent)}</h2>
        ) : (
          <FieldSelect
            label="Tipo"
            value={type}
            onChange={(value) => setType(value)}
            options={TYPES.map((item) => ({ id: item.id, label: item.label }))}
          />
        )}

        {unifiedSpendForm && (
          <UnifiedSpendFields
            spendMedium={spendMedium}
            spendCover={spendCover}
            onMedium={(value) => {
              setSpendMedium(value);
              if (value === 'GASTO_X') {
                const nonBarras = gastoXAccounts[0];
                if (nonBarras) setAccountId(nonBarras.account.id);
                setSpendCover('PERSONAL');
              } else if (value === 'BOLSILLO_A' || value === 'BOLSILLO_Z') {
                setSpendCover('PERSONAL');
              } else if (value === 'BARRAS') {
                const barras = publicAccounts.find((row) => isBarrasAccount(row.account));
                if (barras) setAccountId(barras.account.id);
                if (spendCover === 'PERSONAL') setSpendCover('FUND');
              } else if (spendCover === 'PERSONAL') {
                setSpendCover('FUND');
              }
            }}
            onCover={setSpendCover}
            accountId={accountId}
            onAccount={selectAccount}
            fundId={fundId}
            onFund={(value) => {
              setFundId(value);
              const match = budgeted.find((item) => item.coverFundId === value);
              setBudgetItemId(match?.id ?? '');
            }}
            cardId={cardId}
            onCard={setCardId}
            personId={personId}
            onPerson={setPersonId}
            gastoXAccounts={gastoXAccounts}
            originFunds={originFunds}
            cards={store.cards}
            people={store.people}
            selectedOrigin={selectedOrigin}
            selectedFund={selectedFund}
            selectedCard={selectedCard}
            cardCover={cardCover}
          />
        )}

        {!unifiedSpendForm && type === 'GASTO_X' && (
          <>
            <FieldSelect
              label="Cuenta"
              value={accountId}
              onChange={selectAccount}
              options={gastoXAccounts.map((row) => ({
                id: row.account.id,
                label: `${row.account.name} · disp. ${formatUsd(row.disponibleUiCents)}`,
              }))}
            />
            <p className="rounded-2xl bg-emerald-950/5 px-4 py-3 text-sm">
              Gastos X no se mezclan con Barras ni con el presupuesto de casa.
            </p>
          </>
        )}

        {(type === 'INGRESO' || (!unifiedSpendForm && type === 'GASTO') || type === 'APORTE' || type === 'AJUSTE') && (
          <>
            <FieldSelect
              label="Cuenta"
              value={accountId}
              onChange={selectAccount}
              options={publicAccounts.map((row) => ({
                id: row.account.id,
                label: `${row.account.name} · disp. ${formatUsd(row.disponibleUiCents)}`,
              }))}
            />
            {selectedOrigin && (
              <p className="rounded-2xl bg-emerald-950/5 px-4 py-3 text-sm">
                Disponible en {selectedOrigin.account.name}:{' '}
                <strong className="tabular-nums">{formatUsd(selectedOrigin.disponibleUiCents)}</strong>
                <span className="mt-1 block text-xs text-stone-500">
                  Saldo {formatUsd(selectedOrigin.saldoCents)} · apartado {formatUsd(selectedOrigin.reservedCents)}
                </span>
              </p>
            )}
          </>
        )}

        {type === 'TRANSFERENCIA' && (
          <>
            <FieldSelect
              label="Desde"
              value={fromId}
              onChange={setFromId}
              title="Mover entre cuentas. No es un gasto."
              options={publicAccounts.map((row) => ({
                id: row.account.id,
                label: `${row.account.name} · disp. ${formatUsd(row.disponibleUiCents)}`,
              }))}
            />
            <FieldSelect
              label="Hacia"
              value={toId}
              onChange={setToId}
              options={transferDestAccounts.map((row) => ({
                id: row.account.id,
                label: `${row.account.name} · disp. ${formatUsd(row.disponibleUiCents)}`,
              }))}
            />
            {fundId && releaseDestAccounts.length === 0 && (
              <p className="rounded-2xl bg-emerald-950/5 px-4 py-3 text-sm">
                {RELEASE_DESTINATIONS_EMPTY_MESSAGE}{' '}
                <button type="button" className="text-duty" onClick={() => store.go({ name: 'settings', tab: 'control' })}>
                  Abrir control
                </button>
              </p>
            )}
            {selectedOrigin && (
              <p className="rounded-2xl bg-emerald-950/5 px-4 py-3 text-sm">
                Disponible en origen ({selectedOrigin.account.name}):{' '}
                <strong className="tabular-nums">{formatUsd(selectedOrigin.disponibleUiCents)}</strong>
                {selectedDest && selectedDest.account.id !== selectedOrigin.account.id && (
                  <span className="mt-1 block text-xs text-stone-500">
                    Destino {selectedDest.account.name}: {formatUsd(selectedDest.disponibleUiCents)}
                  </span>
                )}
              </p>
            )}
          </>
        )}

        {type === 'APORTE' && (
          <>
            <FieldSelect
            label="Quién aporta"
            value={personId}
            onChange={setPersonId}
            title="Aportan Z o A a una cuenta pública. El bolsillo privado no se muestra."
            options={[
              { id: 'person-z', label: 'Z' },
              { id: 'person-a', label: 'A' },
            ]}
          />
          </>
        )}

        {type === 'PAGO_TARJETA' && (
          <>
            <FieldSelect
              label="Tarjeta"
              value={cardId}
              onChange={setCardId}
              options={store.cards.map((item) => ({
                id: item.card.id,
                label: `${item.card.name} · debe ${formatUsd(item.saldoCents)}`,
              }))}
            />
            <FieldSelect
              label="Paga desde"
              value={accountId}
              onChange={setAccountId}
              title="ONE se paga solo desde Atlántida. No toca Barras."
              options={payerAccounts.map((row) => ({
                id: row.account.id,
                label: `${row.account.name} · disp. ${formatUsd(row.disponibleUiCents)}`,
              }))}
            />
          </>
        )}

        {!unifiedSpendForm && type === 'CARGO_TARJETA' && (
          <>
            <FieldSelect
              label="Tarjeta"
              value={cardId}
              onChange={setCardId}
              options={store.cards.map((item) => ({
                id: item.card.id,
                label:
                  item.limiteCents != null
                    ? `${item.card.name} · límite ${formatUsd(item.limiteCents)} · debe ${formatUsd(item.saldoCents)}`
                    : `${item.card.name} · sin límite · debe ${formatUsd(item.saldoCents)}`,
              }))}
            />
            {selectedCard && (
              <p className="rounded-2xl bg-emerald-950/5 px-4 py-3 text-sm">
                <span className="mb-1 flex items-center gap-2 font-medium text-emerald-950">
                  <CreditCard className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                  Gasto con tarjeta
                </span>
                {selectedCard.limiteCents != null ? (
                  <>
                    Cubre <strong>{cardCover?.fund.name ?? 'Ahorros 2'}</strong>. Cobertura disponible{' '}
                    <strong className="tabular-nums">{formatUsd(selectedCard.coberturaDisponibleCents)}</strong>
                    . No descuenta Barras ni el efectivo de Atlántida ahora.
                  </>
                ) : (
                  <>
                    Sin límite. El cargo no saca efectivo. Pago después solo desde Atlántida.
                    {cardCover ? ` Fondo asociado: ${cardCover.fund.name}.` : ''}
                  </>
                )}
              </p>
            )}
          </>
        )}

        {!unifiedSpendForm && type === 'GASTO' && (
          <>
            <FieldSelect
              label="Cubrir con presupuesto"
              value={budgetItemId}
              onChange={(value) => {
                setBudgetItemId(value);
                setCoverMode('AUTO');
                const item = budgeted.find((row) => row.id === value);
                if (!item?.coverFundId) return;
                const cover = store.funds.find((row) => row.fund.id === item.coverFundId);
                if (cover) {
                  setFundId(cover.fund.id);
                  setCoverAmount(cover.reservedCents > 0 ? centsToInput(cover.reservedCents) : '0.00');
                }
              }}
              options={[
                { id: '', label: 'Ninguna · usa disponible o un fondo' },
                ...budgeted.map((item) => {
                  const cover = store.funds.find((row) => row.fund.id === item.coverFundId);
                  const reserved = cover?.reservedCents ?? 0;
                  return {
                    id: item.id,
                    label: `${item.name} · apartado ${formatUsd(reserved)}`,
                  };
                }),
              ]}
            />
            {selectedBudget && selectedFund && selectedOrigin && (
              <div className="space-y-3 rounded-2xl bg-emerald-950/5 px-4 py-3 text-sm">
                <p>
                  Disponible en {selectedOrigin.account.name}:{' '}
                  <strong className="tabular-nums">{formatUsd(selectedOrigin.disponibleUiCents)}</strong>
                  <span className="mt-1 block text-xs text-stone-500">
                    Apartado de {selectedFund.fund.name}:{' '}
                    <strong className="tabular-nums">{formatUsd(selectedFund.reservedCents)}</strong>
                  </span>
                </p>
                <fieldset className="space-y-2">
                  <legend className="text-xs uppercase tracking-[0.18em] text-stone-500">Cómo cubrirlo</legend>
                  {COVER_MODES.map((mode) => (
                    <label key={mode.id} className="flex cursor-pointer gap-3 rounded-2xl bg-white/70 p-3">
                      <input
                        type="radio"
                        className="mt-1"
                        name="budget-cover-mode"
                        checked={coverMode === mode.id}
                        onChange={() => setCoverMode(mode.id)}
                      />
                      <span>
                        <span className="block font-medium text-emerald-950">{mode.label}</span>
                        <span className="block text-xs text-stone-500">{mode.hint}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                {coverMode !== 'RESERVE_ONLY' && (
                  <label className="block text-sm">
                    Cubrir con apartado (puede ser menos que el gasto)
                    <input
                      className="mt-1 w-full rounded-2xl bg-white p-3 tabular-nums"
                      value={coverAmount}
                      onChange={(event) => setCoverAmount(event.target.value)}
                      placeholder={centsToInput(selectedFund.reservedCents)}
                    />
                    <span className="mt-1 block text-xs text-stone-500">
                      Apartado {formatUsd(selectedFund.reservedCents)}. El resto del gasto sale del disponible
                      {selectedOrigin ? ` de ${selectedOrigin.account.name}` : ''} y cuenta como sobrecosto.
                    </span>
                  </label>
                )}
              </div>
            )}
          </>
        )}

        {!unifiedSpendForm && (type === 'GASTO' || type === 'TRANSFERENCIA') && (
          <FieldSelect
            label="Fondo origen (opcional)"
            value={fundId}
            onChange={(value) => {
              setFundId(value);
              const match = budgeted.find((item) => item.coverFundId === value);
              setBudgetItemId(match?.id ?? '');
              if (match) setCoverMode('AUTO');
            }}
            options={[
              { id: '', label: 'Sin fondo · usa disponible' },
              ...originFunds.map((item) => ({
                id: item.fund.id,
                label: `${item.fund.name} · apartado ${formatUsd(item.reservedCents)}`,
              })),
            ]}
          />
        )}

        {type === 'RESERVA' && (
          <FieldSelect
            label="Fondo"
            value={fundId}
            onChange={setFundId}
            options={store.funds.map((item) => ({ id: item.fund.id, label: item.fund.name }))}
          />
        )}

        {type === 'TRANSFERENCIA' && (
          <FieldSelect
            label="Fondo destino (opcional)"
            value={toFundId}
            onChange={setToFundId}
            options={[
              { id: '', label: 'Sin apartado en destino' },
              ...destFunds.map((item) => ({ id: item.fund.id, label: item.fund.name })),
            ]}
          />
        )}

        {type === 'LIBERACION_RESERVA' && (
          <>
            <FieldSelect
              label="Reserva"
              value={reservationId}
              onChange={setReservationId}
              options={activeReservations.map((row) => ({
                id: row.id,
                label: `${store.funds.find((item) => item.fund.id === row.fundId)?.fund.name ?? row.fundId}`,
              }))}
            />
            {releaseDestAccounts.length === 0 ? (
              <p className="rounded-2xl bg-emerald-950/5 px-4 py-3 text-sm">
                {RELEASE_DESTINATIONS_EMPTY_MESSAGE}{' '}
                <button type="button" className="text-duty" onClick={() => store.go({ name: 'settings', tab: 'control' })}>
                  Abrir control
                </button>
              </p>
            ) : (
              <FieldSelect
                label="Cuenta destino"
                value={releaseToId}
                onChange={setReleaseToId}
                options={releaseDestAccounts.map((row) => ({
                  id: row.account.id,
                  label: `${row.account.name} · disp. ${formatUsd(row.disponibleUiCents)}`,
                }))}
              />
            )}
          </>
        )}

        <label className="block text-sm">
          Monto (USD)
          <input
            className="mt-1 w-full rounded-2xl bg-stone-100 p-3 tabular-nums"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="50.00"
            required
          />
        </label>
        <label className="block text-sm">
          Nota
          <input
            className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        {message && <p className="text-sm text-red-800">{message}</p>}
        <button
          type="submit"
          title={transactionId ? 'Revisa la corrección. Anula el original y deja el nuevo; no borra el historial.' : 'Revisa el movimiento antes de registrarlo en el libro.'}
          disabled={busy || immutable}
          className="btn-primary w-full py-3"
        >
          {transactionId ? 'Revisar corrección' : 'Revisar y confirmar'}
        </button>
        {transactionId && !immutable && (
            <ActionBtn
              icon={Ban}
              label="Eliminar"
              title="Anula este movimiento (VOID + inversa). El historial no se borra."
              variant="secondary"
              className="w-full"
              disabled={busy}
              onClick={() => {
                setPendingKind('void');
                setPendingCents(0);
              }}
            />
        )}
      </form>
      {pendingKind === 'save' && pendingCents != null && (
        <ConfirmDialog
          title={
            coverMode === 'RESERVE_ONLY' && budgetItemId && type === 'GASTO'
              ? '¿Solo retener este monto?'
              : transactionId
                ? '¿Corregir este movimiento?'
                : '¿Registrar este movimiento?'
          }
          confirmLabel={
            coverMode === 'RESERVE_ONLY' && budgetItemId && type === 'GASTO'
              ? 'Sí, retener'
              : transactionId
                ? 'Sí, corregir'
                : 'Sí, registrar'
          }
          busy={busy}
          onCancel={() => {
            setPendingCents(null);
            setPendingCoverCents(null);
            setPendingKind(null);
          }}
          onConfirm={() => void confirmPost()}
        >
          <p>
            Tipo: <strong>{TYPES.find((item) => item.id === type)?.label ?? type}</strong>. Monto:{' '}
            <strong className="tabular-nums">{formatUsd(pendingCents)}</strong>.
          </p>
          {type === 'GASTO' && <p>{gastoHint}</p>}
          {reserveCoverPlan && (
            <ul className="space-y-1 text-sm">
              <li>
                Apartado: <strong className="tabular-nums">{formatUsd(reserveCoverPlan.reservedCents)}</strong>
              </li>
              <li>
                A consumir: <strong className="tabular-nums">{formatUsd(reserveCoverPlan.consumedCents)}</strong>
              </li>
              <li>
                A salir de disponible (exceso):{' '}
                <strong className="tabular-nums">{formatUsd(reserveCoverPlan.fromAvailableCents)}</strong>
              </li>
            </ul>
          )}
          {coverPlan?.rejection && <p className="text-red-800">{coverPlan.rejection}</p>}
          {reserveCoverPlan?.rejection && <p className="text-red-800">{reserveCoverPlan.rejection}</p>}
          {type === 'CARGO_TARJETA' && (
            <p>
              Cargo en {selectedCard?.card.name ?? 'la tarjeta'}. No saca efectivo de Barras ni de Atlántida ahora.
              {selectedCard?.limiteCents != null
                ? ` Se cubre con ${cardCover?.fund.name ?? 'Ahorros 2'} (disponible ${formatUsd(selectedCard.coberturaDisponibleCents)}).`
                : ' Sin límite: queda como deuda de tarjeta hasta pagarla desde Atlántida.'}
            </p>
          )}
          {type === 'PAGO_TARJETA' && (
            <p>
              Pago de {selectedCard?.card.name ?? 'ONE'} desde{' '}
              {publicAccounts.find((row) => row.account.id === accountId)?.account.name ?? 'Atlántida'}. Solo esa
              cuenta paga la tarjeta.
            </p>
          )}
          {type === 'TRANSFERENCIA' && (
            <p>
              De {publicAccounts.find((row) => row.account.id === fromId)?.account.name} a{' '}
              {publicAccounts.find((row) => row.account.id === toId)?.account.name}. Libera o mueve capital; no es un
              gasto.
            </p>
          )}
          {type === 'APORTE' && (
            <p>
              Aporte de {store.people.find((row) => row.id === personId)?.displayName ?? 'la persona'} a{' '}
              {publicAccounts.find((row) => row.account.id === accountId)?.account.name ?? 'ahorros'}. No es un gasto.
            </p>
          )}
          {type === 'AJUSTE' && <p>El ajuste queda en el historial. No es un cambio silencioso de saldo.</p>}
          {transactionId && (
            <p>La corrección anula el original y deja el nuevo movimiento. El historial se conserva.</p>
          )}
          {note && <p>Nota: {note}</p>}
        </ConfirmDialog>
      )}
      {pendingKind === 'void' && editingRow && (
        <ConfirmDialog
          title="¿Eliminar este movimiento?"
          confirmLabel="Sí, anular"
          busy={busy}
          onCancel={() => {
            setPendingCents(null);
            setPendingKind(null);
          }}
          onConfirm={() => void confirmVoid()}
        >
          <p>{describeVoidEffect(editingRow, editingSplits)}</p>
        </ConfirmDialog>
      )}
    </>
  );
}

async function postUnifiedSpend(
  tx: LedgerTx,
  input: {
    spendMedium: SpendMedium;
    spendCover: SpendCover;
    amountCents: number;
    note: string;
    accountId: string;
    fundId: string;
    budgetItemId: string;
    coverMode: BudgetCoverMode;
    pendingCoverCents: number | null;
    cardId: string;
    barrasAccountId: string;
  },
) {
  const { spendMedium, spendCover, amountCents, note, accountId, fundId, cardId } = input;

  if (spendMedium === 'GASTO_X') {
    await postGastoX(tx, { accountId, amountCents, note });
    return;
  }
  if (spendMedium === 'BOLSILLO_A' || spendMedium === 'BOLSILLO_Z') {
    await postCardCharge(tx, {
      cardId,
      amountCents,
      note,
      chargeClass: spendMedium === 'BOLSILLO_A' ? 'PERSONAL_A' : 'PERSONAL_Z',
    });
    return;
  }
  if (spendMedium === 'ONE') {
    if (spendCover === 'EMPTY_THEN_LEFTOVER' && fundId) {
      const fund = await tx.getFund(fundId);
      if (!fund) throw new DomainError('Fondo no encontrado');
      await emptyFundToAvailable(tx, { fundId, toAccountId: fund.accountId, note });
      await postCardCharge(tx, { cardId, amountCents, note, barrasLeftover: true });
      return;
    }
    if (spendCover === 'LEFTOVER') {
      await postCardCharge(tx, { cardId, amountCents, note, barrasLeftover: true });
      return;
    }
    await postCardCharge(tx, {
      cardId,
      amountCents,
      note,
      coverFundId: spendCover === 'FUND' && fundId ? fundId : null,
      barrasLeftover: spendCover !== 'FUND',
    });
    return;
  }

  const cashAccountId = input.barrasAccountId;
  if (spendCover === 'EMPTY_THEN_LEFTOVER' && fundId) {
    await emptyFundThenSpendFromLeftover(tx, {
      fundId,
      accountId: cashAccountId,
      amountCents,
      note,
    });
    return;
  }
  if (spendCover === 'LEFTOVER') {
    await postGasto(tx, { accountId: cashAccountId, amountCents, fundId: null, note });
    return;
  }
  if (input.budgetItemId && input.coverMode !== 'RESERVE_ONLY' && input.pendingCoverCents != null) {
    await assignGastoToBudgetItem(tx, {
      budgetItemId: input.budgetItemId,
      accountId: cashAccountId,
      amountCents,
      coverFromReserveCents: input.pendingCoverCents,
      note,
    });
    return;
  }
  if (input.budgetItemId) {
    await executeBudgetCover(tx, {
      budgetItemId: input.budgetItemId,
      accountId: cashAccountId,
      amountCents,
      mode: input.coverMode,
      note,
    });
    return;
  }
  if (fundId) {
    await coverCashExpenseFromFund(tx, {
      accountId: cashAccountId,
      fundId,
      amountCents,
      mode: 'AUTO',
      note,
    });
    return;
  }
  await postGasto(tx, { accountId: cashAccountId, amountCents, fundId: null, note });
}

function UnifiedSpendFields({
  spendMedium,
  spendCover,
  onMedium,
  onCover,
  accountId,
  onAccount,
  fundId,
  onFund,
  cardId,
  onCard,
  personId,
  onPerson,
  gastoXAccounts,
  originFunds,
  cards,
  people,
  selectedOrigin,
  selectedFund,
  selectedCard,
  cardCover,
}: {
  spendMedium: SpendMedium;
  spendCover: SpendCover;
  onMedium: (value: SpendMedium) => void;
  onCover: (value: SpendCover) => void;
  accountId: string;
  onAccount: (value: string) => void;
  fundId: string;
  onFund: (value: string) => void;
  cardId: string;
  onCard: (value: string) => void;
  personId: string;
  onPerson: (value: string) => void;
  gastoXAccounts: ReturnType<typeof useFinance.getState>['balances'];
  originFunds: ReturnType<typeof useFinance.getState>['funds'];
  cards: ReturnType<typeof useFinance.getState>['cards'];
  people: ReturnType<typeof useFinance.getState>['people'];
  selectedOrigin?: ReturnType<typeof useFinance.getState>['balances'][number];
  selectedFund?: ReturnType<typeof useFinance.getState>['funds'][number];
  selectedCard?: ReturnType<typeof useFinance.getState>['cards'][number];
  cardCover?: ReturnType<typeof useFinance.getState>['funds'][number];
}) {
  const showCover = spendMedium === 'BARRAS' || spendMedium === 'ONE';
  const showFund = showCover && (spendCover === 'FUND' || spendCover === 'EMPTY_THEN_LEFTOVER');
  const showCard = spendMedium === 'ONE' || spendMedium === 'BOLSILLO_A' || spendMedium === 'BOLSILLO_Z';
  return (
    <>
      <FieldSelect
        label="Medio"
        value={spendMedium}
        onChange={(value) => onMedium(value as SpendMedium)}
        options={[
          { id: 'BARRAS', label: 'Efectivo Barras' },
          { id: 'ONE', label: 'Tarjeta ONE' },
          { id: 'GASTO_X', label: 'Gastos X (no Barras)' },
          { id: 'BOLSILLO_A', label: 'Bolsillo A' },
          { id: 'BOLSILLO_Z', label: 'Bolsillo Z' },
        ]}
      />
      {spendMedium === 'GASTO_X' && (
        <FieldSelect
          label="Cuenta (no Barras)"
          value={accountId}
          onChange={onAccount}
          options={gastoXAccounts.map((row) => ({
            id: row.account.id,
            label: `${row.account.name} · disp. ${formatUsd(row.disponibleUiCents)}`,
          }))}
        />
      )}
      {showCard && (
        <FieldSelect
          label="Tarjeta"
          value={cardId}
          onChange={onCard}
          options={cards.map((item) => ({
            id: item.card.id,
            label: `${item.card.name} · debe ${formatUsd(item.saldoCents)}`,
          }))}
        />
      )}
      {showCover && (
        <FieldSelect
          label="Cobertura"
          value={spendCover}
          onChange={(value) => onCover(value as SpendCover)}
          options={[
            { id: 'FUND', label: 'Fondo / presupuesto' },
            { id: 'LEFTOVER', label: 'Sobrante de Barras' },
            { id: 'EMPTY_THEN_LEFTOVER', label: 'Vaciar fondo y cubrir con sobrante' },
          ]}
        />
      )}
      {showFund && (
        <FieldSelect
          label="Fondo"
          value={fundId}
          onChange={onFund}
          options={[
            { id: '', label: 'Elige un mini-fondo' },
            ...originFunds.map((item) => ({
              id: item.fund.id,
              label: `${item.fund.name} · apartado ${formatUsd(item.reservedCents)}`,
            })),
          ]}
        />
      )}
      <FieldSelect
        label="Persona"
        value={personId}
        onChange={onPerson}
        options={people.map((row) => ({ id: row.id, label: row.displayName }))}
      />
      {spendMedium === 'BARRAS' && selectedOrigin && (
        <p className="rounded-2xl bg-emerald-950/5 px-4 py-3 text-sm">
          Disponible en Barras: <strong className="tabular-nums">{formatUsd(selectedOrigin.disponibleUiCents)}</strong>
          {selectedFund ? ` · apartado ${selectedFund.fund.name} ${formatUsd(selectedFund.reservedCents)}` : ''}
        </p>
      )}
      {spendMedium === 'ONE' && selectedCard && (
        <p className="rounded-2xl bg-emerald-950/5 px-4 py-3 text-sm">
          <span className="mb-1 flex items-center gap-2 font-medium text-emerald-950">
            <CreditCard className="h-4 w-4" strokeWidth={1.75} aria-hidden />
            Cargo ONE
          </span>
          No saca efectivo de Barras ahora. Se paga después solo desde Atlántida
          {cardCover ? ` · fondo ${cardCover.fund.name}` : ''}.
        </p>
      )}
      {spendMedium === 'GASTO_X' && (
        <p className="rounded-2xl bg-emerald-950/5 px-4 py-3 text-sm">Gastos X no se mezclan con Barras.</p>
      )}
      {spendCover === 'EMPTY_THEN_LEFTOVER' && (
        <p className="rounded-2xl bg-emerald-950/5 px-4 py-3 text-sm">
          Vaciar el fondo es una liberación, no un gasto. El gasto sale del sobrante.
        </p>
      )}
    </>
  );
}

function FundsOpsPanel() {
  const store = useFinance();
  const withReserve = store.funds.filter((row) => row.reservedCents > 0);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(withReserve.map((row) => row.fund.id)));
  const [toAccountId, setToAccountId] = useState(store.releaseDestinationAccountIds[0] ?? '');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<'inject' | 'empty' | null>(null);

  const destAccounts = store.balances.filter((row) =>
    store.releaseDestinationAccountIds.includes(row.account.id),
  );
  const selectedFunds = store.funds.filter((row) => selected.has(row.fund.id) && row.reservedCents > 0);

  useEffect(() => {
    if (toAccountId && store.releaseDestinationAccountIds.includes(toAccountId)) return;
    setToAccountId(store.releaseDestinationAccountIds[0] ?? '');
  }, [store.releaseDestinationAccountIds, toAccountId]);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(withReserve.map((row) => row.fund.id)));
  const selectNone = () => setSelected(new Set());

  async function confirm() {
    if (!store.ledger || !pending) return;
    setBusy(true);
    setMessage(null);
    try {
      await store.ledger.withTransaction(async (tx) => {
        if (pending === 'inject') {
          await injectBudgetedFortnightReserves(tx);
          return;
        }
        await emptyFundsToAvailable(tx, { fundIds: [...selected], toAccountId });
      });
      await store.refresh();
      store.go({ name: 'dashboard' });
    } catch (error) {
      setMessage(errorMessage(error));
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-3">
        <BackLink />
      </div>
      <section className="space-y-4 rounded-3xl bg-white/80 p-4">
        <h2 className="font-display text-2xl text-ink">Fondos</h2>
        <ActionBtn
          icon={Landmark}
          label="Ingreso de fondo presupuestado"
          title="Suma lo quincenal a cada mini-fondo. RESERVA, no gasto."
          className="w-full"
          disabled={busy}
          onClick={() => setPending('inject')}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-full bg-stone-200 px-3 py-1.5 text-sm"
            title="Marca todos los fondos con apartado"
            onClick={selectAll}
          >
            Todos
          </button>
          <button
            type="button"
            className="rounded-full bg-stone-200 px-3 py-1.5 text-sm"
            title="Quita todas las marcas"
            onClick={selectNone}
          >
            Ninguno
          </button>
        </div>
        {store.funds.length === 0 ? (
          <p className="text-sm text-stone-500">Sin fondos</p>
        ) : (
          <ul className="divide-y divide-stone-200/80">
            {store.funds.map((item) => {
              const empty = item.reservedCents <= 0;
              return (
                <li key={item.fund.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 py-2 ${empty ? 'opacity-50' : ''}`}
                    title={empty ? 'Ya está vacío' : `Vaciar ${item.fund.name}`}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0"
                      checked={selected.has(item.fund.id)}
                      disabled={empty}
                      onChange={() => toggle(item.fund.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{item.fund.name}</span>
                      <span className="block text-xs text-stone-500">apartado {formatUsd(item.reservedCents)}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {destAccounts.length === 0 ? (
          <p className="rounded-2xl bg-emerald-950/5 px-4 py-3 text-sm">
            {RELEASE_DESTINATIONS_EMPTY_MESSAGE}{' '}
            <button type="button" className="text-duty" onClick={() => store.go({ name: 'settings', tab: 'control' })}>
              Abrir control
            </button>
          </p>
        ) : (
          <FieldSelect
            label="Cuenta destino"
            value={toAccountId}
            onChange={setToAccountId}
            title="Cuentas de desembolso (Ajustes → Control). Liberar no es gasto."
            options={destAccounts.map((row) => ({
              id: row.account.id,
              label: `${row.account.name} · disp. ${formatUsd(row.disponibleUiCents)}`,
            }))}
          />
        )}
        <ActionBtn
          icon={Wallet}
          label={selectedFunds.length > 1 ? `Vaciar ${selectedFunds.length} fondos` : 'Vaciar fondos al disponible'}
          title="Libera el apartado de los marcados. No aparece como gasto."
          variant="secondary"
          className="w-full"
          disabled={busy || selectedFunds.length === 0 || destAccounts.length === 0}
          onClick={() => setPending('empty')}
        />
        {message && <p className="text-sm text-red-800">{message}</p>}
      </section>
      {pending && (
        <ConfirmDialog
          title={pending === 'inject' ? '¿Recargar mini-fondos quincenales?' : '¿Vaciar los fondos marcados?'}
          confirmLabel={pending === 'inject' ? 'Sí, recargar' : 'Sí, vaciar'}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void confirm()}
        >
          {pending === 'inject' ? (
            <p>Se registra una RESERVA por cada mini-fondo quincenal. No es un gasto.</p>
          ) : (
            <p>
              Se libera {selectedFunds.map((row) => row.fund.name).join(', ')} hacia{' '}
              {destAccounts.find((row) => row.account.id === toAccountId)?.account.name ?? 'la cuenta destino'}. No es
              un gasto.
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  options,
  title,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; label: string }>;
  title?: string;
}) {
  return (
    <label className="block text-sm" title={title}>
      {label}
      <select
        className="mt-1 w-full rounded-2xl bg-stone-100 p-3"
        value={value}
        title={title}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={`${label}-${option.id}`} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-right text-ink">{value}</dd>
    </div>
  );
}

function coverageLabel(status: CoverageStatus): string {
  if (status === 'TRANSFERIDO_A_ATLANTIDA') return 'Transferido a Atlántida';
  if (status === 'CUBIERTO_PENDIENTE_TRASPASO') return 'Cubierto, pendiente de traspaso';
  return 'Sin cobertura';
}

function chargeClassLabel(value: CardChargeClass): string {
  if (value === 'SHARED_BUDGETED') return 'Compartido presupuestado';
  if (value === 'SHARED_UNBUDGETED') return 'Gasto X';
  if (value === 'PERSONAL_Z') return 'Personal Z';
  return 'Personal A';
}
