import type { ReactNode } from 'react';

export function ConfirmDialog({
  title,
  children,
  confirmLabel = 'Confirmar',
  busy = false,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-duty/40 p-4 sm:items-center">
      <div className="w-full max-w-md space-y-4 rounded-[2rem] bg-white p-5 shadow-xl">
        <h2 className="font-display text-2xl text-ink">{title}</h2>
        <div className="space-y-2 text-sm text-stone-600">{children}</div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            className="rounded-full bg-stone-200 px-4 py-3 text-sm"
            disabled={busy}
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="btn-primary px-4 py-3 text-sm"
            disabled={busy || confirmDisabled}
            onClick={onConfirm}
          >
            {busy ? 'Guardando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
