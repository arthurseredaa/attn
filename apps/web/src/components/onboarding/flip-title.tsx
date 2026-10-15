'use client';

import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';

/**
 * A page title whose letters flip once on the X axis after mount, staggered along a sine curve (Obsidian UI's
 * flip-text, loop off, drawn with motion). The text is readable before and after the flip and to screen readers
 * throughout; under reduced motion it does not move.
 */
export function FlipTitle({ text, className }: { text: string; className?: string }) {
  const reduce = useReducedMotion();
  const [play, setPlay] = useState(false);
  useEffect(() => {
    if (!reduce) setPlay(true);
  }, [reduce]);

  const words = text.split(' ');
  const total = text.length;
  let at = 0;

  return (
    <h1 className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden style={{ perspective: '1000px' }} className="inline-block">
        {words.map((word, w) => {
          const start = at;
          at += word.length + 1;
          return (
            <span key={w} className="inline-block whitespace-nowrap">
              {word.split('').map((ch, c) => {
                const delay = Math.sin(((start + c) / total) * (Math.PI / 2)) * 0.35;
                return (
                  <motion.span
                    key={c}
                    className="inline-block"
                    style={{ transformStyle: 'preserve-3d', backfaceVisibility: 'hidden' }}
                    initial={false}
                    animate={{ rotateX: play ? 360 : 0 }}
                    transition={{ duration: 0.75, delay, ease: [0.65, 0, 0.35, 1] }}
                  >
                    {ch}
                  </motion.span>
                );
              })}
              {w < words.length - 1 ? <span className="inline-block">&nbsp;</span> : null}
            </span>
          );
        })}
      </span>
    </h1>
  );
}
