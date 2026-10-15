'use client';

import { useState, type MouseEvent } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { MAX_FOCUS, type Taxonomy } from '@attn/shared';
import { toggleSkill } from '@/lib/reorder';
import { cn } from '@/lib/utils';
import { SignalFlood, Sparks, useFloodHover, type FloodPoint } from './signal-flood';

type Skill = Taxonomy['domains'][number]['skills'][number];

/** Blocks per row by the wall's width: full-width rows on phones, 3–4 on tablets, 5–6 on wide screens. */
const WALL =
  'grid grid-cols-1 gap-px @min-[600px]:auto-rows-fr @min-[600px]:grid-cols-3 @min-[860px]:grid-cols-4 @min-[1140px]:grid-cols-5 @min-[1440px]:grid-cols-6';

/** One skill as a square block (a full-width row on phones). Hover floods it with the signal colour from where the
 * pointer came in; a picked block holds the fill and shows its rank. When the focus is full, the rest dim and stay put
 * (aria-disabled, still focusable); activating one calls onBlocked. */
function SkillBlock({
  skill,
  rank,
  blocked,
  index,
  onToggle,
  onBlocked,
}: {
  skill: Skill;
  /** 1-based position in the focus, or null. */
  rank: number | null;
  blocked: boolean;
  /** Position on the wall, for the first-render stagger. */
  index: number;
  onToggle: () => void;
  onBlocked: () => void;
}) {
  const reduce = useReducedMotion();
  const { hover, at, setAt, pointIn, handlers } = useFloodHover();
  // After un-picking with the pointer still inside, the fill drains instead of staying as plain hover.
  const [drained, setDrained] = useState(false);
  const [sparks, setSparks] = useState<(FloodPoint & { key: number })[]>([]);
  const picked = rank !== null;
  const on = picked || (hover && !blocked && !drained);

  function click(e: MouseEvent<HTMLButtonElement>) {
    if (blocked) {
      onBlocked();
      return;
    }
    // detail is 0 for keyboard activation: then the fill grows from the centre.
    const p = e.detail > 0 ? pointIn(e) : null;
    setAt(p);
    if (picked) setDrained(true);
    else {
      setDrained(false);
      if (p && !reduce) setSparks((s) => [...s, { ...p, key: performance.now() }]);
    }
    onToggle();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduce ? { duration: 0 } : { duration: 0.3, delay: Math.min(index, 40) * 0.02, ease: [0.22, 1, 0.36, 1] }}
      className="outline outline-border"
    >
      <button
        type="button"
        aria-pressed={picked}
        aria-disabled={blocked || undefined}
        title={skill.description}
        onClick={click}
        onPointerEnter={handlers.onPointerEnter}
        onPointerLeave={(e) => {
          handlers.onPointerLeave(e);
          setDrained(false);
        }}
        className={cn(
          'group relative flex h-full w-full flex-col overflow-hidden bg-card px-4 py-3.5 text-left outline-none @min-[600px]:min-h-[148px] @min-[600px]:p-5',
          blocked ? 'cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        <SignalFlood on={on} at={at} />
        <span className={cn('relative flex h-full flex-col transition-opacity duration-200', blocked && 'opacity-70 @min-[600px]:opacity-40')}>
          <span
            className={cn(
              'pr-10 text-base leading-snug font-semibold tracking-[-0.01em] transition-colors duration-200 @min-[600px]:pr-14 @min-[600px]:text-[17px]',
              on ? 'text-signal-foreground' : 'text-foreground',
            )}
          >
            {skill.name}
          </span>
          <span
            className={cn(
              'mt-1 line-clamp-2 text-[13px] @min-[600px]:mt-1.5 @min-[600px]:line-clamp-3 leading-[1.45] transition-colors duration-200',
              on ? 'text-signal-foreground/85' : 'text-muted-foreground',
            )}
          >
            {skill.description}
          </span>
        </span>
        {/* No pop for ranks already there on load: they render in place on the server. */}
        <AnimatePresence initial={false}>
          {picked ? (
            <motion.span
              key={rank}
              aria-hidden
              initial={reduce ? false : { scale: 0.3, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={reduce ? { opacity: 0, transition: { duration: 0 } } : { scale: 0.5, opacity: 0, transition: { duration: 0.14 } }}
              transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 20 }}
              className="absolute top-3 right-4 origin-center font-mono text-[26px] leading-none font-medium text-signal-foreground @min-[600px]:top-4 @min-[600px]:right-4 @min-[600px]:text-[48px]"
            >
              {rank}
            </motion.span>
          ) : null}
        </AnimatePresence>
        {sparks.map((s) => (
          <Sparks key={s.key} at={s} onDone={() => setSparks((all) => all.filter((x) => x.key !== s.key))} />
        ))}
        {/* The focus indicator sits above the fill: white on a filled block, the accent on a plain one. */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 border-2 border-transparent',
            on ? 'group-focus-visible:border-signal-foreground' : 'group-focus-visible:border-ring',
          )}
        />
      </button>
    </motion.div>
  );
}

/** The skill wall: per domain, the role's skills as blocks butted together on hairlines. */
export function FocusPicker({
  taxonomy,
  role,
  value,
  onChange,
  onBlocked,
}: {
  taxonomy: Taxonomy;
  role: string;
  value: string[];
  onChange: (next: string[]) => void;
  /** A skill was activated while the focus is full. */
  onBlocked: () => void;
}) {
  const full = value.length >= MAX_FOCUS;
  let index = 0;

  return (
    <div className="@container space-y-9">
      <p className="text-[15px] text-muted-foreground">{`Pick up to ${MAX_FOCUS} skills. The first one matters most.`}</p>
      {taxonomy.domains.map((d) => {
        const skills = d.skills.filter((s) => s.roles.includes(role));
        if (skills.length === 0) return null;
        return (
          <section key={d.id} aria-labelledby={`wall-${d.id}`} className="space-y-3">
            <h2 id={`wall-${d.id}`} className="text-lg leading-tight font-semibold tracking-[-0.015em]">
              {d.name}
            </h2>
            {/* 1px outlines on 1px gaps draw single hairlines between the blocks and around the band. */}
            <div className={cn(WALL, 'p-px')}>
              {skills.map((s) => {
                const at = value.indexOf(s.id);
                const rank = at === -1 ? null : at + 1;
                return (
                  <SkillBlock
                    key={s.id}
                    skill={s}
                    rank={rank}
                    blocked={rank === null && full}
                    index={index++}
                    onToggle={() => onChange(toggleSkill(value, s.id, MAX_FOCUS))}
                    onBlocked={onBlocked}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
