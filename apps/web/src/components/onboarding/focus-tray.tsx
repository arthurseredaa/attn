'use client';

import { useId, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, X, type LucideIcon } from 'lucide-react';
import { MAX_FOCUS } from '@attn/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SortableList, useSortable } from './sortable-list';

const SLOTS = Array.from({ length: MAX_FOCUS }, (_, i) => i);
const EASE = [0.22, 1, 0.36, 1] as const;

/** Wide screens: the focus as MAX_FOCUS numbered slots in a row; filled ones carry the move and remove controls. */
function FocusSlots({ items, names, onChange }: { items: string[]; names: Record<string, string>; onChange: (next: string[]) => void }) {
  const reduce = useReducedMotion();
  const { dragFrom, dragProps, move, remove, setRef, empty } = useSortable(items, onChange);
  const layout = reduce ? { duration: 0 } : { duration: 0.26, ease: EASE };

  const placeholder = (n: number) => (
    <span key={`empty-${n}`} aria-hidden className="flex min-h-[84px] flex-1 items-start bg-background p-3 outline outline-border">
      <span className="font-mono text-xl leading-none text-faint">{n + 1}</span>
    </span>
  );

  if (items.length === 0) {
    return (
      <p ref={empty} tabIndex={-1} className="grid grid-cols-5 gap-px p-px outline-none">
        <span className="sr-only">Nothing picked yet.</span>
        {SLOTS.map(placeholder)}
      </p>
    );
  }

  // A small icon button with a tooltip; the aria-label carries the skill name.
  const action = (key: string, Icon: LucideIcon, tip: string, label: string, disabled: boolean, onClick: () => void) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
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
    <ol className="grid grid-cols-5 gap-px p-px">
      {items.map((id, i) => {
        const name = names[id] ?? id;
        return (
          <motion.li
            key={id}
            layout="position"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ layout, default: layout }}
            className="bg-card outline outline-border"
          >
            {/* Plain element for HTML drag and drop (motion owns onDragStart on motion elements). */}
            <div {...dragProps(i)} className={cn('flex h-full min-h-[84px] cursor-grab flex-col gap-1.5 p-3 pr-2', dragFrom === i && 'opacity-50')}>
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-xl leading-none text-primary">{i + 1}</span>
                <span className="-mt-1 flex shrink-0 items-center">
                  {action(`${id}:up`, ArrowLeft, 'Move left', `Move ${name} left`, i === 0, () => move(id, i, i - 1, 'up'))}
                  {action(`${id}:down`, ArrowRight, 'Move right', `Move ${name} right`, i === items.length - 1, () =>
                    move(id, i, i + 1, 'down'),
                  )}
                  {action(`${id}:remove`, X, 'Remove', `Remove ${name}`, false, () => remove(id, i))}
                </span>
              </div>
              <span title={name} className="line-clamp-2 text-sm leading-snug font-medium">
                {name}
              </span>
            </div>
          </motion.li>
        );
      })}
      {SLOTS.slice(items.length).map((n) => (
        <motion.li key={`empty-${n}`} layout="position" transition={{ layout }} aria-hidden className="flex">
          {placeholder(n)}
        </motion.li>
      ))}
    </ol>
  );
}

/** Narrow screens: numbered squares (filled = picked) and a toggle that opens the reorderable list. */
function FocusChips({
  items,
  names,
  onChange,
}: {
  items: string[];
  names: Record<string, string>;
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const reduce = useReducedMotion();
  return (
    <div className="space-y-2.5">
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={panel}
            key="panel"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="max-h-[45svh] overflow-y-auto"
          >
            <SortableList
              items={items}
              labels={names}
              renderLabel={(id) => names[id] ?? id}
              onChange={onChange}
              emptyText="Nothing picked yet."
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold">Your focus</h2>
        <span aria-hidden className="flex gap-1">
          {SLOTS.map((n) => (
            <span
              key={n}
              className={cn(
                'grid size-7 place-items-center font-mono text-[13px] transition-colors duration-200',
                n < items.length ? 'bg-signal text-signal-foreground' : 'border border-dashed border-faint text-faint',
              )}
            >
              {n + 1}
            </span>
          ))}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => setOpen(!open)}
          className="ml-auto px-2 text-muted-foreground"
        >
          Order
          {open ? <ChevronDown aria-hidden /> : <ChevronUp aria-hidden />}
        </Button>
      </div>
    </div>
  );
}

/**
 * The sticky bar along the bottom of the focus step: the picked skills in rank order with reorder and remove, the
 * actions, and any error. Full slots from 1024px; numbered squares with an expandable list below that.
 */
export function FocusTray({
  items,
  names,
  onChange,
  actions,
  error,
}: {
  items: string[];
  names: Record<string, string>;
  onChange: (next: string[]) => void;
  actions: ReactNode;
  error: string | null;
}) {
  return (
    <section
      aria-labelledby="focus-tray-heading"
      className="sticky bottom-0 z-20 -mx-4 -mb-12 border-t border-border bg-background px-4 pt-3 pb-4 md:-mx-10 md:-mb-16 md:px-10"
    >
      <div className="hidden gap-x-6 lg:grid lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-2">
          <h2 id="focus-tray-heading" className="text-sm font-semibold">
            Your focus
          </h2>
          <FocusSlots items={items} names={names} onChange={onChange} />
        </div>
        <div className="flex w-44 flex-col justify-end gap-2">{actions}</div>
      </div>
      <div className="space-y-3 lg:hidden">
        <FocusChips items={items} names={names} onChange={onChange} />
        <div className="flex flex-wrap gap-2 *:flex-1">{actions}</div>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
