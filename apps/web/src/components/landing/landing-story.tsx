'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from 'motion/react';
import { ArrowDown } from 'lucide-react';
import { DifficultyMeter } from '@/components/difficulty-meter';
import { FlipTitle } from '@/components/onboarding/flip-title';
import {
  bandOpacity,
  chipBudget,
  chipPose,
  layoutScene,
  pickChips,
  restingProgress,
  storyAt,
  type ChipLayout,
  type Pose,
  type SceneData,
  type SceneLayout,
} from '@/lib/landing-scene';
import { cn } from '@/lib/utils';

const EASE = [0.22, 1, 0.36, 1] as const;
const TITLE = 'text-[34px] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[44px] lg:text-[52px] xl:text-[60px]';
const SUB = 'mt-3 max-w-[34ch] text-base text-muted-foreground sm:mt-4 sm:text-lg';
const GRID = 'mx-auto max-w-[1440px] px-4 md:px-10 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

interface Act {
  title: ReactNode;
  sub: string | null;
}

function acts(sourceCount: number | null): Act[] {
  const n = sourceCount ?? 'many';
  return [
    { title: 'AI learning material is everywhere.', sub: 'Most of it is noise for you right now.' },
    {
      title: (
        <>
          Quality articles from{' '}
          {typeof n === 'number' ? <span className="font-mono tracking-[-0.06em]">{n}</span> : n} sources, in one place.
        </>
      ),
      sub: 'Curation only: every card links to the original.',
    },
    { title: 'Pick up to five skills. Everything else steps back.', sub: null },
    { title: 'Read in order, at your level.', sub: null },
  ];
}

/** An act's heading: h1 for the first, h2 for the rest. */
function ActCopy({ act, index, flip, cue }: { act: Act; index: number; flip?: boolean; cue?: ReactNode }) {
  const heading =
    index === 0 ? (
      flip ? (
        <FlipTitle text={act.title as string} className={TITLE} />
      ) : (
        <h1 className={TITLE}>{act.title}</h1>
      )
    ) : (
      <h2 className={TITLE}>{act.title}</h2>
    );
  return (
    <>
      {heading}
      {act.sub ? <p className={SUB}>{act.sub}</p> : null}
      {cue}
    </>
  );
}

