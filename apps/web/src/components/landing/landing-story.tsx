'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import Link from 'next/link';
import { useReducedMotion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { fontMono, fontSans, pad2, type BoardData, type BoardView } from '@/lib/landing-board';
import { cn } from '@/lib/utils';
import { DotBoard, readFonts, readPalette, sampleWordmark } from './dot-board';

const ACT_NAMES = ['noise', 'collected', 'focus', 'path'];
/** The class on <html> that turns on one-section-per-swipe snapping (globals.css), only while the landing is mounted. */
const SNAP_CLASS = 'landing-snap';

const NUMBER_WORDS = [
  'Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen', 'Twenty',
];

interface Act {
  title: string;
  sub: string;
}

function acts(sourceCount: number | null): Act[] {
  return [
    { title: 'AI learning material is everywhere.', sub: 'Most of it is noise for you right now.' },
    {
      title: `Quality articles from ${sourceCount ?? 'many'}\u00a0sources, in one place.`,
      sub: 'Curation only: every card links to the original.',
    },
    { title: 'Pick up to five skills.', sub: 'Everything else steps back.' },
    { title: 'Read in order, at your level.', sub: 'Easiest first, one step at a time.' },
  ];
}

const sourcesWord = (n: number | null) => (n === null ? 'Many' : (NUMBER_WORDS[n] ?? String(n)));

// ---- styles ---------------------------------------------------------------------------------------------------------

/**
 * A full-screen section under the bar (56px plus its 1px border); with the board on, it snaps one section per swipe. The
 * bar's height is a scroll margin on the sections rather than scroll padding on <html>: padding would also apply when
 * focus returns to a control in the bar (e.g. after the theme menu), and that scroll would snap to another section.
 */
const SECTION =
  'group relative z-10 flex min-h-[calc(100svh-3.5rem-1px)] scroll-mt-[calc(3.5rem+1px)] snap-start snap-always flex-col px-4 md:px-10';
/**
 * The act text comes in once its section is active (after the dots have started to move) and leaves fast. Only with
 * motion allowed and only after mount (`data-state` is set then), so the server html and reduced motion show it all.
 */
const COPY_MOTION =
  'motion-safe:transition-[opacity,translate] motion-safe:delay-[480ms] motion-safe:duration-[650ms] motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] motion-safe:group-data-[state=off]:translate-y-[22px] motion-safe:group-data-[state=off]:opacity-0 motion-safe:group-data-[state=off]:delay-0 motion-safe:group-data-[state=off]:duration-[250ms]';
const H_ACT = 'text-[clamp(36px,5vw,76px)] leading-[0.96] font-semibold tracking-[-0.045em] text-balance';
const SUB = 'mt-3.5 max-w-[34em] text-[clamp(16px,1.4vw,20px)] leading-[1.4] text-muted-foreground';

const CTA_BUTTON = 'h-[54px] rounded-none px-6 text-[16px] font-semibold max-sm:w-full';

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="size-[15px] fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

// ---- the board's wiring -----------------------------------------------------------------------------------------------

/** What the layout needs from the DOM: the act text blocks' positions inside their (stage-sized) sections. */
function measureView(width: number, height: number, copies: (HTMLElement | null)[], fonts: ReturnType<typeof readFonts>): BoardView {
  const bottom = (el: HTMLElement | null) => (el ? el.offsetTop + el.offsetHeight : 120);
  const h = copies[0];
  return {
    width,
    height,
    // offset* ignore transforms, so the text's slide-in does not move the layout.
    copyBottoms: [bottom(copies[1] ?? null), bottom(copies[2] ?? null), bottom(copies[3] ?? null)],
    headline: h
      ? { x0: h.offsetLeft, y0: h.offsetTop, x1: h.offsetLeft + h.offsetWidth, y1: h.offsetTop + h.offsetHeight }
      : { x0: 0, y0: height, x1: 0, y1: height },
    wordmark: sampleWordmark(width, height, fonts),
  };
}

async function loadFonts(fonts: ReturnType<typeof readFonts>) {
  try {
    await Promise.all([
      document.fonts.load(fontSans(fonts, 500, 12)),
      document.fonts.load(fontSans(fonts, 700, 40)),
      document.fonts.load(fontMono(fonts, 500, 12)),
    ]);
    await document.fonts.ready;
  } catch {
    // Draw with whatever is available.
  }
}

/** Calls `fn` on resize (debounced) and theme change (the class on <html>, set by next-themes). */
function watch(el: Element, onResize: () => void, onTheme: () => void) {
  let t: ReturnType<typeof setTimeout> | undefined;
  let first = true;
  const ro = new ResizeObserver(() => {
    if (first) {
      first = false; // the initial callback; the board is already built
      return;
    }
    clearTimeout(t);
    t = setTimeout(onResize, 120);
  });
  ro.observe(el);
  const mo = new MutationObserver(onTheme);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
  return () => {
    clearTimeout(t);
    ro.disconnect();
    mo.disconnect();
  };
}

/** The animated board: one sticky canvas behind all sections, a time-based transition per section change. */
function useAnimatedBoard(
  enabled: boolean,
  data: BoardData | null,
  stageRef: RefObject<HTMLDivElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  copyRefs: RefObject<(HTMLElement | null)[]>,
  active: number,
) {
  const boardRef = useRef<DotBoard | null>(null);
  const activeRef = useRef(active);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!enabled || !data || !stage || !canvas) return;
    const html = document.documentElement;
    let disposed = false;
    let raf = 0;
    let last = 0;
    let inView = true;
    let unwatch = () => {};
    const board = new DotBoard(canvas, data);

    const fonts = readFonts(html);
    const build = () => {
      const view = measureView(stage.clientWidth, stage.clientHeight, copyRefs.current, fonts);
      if (view.width < 2 || view.height < 2) return;
      board.build(view, fonts, readPalette(html), boardRef.current ? board.state : activeRef.current);
      boardRef.current = board;
    };
    const loop = (now: number) => {
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      board.draw(now, dt);
      raf = requestAnimationFrame(loop);
    };
    const run = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
      // Paused while the tab is hidden or the landing is scrolled out of view.
      if (!disposed && boardRef.current && !document.hidden && inView) raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([e]) => {
      inView = e?.isIntersecting ?? true;
      run();
    });
    io.observe(stage.parentElement ?? stage);
    document.addEventListener('visibilitychange', run);

    void loadFonts(fonts).then(() => {
      if (disposed) return;
      build();
      run();
      unwatch = watch(stage, build, () => board.setPalette(readPalette(html)));
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener('visibilitychange', run);
      unwatch();
      boardRef.current = null;
    };
  }, [enabled, data, stageRef, canvasRef, copyRefs]);

  useEffect(() => {
    activeRef.current = active;
    boardRef.current?.goTo(active, performance.now());
  }, [active]);
}

