'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { moveItem } from '@/lib/reorder';

const btn =
  'rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted';

export function SortableList({
  items,
  renderLabel,
  labels,
  onChange,
}: {
  items: string[];
  renderLabel: (id: string) => ReactNode;
  /** Human-readable names for the aria-labels; falls back to the id. */
  labels?: Record<string, string>;
  onChange: (next: string[]) => void;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const refocus = useRef<{ id: string; dir: 'up' | 'down' } | null>(null);

  // After a move, keep keyboard focus on the moved item's control (or its twin at the list edge).
  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    const i = items.indexOf(target.id);
    if (i < 0) return;
    const wanted = buttons.current.get(`${target.id}:${target.dir}`);
    const other = buttons.current.get(`${target.id}:${target.dir === 'up' ? 'down' : 'up'}`);
    (wanted && !wanted.disabled ? wanted : other)?.focus();
  }, [items]);

  const move = (id: string, from: number, to: number, dir: 'up' | 'down') => {
    refocus.current = { id, dir };
    onChange(moveItem(items, from, to));
  };
  const setRef = (key: string) => (el: HTMLButtonElement | null) => {
    if (el) buttons.current.set(key, el);
    else buttons.current.delete(key);
  };

  return (
    <ol className="space-y-2">
      {items.map((id, i) => {
        const name = labels?.[id] ?? id;
        return (
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
            ref={setRef(`${id}:up`)}
            aria-label={`Move ${name} up`}
            disabled={i === 0}
            onClick={() => move(id, i, i - 1, 'up')}
          >
            Move up
          </button>
          <button
            type="button"
            className={btn}
            ref={setRef(`${id}:down`)}
            aria-label={`Move ${name} down`}
            disabled={i === items.length - 1}
            onClick={() => move(id, i, i + 1, 'down')}
          >
            Move down
          </button>
          <button type="button" className={btn} aria-label={`Remove ${name}`} onClick={() => onChange(items.filter((x) => x !== id))}>
            Remove
          </button>
        </li>
        );
      })}
    </ol>
  );
}
