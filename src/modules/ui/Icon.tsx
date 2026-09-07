import type { LucideIcon } from 'lucide-react';
import { Pencil } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useFinance } from '../../stores/financeStore';

export type HubTone = 'view' | 'move' | 'square';

const TONE: Record<HubTone, string> = {
  view: 'bg-duty text-cream',
  move: 'bg-hope text-ink',
  square: 'bg-spend/30 text-ink',
};

export function HubGlyph({ icon: Icon, tone }: { icon: LucideIcon; tone: HubTone }) {
  return (
    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${TONE[tone]}`}>
      <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden />
    </span>
  );
}

export function ActionBtn({
  icon: Icon,
  label,
  variant = 'primary',
  className = '',
  type = 'button',
  title,
  ...props
}: {
  icon: LucideIcon;
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const look =
    variant === 'primary'
      ? 'btn-primary disabled:opacity-40'
      : variant === 'secondary'
        ? 'bg-stone-200 text-ink disabled:opacity-40'
        : 'border border-duty/20 text-ink disabled:opacity-40';
  const hint = title ?? label;
  return (
    <button
      type={type}
      title={hint}
      aria-label={props['aria-label'] ?? hint}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm ${look} ${className}`}
      {...props}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
      {label}
    </button>
  );
}

export function ChipBtn({
  label,
  active,
  onClick,
  icon: Icon,
  title,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  icon?: LucideIcon;
  title?: string;
}) {
  const hint = title ?? label;
  return (
    <button
      type="button"
      title={hint}
      aria-label={hint}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm ${
        active ? 'bg-duty text-cream' : 'bg-white/80 text-ink'
      }`}
    >
      {Icon ? <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden /> : null}
      {label}
    </button>
  );
}

export function NavIconBtn({
  icon: Icon,
  label,
  active,
  onClick,
  title,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
  title?: string;
}) {
  const hint = title ?? label;
  return (
    <button
      type="button"
      title={hint}
      aria-label={hint}
      onClick={onClick}
      className={`flex min-h-14 min-w-[4.25rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-2 text-[0.7rem] leading-tight ${
        active ? 'bg-duty text-cream' : 'text-ink'
      }`}
    >
      <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden />
      <span>{label}</span>
    </button>
  );
}

export function BackLink() {
  const goHome = useFinance((state) => state.goHome);
  return (
    <button
      type="button"
      className="text-sm text-duty"
      title="Volver a Inicio"
      aria-label="Volver a Inicio"
      onClick={goHome}
    >
      ← Inicio
    </button>
  );
}

export function PencilBtn({
  onClick,
  label = 'Editar',
}: {
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full text-duty"
      onClick={onClick}
    >
      <Pencil className="h-4 w-4" strokeWidth={1.75} />
    </button>
  );
}

export function RecordRow({
  title,
  subtitle,
  meta,
  onOpen,
  onEdit,
}: {
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  onOpen: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="flex items-stretch gap-1">
      <button type="button" className="min-w-0 flex-1 py-1 text-left" onClick={onOpen}>
        <span className="font-medium">{title}</span>
        {subtitle ? <span className="mt-0.5 block text-xs text-stone-500">{subtitle}</span> : null}
      </button>
      {meta ? <div className="flex items-center text-sm tabular-nums">{meta}</div> : null}
      {onEdit ? <PencilBtn onClick={onEdit} /> : null}
    </div>
  );
}
