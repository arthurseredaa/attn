'use client';

import { useState, type ReactNode } from 'react';
import { moveItem } from '@/lib/reorder';

const btn =
  'rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted';

export function SortableList({
  items,
  renderLabel,
  onChange,
}: {
  items: string[];
  renderLabel: (id: string) => ReactNode;
  onChange: (next: string[]) => void;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  return (
    <ol className="space-y-2">
      {items.map((id, i) => (
        <li
          key={id}
          draggable
          onDragStart={() => setDragFrom(i)}
          onDragEnd={() => setDragFrom(null)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragFrom !== null) onChange(moveItem(items, dragFrom, i));
            setDragFrom(null);
          }}
          className={`flex items-center gap-3 rounded-lg border border-line bg-card px-3 py-2 ${dragFrom === i ? 'opacity-50' : ''}`}
        >
          <span aria-hidden className="cursor-grab select-none text-muted">
            ⠿
          </span>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold">
            {i + 1}
          </span>
          <span className="min-w-0 flex-1">{renderLabel(id)}</span>
          <button
            type="button"
            className={btn}
            aria-label={`Move ${id} up`}
            disabled={i === 0}
            onClick={() => onChange(moveItem(items, i, i - 1))}
          >
            Move up
          </button>
          <button
            type="button"
            className={btn}
            aria-label={`Move ${id} down`}
            disabled={i === items.length - 1}
            onClick={() => onChange(moveItem(items, i, i + 1))}
          >
            Move down
          </button>
          <button type="button" className={btn} aria-label={`Remove ${id}`} onClick={() => onChange(items.filter((x) => x !== id))}>
            Remove
          </button>
        </li>
      ))}
    </ol>
  );
}