/** Reduced motion: each section draws its own board, once, in its final frame. */
function useStillBoards(
  enabled: boolean,
  data: BoardData | null,
  sectionRefs: RefObject<(HTMLElement | null)[]>,
  canvasRefs: RefObject<(HTMLCanvasElement | null)[]>,
  copyRefs: RefObject<(HTMLElement | null)[]>,
) {
  useEffect(() => {
    const first = sectionRefs.current[0];
    if (!enabled || !data || !first) return;
    const html = document.documentElement;
    let disposed = false;
    let unwatch = () => {};
    const fonts = readFonts(html);
    const boards = canvasRefs.current.map((c) => (c ? new DotBoard(c, data) : null));
    const render = () => {
      const palette = readPalette(html);
      boards.forEach((board, i) => {
        const sec = sectionRefs.current[i];
        if (!board || !sec || sec.clientWidth < 2 || sec.clientHeight < 2) return;
        board.build(measureView(sec.clientWidth, sec.clientHeight, copyRefs.current, fonts), fonts, palette, i);
        board.draw(0, 0, true);
      });
    };
    void loadFonts(fonts).then(() => {
      if (disposed) return;
      render();
      unwatch = watch(first, render, render);
    });
    return () => {
      disposed = true;
      unwatch();
    };
  }, [enabled, data, sectionRefs, canvasRefs, copyRefs]);
}

