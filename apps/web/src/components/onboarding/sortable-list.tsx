'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { moveItem } from '@/lib/reorder';

const btn =
  'rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted-foreground';

type Refocus = { kind: 'move'; id: string; dir: 'up' | 'down' } | { kind: 'remove'; index: number };

export function SortableList({
  items,
  renderLabel,
  labels,
  onChange,
  emptyText,
}: {
  items: string[];
  renderLabel: (id: string) => ReactNode;
  /** Human-readable names for the aria-labels; falls back to the id. */
  labels?: Record<string, string>;
  onChange: (next: string[]) => void;
  /** Shown instead of the list when it is empty; it takes keyboard focus when the last item is removed. */
  emptyText: string;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const refCallbacks = useRef(new Map<string, (el: HTMLButtonElement | null) => void>());
  const empty = useRef<HTMLParagraphElement>(null);
  const refocus = useRef<Refocus | null>(null);

  // Keep keyboard focus on the list after a move (the moved item's control, or its twin at the list edge)
  // and after a remove (the Remove button now at that position, else the previous one, else the empty text).
  useEffect(() => {
    const target = refocus.current;
    if (!target) return;
    refocus.current = null;
    if (target.kind === 'move') {
      if (!items.includes(target.id)) return;
      const wanted = buttons.current.get(`${target.id}:${target.dir}`);
      const other = buttons.current.get(`${target.id}:${target.dir === 'up' ? 'down' : 'up'}`);
      (wanted && !wanted.disabled ? wanted : other)?.focus();
      return;
    }
    const next = items[Math.min(target.index, items.length - 1)];
    if (next === undefined) empty.current?.focus();
    else buttons.current.get(`${next}:remove`)?.focus();
  }, [items]);

  const move = (id: string, from: number, to: number, dir: 'up' | 'down') => {
    refocus.current = { kind: 'move', id, dir };
    onChange(moveItem(items, from, to));
  };
  const remove = (id: string, index: number) => {
    refocus.current = { kind: 'remove', index };
    onChange(items.filter((x) => x !== id));
  };
  // One stable callback per key, so React does not detach and re-attach every ref on each render.
  const setRef = (key: string) => {
    let cb = refCallbacks.current.get(key);
    if (!cb) {
      cb = (el) => {
        if (el) buttons.current.set(key, el);
        else buttons.current.delete(key);
      };
      refCallbacks.current.set(key, cb);
    }
    return cb;
  };

  if (items.length === 0) {
    return (
      <p ref={empty} tabIndex={-1} className="text-sm text-muted-foreground outline-none">
        {emptyText}
      </p>
    );
  }

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
            className={`flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 ${dragFrom === i ? 'opacity-50' : ''}`}
          >
            <span aria-hidden className="cursor-grab select-none text-muted-foreground">
              ⠿
            </span>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold">
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
            <button
              type="button"
              className={btn}
              ref={setRef(`${id}:remove`)}
              aria-label={`Remove ${name}`}
              onClick={() => remove(id, i)}
            >
              Remove
            </button>
          </li>
        );
      })}
    </ol>
  );
}