/** The element's content-box size, rounded; null until measured (so the server renders an empty stage). */
function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry!.contentRect.width);
      const h = Math.round(entry!.contentRect.height);
      setSize((s) => (s && s.w === w && s.h === h ? s : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// ---- the stage ------------------------------------------------------------------------------------------------------

function Chip({
  chip,
  layout,
  p,
  intro,
  index,
}: {
  chip: ChipLayout;
  layout: SceneLayout;
  p: MotionValue<number>;
  intro: boolean;
  index: number;
}) {
  // One pose per frame, shared by the five style values.
  const poseAt = useMemo(() => {
    let lastP = Number.NaN;
    let last: Pose = chip.poses[0];
    return (v: number) => {
      if (v !== lastP) {
        lastP = v;
        last = chipPose(chip, v);
      }
      return last;
    };
  }, [chip]);
  const x = useTransform(p, (v) => poseAt(v).x - layout.chipW / 2);
  const y = useTransform(p, (v) => poseAt(v).y - layout.chipH / 2);
  const rotate = useTransform(p, (v) => poseAt(v).r);
  const scale = useTransform(p, (v) => poseAt(v).s);
  const opacity = useTransform(p, (v) => poseAt(v).o);
  return (
    <motion.div
      style={{ x, y, rotate, scale, opacity, width: layout.chipW, height: layout.chipH }}
      className="absolute top-0 left-0 will-change-transform"
    >
      <motion.div
        initial={intro ? { opacity: 0, y: 18 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.1 + Math.min(index, 40) * 0.022, ease: EASE }}
        className={cn(
          'flex h-full items-center border border-border bg-card text-foreground',
          layout.narrow ? 'px-2 text-[11.5px]' : 'px-2.5 text-[12px] leading-4',
        )}
      >
        <span className={layout.narrow ? 'truncate' : 'line-clamp-2'}>{chip.article.title}</span>
      </motion.div>
    </motion.div>
  );
}

function SourceHeader({
  header,
  t,
  narrow,
}: {
  header: SceneLayout['headers'][number];
  t: MotionValue<number>;
  narrow: boolean;
}) {
  const opacity = useTransform(t, (v) => bandOpacity(v, 1, 0.2, 0.35));
  const y = useTransform(t, (v) => header.y + (v < 1 ? 1 : -1) * (1 - bandOpacity(v, 1, 0.2, 0.35)) * 8);
  return (
    <motion.div
      style={{ x: header.x, y, opacity, scale: header.s, width: header.w, transformOrigin: '0 0' }}
      className={cn('absolute top-0 left-0 truncate font-medium text-muted-foreground', narrow ? 'text-[11px] leading-5' : 'text-[12px] leading-6')}
    >
      {header.label}
    </motion.div>
  );
}

function Divider({ x, t }: { x: number; t: MotionValue<number> }) {
  const opacity = useTransform(t, (v) => bandOpacity(v, 1, 0.2, 0.4));
  return <motion.div style={{ x, opacity }} className="absolute inset-y-0 left-0 w-px bg-border" />;
}

function BlockFace({ name, rank, narrow, filled }: { name: string; rank: number; narrow: boolean; filled: boolean }) {
  return (
    <div className={cn('relative flex h-full flex-col justify-end', narrow ? 'p-1.5' : 'p-3')}>
      <span
        className={cn(
          'absolute font-mono leading-none font-medium',
          narrow ? 'top-1.5 left-1.5 text-[15px]' : 'top-2.5 right-3 text-[28px]',
          filled ? 'text-signal-foreground' : 'text-faint',
        )}
      >
        {rank}
      </span>
      <span
        className={cn(
          'line-clamp-3 font-semibold break-words',
          narrow ? 'text-[10.5px] leading-[1.2] hyphens-auto' : 'pr-8 text-[14px] leading-[1.25] tracking-[-0.01em]',
          filled ? 'text-signal-foreground' : 'text-foreground',
        )}
      >
        {name}
      </span>
    </div>
  );
}

/** A focus skill: a plain block that fills with the signal colour left to right (a moving window, transforms only). */
function Block({ name, rank, layout, t }: { name: string; rank: number; layout: SceneLayout; t: MotionValue<number> }) {
  const fill = useTransform(t, (v) => {
    const u = clamp01((v - 1.3 - rank * 0.06) / 0.34);
    return u * u * (3 - 2 * u);
  });
  const outer = useTransform(fill, (f) => `${(f - 1) * 100}%`);
  const inner = useTransform(fill, (f) => `${(1 - f) * 100}%`);
  return (
    // Neighbours share their 1px edge: each block but the last reaches one pixel into the next.
    <div
      style={{ left: layout.blockW * rank, width: layout.blockW + (rank < 4 ? 1 : 0) }}
      className="absolute inset-y-0 overflow-hidden border border-border bg-card"
    >
      <BlockFace name={name} rank={rank + 1} narrow={layout.narrow} filled={false} />
      <motion.div style={{ x: outer }} className="absolute inset-0 overflow-hidden bg-signal">
        <motion.div style={{ x: inner }} className="h-full">
          <BlockFace name={name} rank={rank + 1} narrow={layout.narrow} filled />
        </motion.div>
      </motion.div>
    </div>
  );
}

function Blocks({ data, layout, t }: { data: SceneData; layout: SceneLayout; t: MotionValue<number> }) {
  const opacity = useTransform(t, (v) => clamp01((v - 1.15) / 0.3));
  const y = useTransform(opacity, (o) => (o - 1) * 14);
  return (
    <motion.div style={{ opacity, y, height: layout.blockH }} className="absolute top-0 left-0 w-full">
      {data.skills.map((s, i) => (
        <Block key={s.id} name={s.name} rank={i} layout={layout} t={t} />
      ))}
    </motion.div>
  );
}

function Row({
  row,
  index,
  layout,
  data,
  t,
}: {
  row: SceneLayout['rows'][number];
  index: number;
  layout: SceneLayout;
  data: SceneData;
  t: MotionValue<number>;
}) {
  const opacity = useTransform(t, (v) => clamp01((v - 2.55 - index * 0.015) / 0.25));
  const x = useTransform(opacity, (o) => (1 - o) * 10);
  const a = row.chip.article;
  return (
    <motion.div
      style={{ opacity, x, y: row.y, height: layout.rowH }}
      className={cn('absolute top-0 left-0 flex w-full items-center border-b border-border', index === 0 && 'border-t')}
    >
      <span style={{ width: layout.rankW }} className="shrink-0 pl-1 font-mono text-[13px] text-primary">
        {index + 1}
      </span>
      <span className={cn('min-w-0 flex-1 truncate', layout.narrow ? 'text-[13px]' : 'text-[14px]')}>{a.title}</span>
      <DifficultyMeter
        difficulty={a.difficulty}
        label={data.difficultyLabels[a.difficulty] ?? `L${a.difficulty}`}
        compact
        className="ml-3 shrink-0 pr-1"
      />
    </motion.div>
  );
}

/** The decorative visual: measured, laid out from real articles, every part driven by the progress value `p`. */
function Visual({ data, p, intro, className }: { data: SceneData; p: MotionValue<number>; intro: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);
  const t = useTransform(p, storyAt);
  const layout = useMemo(
    () => (size && size.w > 0 && size.h > 0 ? layoutScene(pickChips(data, chipBudget(size.w)), data, size.w, size.h) : null),
    [data, size],
  );
  return (
    <div ref={ref} aria-hidden className={cn('pointer-events-none relative select-none', className)}>
      {layout ? (
        <>
          {layout.dividers.map((x) => (
            <Divider key={x} x={x} t={t} />
          ))}
          {layout.headers.map((h) => (
            <SourceHeader key={h.key} header={h} t={t} narrow={layout.narrow} />
          ))}
          {layout.chips.map((c, i) => (
            <Chip key={c.article.id} chip={c} layout={layout} p={p} intro={intro} index={i} />
          ))}
          <Blocks data={data} layout={layout} t={t} />
          {layout.rows.map((r, i) => (
            <Row key={r.chip.article.id} row={r} index={i} layout={layout} data={data} t={t} />
          ))}
        </>
      ) : null}
    </div>
  );
}

// ---- pinned story ---------------------------------------------------------------------------------------------------

function ActText({ t, index, children }: { t: MotionValue<number>; index: number; children: ReactNode }) {
  // Out before the next one is in (overlapping lines of big type read as a smudge); the visual carries the gap.
  const opacity = useTransform(t, (v) => bandOpacity(v, index, 0.12, 0.32));
  const y = useTransform(t, (v) => Math.max(-28, Math.min(28, (index - v) * 40)));
  return (
    <motion.div style={{ opacity, y }} className="[grid-area:1/1] lg:self-center">
      {children}
    </motion.div>
  );
}

function ScrollCue() {
  return (
    <p aria-hidden className="mt-5 flex items-center gap-2 text-[13px] text-muted-foreground sm:mt-8">
      <motion.span
        className="inline-flex"
        animate={{ y: [0, 4, 0] }}
        transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
      >
        <ArrowDown className="size-4" strokeWidth={1.75} />
      </motion.span>
      Scroll
    </p>
  );
}

function PinnedStory({ data, list }: { data: SceneData; list: Act[] }) {
  const target = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target, offset: ['start start', 'end end'] });
  // A light spring on the scroll position: the scene follows the wheel with a little weight instead of in steps.
  const p = useSpring(scrollYProgress, { stiffness: 170, damping: 32, mass: 0.6, restDelta: 0.0005 });
  const t = useTransform(p, storyAt);
  return (
    <section ref={target} className="relative h-[440svh]">
      <div className="sticky top-14 h-[calc(100svh-3.5rem)] overflow-hidden">
        <div
          className={cn(
            GRID,
            'grid h-full grid-rows-[auto_minmax(0,1fr)] gap-5 pt-6 pb-5 sm:gap-8 sm:pt-10 lg:grid-rows-1 lg:items-center lg:py-10',
          )}
        >
          <div className="grid">
            {list.map((act, i) => (
              <ActText key={i} t={t} index={i}>
                <ActCopy act={act} index={i} flip={i === 0} cue={i === 0 ? <ScrollCue /> : null} />
              </ActText>
            ))}
          </div>
          <Visual data={data} p={p} intro={!reduce} className="h-full lg:h-[min(640px,100%)]" />
        </div>
      </div>
    </section>
  );
}