// ---- the page ---------------------------------------------------------------------------------------------------------

/**
 * The landing story: four acts and the CTA, each one full-screen section. On a dot-matrix board behind them the dots
 * re-form for every section: noise with flashing real titles, a bar per source, five focus-skill bars, a staircase of
 * real articles (easiest first), then the word "attn". The page snaps one section per swipe (native scroll snap, no
 * wheel handling); when a section becomes active the board plays its whole transition and the text comes in.
 * Reduced motion: no snap, no animation, each section with its board's final frame. Without data: text only.
 */
export function LandingStory({
  data,
  sourceCount,
  signedIn,
  alert,
}: {
  data: BoardData | null;
  sourceCount: number | null;
  signedIn: boolean;
  alert?: ReactNode;
}) {
  const list = acts(sourceCount);
  const board = data !== null;
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const copyRefs = useRef<(HTMLElement | null)[]>([]);
  const stillRefs = useRef<(HTMLCanvasElement | null)[]>([]);

  useEffect(() => setMounted(true), []);

  // Snap only on this page: the class goes on <html> (the scroller) and comes off when the landing unmounts.
  useEffect(() => {
    if (!board) return;
    const html = document.documentElement;
    html.classList.add(SNAP_CLASS);
    return () => html.classList.remove(SNAP_CLASS);
  }, [board]);

  // The active section: the one at least 60% on screen (below the bar).
  useEffect(() => {
    if (!board) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting || e.intersectionRatio < 0.6) continue;
          const i = sectionRefs.current.indexOf(e.target as HTMLElement);
          if (i >= 0) setActive(i);
        }
      },
      { threshold: [0.6], rootMargin: '-57px 0px 0px 0px' },
    );
    for (const s of sectionRefs.current) if (s) io.observe(s);
    return () => io.disconnect();
  }, [board]);

  useAnimatedBoard(board && reduce === false, data, stageRef, canvasRef, copyRefs, active);
  useStillBoards(board && reduce === true, data, sectionRefs, stillRefs, copyRefs);

  const state = (i: number) => (board && mounted ? (active === i ? 'on' : 'off') : undefined);
  const setSection = (i: number) => (el: HTMLElement | null) => {
    sectionRefs.current[i] = el;
  };
  const setCopy = (i: number) => (el: HTMLElement | null) => {
    copyRefs.current[i] = el;
  };
  const stillCanvas = (i: number) =>
    board ? (
      <canvas
        ref={(el) => {
          stillRefs.current[i] = el;
        }}
        aria-hidden
        className="pointer-events-none absolute inset-0 hidden size-full motion-reduce:block"
      />
    ) : null;

  if (!board) {
    // Text only (the api is down or the pool is empty): quiet stacked sections, then the CTA.
    return (
      <div>
        {list.map((act, i) => (
          <section key={i} className="border-b px-4 py-14 sm:py-20 md:px-10">
            {i === 0 ? (
              <>
                {alert ? <div className="mb-8">{alert}</div> : null}
                <h1 className={cn(H_ACT, 'max-w-[1180px]')}>{act.title}</h1>
              </>
            ) : (
              <h2 className={cn(H_ACT, 'max-w-[1000px]')}>{act.title}</h2>
            )}
            <p className={SUB}>{act.sub}</p>
          </section>
        ))}
        <Cta signedIn={signedIn} sourceCount={sourceCount} className="py-16 sm:py-24" />
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={stageRef}
        aria-hidden
        className="pointer-events-none sticky top-[calc(3.5rem+1px)] z-0 -mb-[calc(100svh-3.5rem-1px)] h-[calc(100svh-3.5rem-1px)] overflow-hidden bg-background motion-reduce:hidden"
      >
        <canvas ref={canvasRef} className="absolute inset-0 block size-full" />
        <div
          className={cn(
            'absolute right-10 bottom-[22px] hidden font-mono text-[12px] text-muted-foreground transition-opacity duration-300 md:block',
            active > 3 && 'opacity-0',
          )}
        >
          <b className="font-medium text-primary">{pad2(Math.min(active, 3) + 1)}</b> / 04 · {ACT_NAMES[Math.min(active, 3)]}
        </div>
      </div>

      {list.map((act, i) => (
        <section
          key={i}
          ref={setSection(i)}
          data-state={state(i)}
          className={cn(SECTION, i === 0 ? 'justify-end pb-[clamp(48px,10vh,104px)]' : 'pt-7 md:pt-11')}
        >
          {stillCanvas(i)}
          {i === 0 && alert ? <div className="absolute inset-x-4 top-4 z-20 md:inset-x-10">{alert}</div> : null}
          <div ref={setCopy(i)} className={cn('relative', COPY_MOTION, i === 0 ? 'max-w-[1180px]' : 'max-w-[1000px]')}>
            {i === 0 ? (
              <>
                <h1 className="text-[clamp(46px,8.6vw,140px)] leading-[0.88] font-semibold tracking-[-0.058em]">{act.title}</h1>
                <p className={cn(SUB, 'mt-[22px] text-foreground/75')}>{act.sub}</p>
              </>
            ) : (
              <>
                <h2 className={H_ACT}>{act.title}</h2>
                <p className={SUB}>{act.sub}</p>
              </>
            )}
          </div>
        </section>
      ))}

      <section
        ref={setSection(4)}
        data-state={state(4)}
        aria-labelledby="landing-cta"
        className={cn(SECTION, 'justify-end pt-[120px] pb-10')}
      >
        {stillCanvas(4)}
        <Cta signedIn={signedIn} sourceCount={sourceCount} copyRef={setCopy(4)} className={COPY_MOTION} />
      </section>
    </div>
  );
}

