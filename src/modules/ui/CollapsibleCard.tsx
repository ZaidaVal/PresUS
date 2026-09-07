import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useId, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'ui_collapsible_cards';

function readStored(): Record<string, boolean> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'boolean' && key.length > 0) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStored(id: string, open: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...readStored(), [id]: open }));
  } catch {
    /* cuota / modo privado */
  }
}

const SURFACE: Record<'card' | 'hero' | 'tile', string> = {
  card: 'card',
  hero: 'hero',
  tile: 'tile',
};

const TITLE: Record<'card' | 'hero' | 'tile', string> = {
  card: 'text-stone-400',
  hero: 'text-hope',
  tile: 'text-stone-500',
};

export function CollapsibleCard({
  id,
  title,
  icon,
  summary,
  actions,
  defaultOpen = false,
  surface = 'card',
  className = '',
  titleClassName,
  htmlId,
  children,
}: {
  id: string;
  title: ReactNode;
  icon?: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  defaultOpen?: boolean;
  surface?: 'card' | 'hero' | 'tile';
  className?: string;
  titleClassName?: string;
  htmlId?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => readStored()[id] ?? defaultOpen);
  const panelId = useId();
  const toggle = useCallback(() => {
    setOpen((current) => {
      const next = !current;
      writeStored(id, next);
      return next;
    });
  }, [id]);
  const Chevron = open ? ChevronDown : ChevronRight;
  const chevronClass = surface === 'hero' ? 'text-cream/80' : 'text-stone-500';

  return (
    <section id={htmlId} className={`${SURFACE[surface]} ${className}`.trim()}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
        >
          <Chevron className={`h-4 w-4 shrink-0 ${chevronClass}`} strokeWidth={1.75} aria-hidden />
          {icon}
          <span
            className={`min-w-0 text-sm uppercase tracking-[0.2em] ${titleClassName ?? TITLE[surface]}`}
          >
            {title}
          </span>
          {summary ? (
            <span className={`ml-auto shrink-0 tabular-nums text-sm font-medium ${surface === 'hero' ? 'text-cream' : ''}`}>
              {summary}
            </span>
          ) : null}
        </button>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      {open ? (
        <div id={panelId} className="mt-3">
          {children}
        </div>
      ) : null}
    </section>
  );
}