// ---- static acts (reduced motion, or no data) -----------------------------------------------------------------------

function StaticVisual({ data, act }: { data: SceneData; act: 0 | 1 | 2 | 3 }) {
  const p = useMotionValue(restingProgress(act));
  return <Visual data={data} p={p} intro={false} className="mt-8 h-[440px] lg:mt-0 lg:h-[560px]" />;
}

function StaticActs({ data, list }: { data: SceneData | null; list: Act[] }) {
  return (
    <div>
      {list.map((act, i) => (
        <section key={i} className={cn('border-b border-border py-14 sm:py-20', i === list.length - 1 && 'border-b-0')}>
          <div className={cn(GRID, 'lg:items-center')}>
            <div>
              <ActCopy act={act} index={i} />
            </div>
            {data ? <StaticVisual data={data} act={i as 0 | 1 | 2 | 3} /> : null}
          </div>
        </section>
      ))}
    </div>
  );
}

/**
 * The landing story in four acts (chaos, collected, focus, structured), told by one pinned scene that morphs as the
 * page scrolls. Under reduced motion the acts are four static sections, each with its final frame. Without data
 * (api down or an empty pool) the acts are text only.
 */
export function LandingStory({ data, sourceCount }: { data: SceneData | null; sourceCount: number | null }) {
  const list = acts(sourceCount);
  if (!data) return <StaticActs data={null} list={list} />;
  // Both versions are in the html; CSS shows one (no hydration mismatch), and the hidden one measures 0 and draws nothing.
  return (
    <>
      <div className="motion-reduce:hidden">
        <PinnedStory data={data} list={list} />
      </div>
      <div className="hidden motion-reduce:block">
        <StaticActs data={data} list={list} />
      </div>
    </>
  );
}
