'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, ChevronUp, X, type LucideIcon } from 'lucide-react';
import { MAX_FOCUS } from '@attn/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SortableList, useSortable } from './sortable-list';

const SLOTS = Array.from({ length: MAX_FOCUS }, (_, i) => i);
const EASE = [0.22, 1, 0.36, 1] as const;

/** Wide screens: the focus as MAX_FOCUS numbered slots in a row; filled ones carry the move and remove controls. */
function FocusSlots({
  items,
  names,
  onChange,
}: {
  items: string[];
  names: Record<string, string>;
  onChange: (next: string[]) => void;
}) {
  const reduce = useReducedMotion();
  const { dragFrom, dragProps, move, remove, setRef, empty } = useSortable(items, onChange);
  const layout = reduce ? { duration: 0 } : { duration: 0.26, ease: EASE };

  const placeholder = (n: number) => (
    <span
      key={`empty-${n}`}
      aria-hidden
      className="flex min-h-[84px] flex-1 items-start bg-background p-3 outline outline-border"
    >
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
  const action = (
    key: string,
    Icon: LucideIcon,
    tip: string,
    label: string,
    disabled: boolean,
    onClick: () => void,
  ) => (
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
            <div
              {...dragProps(i)}
              className={cn(
                'flex h-full min-h-[84px] cursor-grab flex-col gap-1.5 p-3 pr-2',
                dragFrom === i && 'opacity-50',
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono text-xl leading-none text-primary">{i + 1}</span>
                <span className="-mt-1 flex shrink-0 items-center">
                  {action(`${id}:up`, ArrowLeft, 'Move left', `Move ${name} left`, i === 0, () =>
                    move(id, i, i - 1, 'up'),
                  )}
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

/**
 * Narrow screens: one row with the numbered squares (filled = picked) and Continue. The squares open a bottom sheet with
 * the reorderable list and the secondary action. A `nudge` change (a tap on a skill while the focus is full) shakes
 * the squares.
 */
function FocusBar({
  items,
  names,
  onChange,
  primary,
  secondary,
  nudge,
  error,
}: {
  items: string[];
  names: Record<string, string>;
  onChange: (next: string[]) => void;
  primary: ReactNode;
  secondary: ReactNode;
  nudge: number;
  /** Shown in the sheet too: the secondary action lives there, and the tray's own alert sits under the modal. */
  error: string | null;
}) {
  const reduce = useReducedMotion();
  const squares = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (nudge === 0 || reduce || !squares.current) return;
    const controls = animate(squares.current, { x: [0, -6, 6, -4, 4, 0] }, { duration: 0.4, ease: 'easeOut' });
    return () => controls.stop();
  }, [nudge, reduce]);

  return (
    <div className="flex items-center gap-3">
      {/* Labels the tray's section (aria-labelledby resolves even while this layout is hidden). */}
      <h2 id="focus-tray-heading" className="sr-only">
        Your focus
      </h2>
      <Sheet>
        <SheetTrigger asChild>
          <button
            type="button"
            aria-label={`Your focus: ${items.length} of ${MAX_FOCUS}. Change the order`}
            className="-m-1.5 flex items-center gap-1.5 p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span ref={squares} aria-hidden className="flex gap-1">
              {SLOTS.map((n) => (
                <span
                  key={n}
                  className={cn(
                    'grid size-8 place-items-center font-mono text-[13px] transition-colors duration-200',
                    n < items.length
                      ? 'bg-signal text-signal-foreground'
                      : 'border border-dashed border-faint text-faint',
                  )}
                >
                  {n + 1}
                </span>
              ))}
            </span>
            <ChevronUp aria-hidden className="size-4 text-muted-foreground" />
          </button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[85svh] gap-0 rounded-none outline-none"
          // Focus the sheet itself, not the first move button (whose tooltip would pop up on open).
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
        >
          <SheetHeader className="pb-2">
            <SheetTitle className="text-base font-semibold">Your focus</SheetTitle>
            <SheetDescription>The first one matters most.</SheetDescription>
          </SheetHeader>
          <div className="min-h-0 overflow-y-auto px-4">
            <SortableList
              items={items}
              labels={names}
              renderLabel={(id) => names[id] ?? id}
              onChange={onChange}
              emptyText="Nothing picked yet."
            />
          </div>
          <SheetFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {secondary}
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <div className="ml-auto">{primary}</div>
    </div>
  );
}

/** How long the "focus is full" hint stays after a tap on a blocked skill. */
const HINT_MS = 2500;

/**
 * The sticky bar along the bottom of the focus step: the picked skills in rank order with reorder and remove, the
 * actions, and any error. Full slots from 1024px; below that one row of numbered squares and Continue, with the list
 * and the secondary action in a bottom sheet. After a tap on a skill while the focus is full (`nudge` changes), a
 * short hint says why nothing happened.
 */
export function FocusTray({
  items,
  names,
  onChange,
  primary,
  secondary,
  nudge,
  error,
}: {
  items: string[];
  names: Record<string, string>;
  onChange: (next: string[]) => void;
  primary: ReactNode;
  secondary: ReactNode;
  nudge: number;
  error: string | null;
}) {
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (nudge === 0) return;
    setHint(true);
    const t = setTimeout(() => setHint(false), HINT_MS);
    return () => clearTimeout(t);
  }, [nudge]);
  const full = items.length >= MAX_FOCUS;

  return (
    <section
      aria-labelledby="focus-tray-heading"
      className="sticky bottom-0 z-20 -mx-4 -mb-12 border-t border-border bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:-mx-10 md:-mb-16 md:px-10 lg:pb-4"
    >
      {/* Always rendered so the live region exists before the hint text arrives. */}
      <p aria-live="polite" className={cn('text-sm text-muted-foreground', hint && full && 'mb-2.5 lg:mb-2')}>
        {hint && full ? 'Your focus is full. Remove a skill to add another.' : ''}
      </p>
      <div className="hidden gap-x-6 lg:grid lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0 space-y-2">
          <h2 className="text-sm font-semibold">Your focus</h2>
          <FocusSlots items={items} names={names} onChange={onChange} />
        </div>
        <div className="flex w-44 flex-col justify-end gap-2">
          {primary}
          {secondary}
        </div>
      </div>
      <div className="lg:hidden">
        <FocusBar
          items={items}
          names={names}
          onChange={onChange}
          primary={primary}
          secondary={secondary}
          nudge={nudge}
          error={error}
        />
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}
