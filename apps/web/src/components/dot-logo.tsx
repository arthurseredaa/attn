import { cn } from '@/lib/utils';

/**
 * The "attn" wordmark as a dot matrix (the landing's closing wordmark, at logo size): lit dots in the signal colour on a
 * faint panel of unlit ones, twinkling in a slow left-to-right wave (`dot-logo-lit` in globals.css; still under reduced
 * motion). Pure SVG, so it renders on the server and stays crisp at any size. Decorative: the caller provides the name
 * for assistive tech.
 */

// 11 rows; "t" rises to row 0, "a" and "n" sit on rows 3–10. Two-dot strokes, two empty columns between letters.
const GLYPHS: string[][] = [
  [
    '.......',
    '.......',
    '.......',
    '.#####.',
    '.....##',
    '.....##',
    '.######',
    '##...##',
    '##...##',
    '##..###',
    '.###.##',
  ],
  ['.##...', '.##...', '.##...', '######', '.##...', '.##...', '.##...', '.##...', '.##...', '.##..#', '..###.'],
  ['.##...', '.##...', '.##...', '######', '.##...', '.##...', '.##...', '.##...', '.##...', '.##..#', '..###.'],
  [
    '.......',
    '.......',
    '.......',
    '##.###.',
    '###..##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
    '##...##',
  ],
];
const GAP = 2;
const ROWS = 11;
/** Dot size as a share of the grid pitch. */
const DOT = 0.74;
/** One twinkle cycle; each dot starts at its own point in it (a wave across the word plus a little scatter). */
const CYCLE_S = 2.8;

interface Dot {
  x: number;
  y: number;
  lit: boolean;
  delay: number;
}

// A small deterministic scatter, so the server and the client draw the same delays.
const scatter = (x: number, y: number) => {
  const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return h - Math.floor(h);
};

const { dots, cols } = (() => {
  const out: Dot[] = [];
  let x0 = 0;
  for (const [g, glyph] of GLYPHS.entries()) {
    const w = glyph[0]!.length;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < w + (g < GLYPHS.length - 1 ? GAP : 0); x++) {
        const cx = x0 + x;
        const lit = x < w && glyph[y]![x] === '#';
        out.push({ x: cx, y, lit, delay: -((cx * 0.07 + scatter(cx, y) * 0.9) % CYCLE_S) });
      }
    }
    x0 += w + GAP;
  }
  return { dots: out, cols: x0 - GAP };
})();

const OFFSET = (1 - DOT) / 2;

export function DotLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox={`0 0 ${cols} ${ROWS}`}
      aria-hidden
      className={cn('h-7 w-auto shrink-0 overflow-visible', className)}
      shapeRendering="geometricPrecision"
    >
      {dots.map((d) =>
        d.lit ? (
          <rect
            key={`${d.x}:${d.y}`}
            x={d.x + OFFSET}
            y={d.y + OFFSET}
            width={DOT}
            height={DOT}
            className="dot-logo-lit fill-primary"
            style={{ animationDelay: `${d.delay.toFixed(2)}s` }}
          />
        ) : (
          <rect
            key={`${d.x}:${d.y}`}
            x={d.x + OFFSET}
            y={d.y + OFFSET}
            width={DOT}
            height={DOT}
            className="fill-foreground/[0.07]"
          />
        ),
      )}
    </svg>
  );
}
