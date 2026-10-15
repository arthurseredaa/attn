'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { floodCircle } from '@/lib/flood';

export type FloodPoint = { x: number; y: number };

/** Where the pointer crossed into or out of the element, in its own coordinates. */
function pointIn(e: { clientX: number; clientY: number; currentTarget: Element }): FloodPoint {
  const r = e.currentTarget.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

/**
 * Mouse hover for a flood fill: the point the pointer entered or left through, and whether it is inside. Touch and pen
 * leave hover alone (a tap would otherwise leave the fill stuck on).
 */
export function useFloodHover() {
  const [hover, setHover] = useState(false);
  const [at, setAt] = useState<FloodPoint | null>(null);
  const track = (inside: boolean) => (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== 'mouse') return;
    setAt(pointIn(e));
    setHover(inside);
  };
  return {
    hover,
    at,
    setAt,
    pointIn,
    handlers: { onPointerEnter: track(true), onPointerLeave: track(false) },
  };
}

const EASE = [0.22, 1, 0.36, 1] as const;

/**
 * The signal fill behind a block's content (the expanding-dot technique of Obsidian UI's interactive-hover-button): a
 * circle centred where the pointer came in grows until it covers the block, and shrinks back toward where it left.
 * Without a pointer point (keyboard) it grows from the centre. The parent must be `relative overflow-hidden`; content
 * above it needs `relative`. Instant under reduced motion.
 */
export function SignalFlood({ on, at }: { on: boolean; at: FloodPoint | null }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const scale = useMotionValue(on ? 1 : 0);
  const mounted = useRef(false);

  const last = useRef<FloodPoint | null>(at);

  // Centre the circle on the point (the box centre without one) and size it to cover the box. Re-centring a circle
  // that already covers the box, or is at scale 0, is invisible, so it can jump.
  const place = useCallback(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const p = last.current ?? { x: w / 2, y: h / 2 };
    const c = floodCircle(p.x, p.y, w, h);
    Object.assign(el.style, { left: `${c.left}px`, top: `${c.top}px`, width: `${c.size}px`, height: `${c.size}px`, marginTop: '0' });
  }, []);

  // Keep a held fill covering the box when it resizes.
  useEffect(() => {
    const box = ref.current?.parentElement;
    if (!box) return;
    const ro = new ResizeObserver(place);
    ro.observe(box);
    return () => ro.disconnect();
  }, [place]);

  useEffect(() => {
    last.current = at;
    place();
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const controls = animate(scale, on ? 1 : 0, reduce ? { duration: 0 } : { duration: on ? 0.34 : 0.28, ease: EASE });
    return () => controls.stop();
  }, [on, at, scale, reduce, place]);

  // Before the first measure (SSR, hydration) a centred circle 2.5x the block width covers it.
  return (
    <motion.span
      ref={ref}
      aria-hidden
      style={{ left: '-75%', top: '50%', width: '250%', aspectRatio: '1', marginTop: '-125%', scale }}
      className="pointer-events-none absolute rounded-full bg-signal"
    />
  );
}

/** A short burst of white sparks from a point (Obsidian UI's click-spark, scoped to one block, drawn with motion). */
export function Sparks({ at, onDone }: { at: FloodPoint; onDone: () => void }) {
  const count = 8;
  return (
    <span aria-hidden className="pointer-events-none absolute size-0" style={{ left: at.x, top: at.y }}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="absolute top-0 left-0 size-0" style={{ transform: `rotate(${(360 / count) * i}deg)` }}>
          <motion.span
            className="absolute -left-px block h-2 w-0.5 bg-signal-foreground"
            initial={{ y: -6, opacity: 1, scaleY: 1 }}
            animate={{ y: -22, opacity: 0, scaleY: 0.3 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            onAnimationComplete={i === 0 ? onDone : undefined}
          />
        </span>
      ))}
    </span>
  );
}