function Cta({
  signedIn,
  sourceCount,
  copyRef,
  className,
}: {
  signedIn: boolean;
  sourceCount: number | null;
  copyRef?: (el: HTMLElement | null) => void;
  className?: string;
}) {
  return (
    <div ref={copyRef} className={cn('relative', className)}>
      <div className="max-w-[760px]">
        <h2
          id="landing-cta"
          className="text-[clamp(44px,7.6vw,120px)] leading-[0.9] font-semibold tracking-[-0.058em] text-balance"
        >
          Find your way through it.
        </h2>
        <p className={cn(SUB, 'mt-[22px] mb-10 max-w-[30em]')}>
          {sourcesWord(sourceCount)} sources, five skills, one ordered path.
        </p>
        <div className="flex flex-col sm:flex-row">
          <Button
            asChild
            className={cn(
              CTA_BUTTON,
              'gap-2 border-signal bg-signal text-signal-foreground hover:bg-[color-mix(in_oklch,var(--signal),black_9%)] hover:brightness-100',
            )}
          >
            {signedIn ? (
              <Link href="/for-you">Open For you</Link>
            ) : (
              // Plain anchor: this is an api redirect, not a Next route.
              <a href="/api/auth/github">
                <GitHubMark />
                Sign in with GitHub
              </a>
            )}
          </Button>
          <Button
            asChild
            variant="outline"
            className={cn(
              CTA_BUTTON,
              'border-foreground/25 bg-transparent hover:border-foreground/25 hover:bg-foreground/5 max-sm:-mt-px sm:-ml-px',
            )}
          >
            <Link href="/all">Browse all articles →</Link>
          </Button>
        </div>
      </div>
      <div className="mt-[clamp(64px,12vh,120px)] flex flex-wrap justify-between gap-4 border-t pt-4 font-mono text-[12px] text-muted-foreground">
        <span>attn</span>
        <span>curation only · every card links to the original</span>
      </div>
    </div>
  );
}
