'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, GripVertical, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { moveItem } from '@/lib/reorder';
import { cn } from '@/lib/utils';

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

  // An icon button with a tooltip; the aria-label carries the item name.
  const action = (key: string, Icon: LucideIcon, tip: string, label: string, disabled: boolean, onClick: () => void) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          ref={setRef(key)}
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
          className="text-muted-foreground hover:text-foreground"
        >
          <Icon aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );

  return (
    <ol className="border-t border-border">
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
            className={cn('flex h-11 items-center gap-2.5 border-b border-border pr-1 pl-1', dragFrom === i && 'opacity-50')}
          >
            <GripVertical aria-hidden className="size-4 shrink-0 cursor-grab text-faint" />
            <span className="w-6 shrink-0 font-mono text-[13px] text-primary">#{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{renderLabel(id)}</span>
            <span className="flex shrink-0 items-center gap-0.5">
              {action(`${id}:up`, ArrowUp, 'Move up', `Move ${name} up`, i === 0, () => move(id, i, i - 1, 'up'))}
              {action(`${id}:down`, ArrowDown, 'Move down', `Move ${name} down`, i === items.length - 1, () =>
                move(id, i, i + 1, 'down'),
              )}
              {action(`${id}:remove`, X, 'Remove', `Remove ${name}`, false, () => remove(id, i))}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
