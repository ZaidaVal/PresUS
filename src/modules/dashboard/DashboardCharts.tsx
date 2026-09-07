import { formatUsd } from '../../domain';

const R = 36;
const CIRC = 2 * Math.PI * R;

export type ChartSlice = {
  label: string;
  cents: number;
  color: string;
};

function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part * 100) / total);
}

export function DonutChart({
  slices,
  tone = 'card',
}: {
  slices: ChartSlice[];
  tone?: 'card' | 'hero';
}) {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.cents), 0);
  let offset = 0;
  const track = tone === 'hero' ? 'color-mix(in srgb, var(--cream) 22%, transparent)' : 'color-mix(in srgb, var(--duty) 16%, transparent)';
  const labelClass = tone === 'hero' ? 'text-cream' : 'text-ink';
  const mutedClass = tone === 'hero' ? 'text-cream/75' : 'text-stone-600';
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0" aria-hidden>
        <circle cx="50" cy="50" r={R} fill="none" stroke={track} strokeWidth="12" />
        <g transform="rotate(-90 50 50)">
          {slices.map((slice) => {
            const value = Math.max(0, slice.cents);
            if (value <= 0 || total <= 0) return null;
            const dash = (value / total) * CIRC;
            const circle = (
              <circle
                key={slice.label}
                cx="50"
                cy="50"
                r={R}
                fill="none"
                stroke={slice.color}
                strokeWidth="12"
                strokeDasharray={`${dash} ${CIRC - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return circle;
          })}
        </g>
      </svg>
      <ul className={`min-w-0 flex-1 space-y-2 text-sm ${labelClass}`}>
        {slices.map((slice) => (
          <li key={slice.label} className="flex items-baseline justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: slice.color }} />
              <span className="truncate">{slice.label}</span>
            </span>
            <span className={`shrink-0 tabular-nums ${mutedClass}`}>
              {percentOf(Math.max(0, slice.cents), total)}% · {formatUsd(slice.cents)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MagnitudeBars({
  rows,
  quiet = false,
}: {
  rows: Array<ChartSlice & { onClick?: () => void }>;
  quiet?: boolean;
}) {
  const max = Math.max(0, ...rows.map((row) => Math.max(0, row.cents)));
  const labelClass = quiet ? 'text-xs text-stone-500' : 'text-sm';
  const barClass = quiet ? 'mt-1 h-1.5' : 'mt-1.5 h-2';
  return (
    <ul className="space-y-3">
      {rows.map((row) => {
        const pct = percentOf(Math.max(0, row.cents), max);
        const inner = (
          <>
            <div className={`flex items-baseline justify-between gap-3 ${labelClass}`}>
              <span>{row.label}</span>
              <span className="tabular-nums">
                {formatUsd(row.cents)}
                <span className="ml-2 text-xs text-stone-400">{pct}%</span>
              </span>
            </div>
            <div className={`${barClass} overflow-hidden rounded-full bg-stone-200/80`}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: row.color }} />
            </div>
          </>
        );
        return (
          <li key={row.label}>
            {row.onClick ? (
              <button type="button" className="w-full text-left" onClick={row.onClick}>
                {inner}
              </button>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Dos barras lado a lado (p.ej. mes actual vs anterior). */
export function CompareBars({
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  left: ChartSlice;
  right: ChartSlice;
  leftLabel: string;
  rightLabel: string;
}) {
  const max = Math.max(1, Math.max(0, left.cents), Math.max(0, right.cents));
  const rows = [
    { slice: left, caption: leftLabel },
    { slice: right, caption: rightLabel },
  ];
  return (
    <ul className="grid grid-cols-2 gap-4">
      {rows.map(({ slice, caption }) => (
        <li key={slice.label} className="space-y-2">
          <p className="text-xs uppercase tracking-[0.15em] text-stone-500">{caption}</p>
          <p className="font-display text-2xl tabular-nums">{formatUsd(slice.cents)}</p>
          <div className="h-2 overflow-hidden rounded-full bg-stone-200/80">
            <div
              className="h-full rounded-full"
              style={{
                width: `${percentOf(Math.max(0, slice.cents), max)}%`,
                background: slice.color,
              }}
            />
          </div>
          <p className="text-xs text-stone-500">{slice.label}</p>
        </li>
      ))}
    </ul>
  );
}

/** Tendencia mensual (columnas). */
export function TrendBars({
  points,
}: {
  points: Array<{ label: string; cents: number; color?: string }>;
}) {
  const max = Math.max(1, ...points.map((point) => Math.max(0, point.cents)));
  return (
    <ul className="flex h-28 items-end gap-2">
      {points.map((point) => {
        const heightPct = percentOf(Math.max(0, point.cents), max);
        return (
          <li key={point.label} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <span className="text-[0.65rem] tabular-nums text-stone-500">
              {point.cents > 0 ? formatUsd(point.cents) : '—'}
            </span>
            <div className="flex w-full flex-1 items-end">
              <div
                className="w-full rounded-t-md"
                style={{
                  height: `${Math.max(point.cents > 0 ? 8 : 0, heightPct)}%`,
                  background:
                    point.color ?? 'color-mix(in srgb, var(--duty) 32%, var(--cream))',
                }}
              />
            </div>
            <span className="truncate text-[0.65rem] text-stone-500">{point.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
