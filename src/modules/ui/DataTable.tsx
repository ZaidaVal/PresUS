import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { PencilBtn } from './Icon';

export type DataColumn = {
  key: string;
  label: string;
  numeric?: boolean;
};

export function DataTable({
  caption,
  columns,
  children,
}: {
  caption: string;
  columns: DataColumn[];
  children: ReactNode;
}) {
  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} scope="col" className={col.numeric ? 'num' : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function DataRow({
  onOpen,
  children,
}: {
  onOpen?: () => void;
  children: ReactNode;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (!onOpen) return;
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen();
    }
  };

  return (
    <tr
      data-open={onOpen ? '' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={onKeyDown}
    >
      {children}
    </tr>
  );
}

export function DataCell({
  children,
  numeric,
  nowrap,
}: {
  children?: ReactNode;
  numeric?: boolean;
  nowrap?: boolean;
}) {
  const className = [numeric ? 'num' : '', nowrap ? 'nowrap' : ''].filter(Boolean).join(' ');
  return <td className={className || undefined}>{children}</td>;
}

export function EditCell({ onEdit }: { onEdit?: () => void }) {
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <td className="data-table-actions" onClick={stop}>
      {onEdit ? <PencilBtn onClick={onEdit} /> : null}
    </td>
  );
}

export function ActionsCell({ children }: { children?: ReactNode }) {
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <td className="data-table-actions" onClick={stop}>
      <div className="flex flex-wrap items-center justify-end gap-1">{children}</div>
    </td>
  );
}
