import type { ArticleCard, SourceSummary, Taxonomy } from '@attn/shared';

/**
 * The landing page's dot-matrix board: one LED-like grid of square dots. Five states, one per snap section:
 * 0 noise (static with flashing real titles), 1 collected (a bar per source), 2 focus (five skill bars),
 * 3 structured (a staircase of real articles, easiest first), 4 the CTA (the word "attn" in dots).
 *
 * Everything here is pure and deterministic (seeded, no Math.random, text measured through a passed-in function), so
 * the data selection and the layout maths are testable without a canvas. The canvas and the animation live in
 * `components/landing/landing-board.tsx`.
 */

export const FOCUS_SIZE = 5;
export const STEP_COUNT = 6;
export const STATE_COUNT = 5;

// ---- data -----------------------------------------------------------------------------------------------------------

export interface BoardData {
  /** Every article in the pool, newest first: the titles that flash on the noise board. */
  titles: { title: string; source: string }[];
  /** Articles per source, most first, then by name; sources with no article in the pool are kept (count 0). */
  sources: { name: string; count: number }[];
  /** The five skills with the most articles in the pool, most first. */
  focus: { id: string; name: string; count: number }[];
  /** The staircase: articles in a focus skill, spread over the levels, easiest first. */
  steps: { title: string; difficulty: number; level: string }[];
  /** How many skills the taxonomy has ("5 of N skills"). */
  skillTotal: number;
}

/** A title length that reads well on a step (long titles wrap to three lines, very short ones look thin). */
const STEP_TITLE_LENGTH = 44;

/**
 * Only what the board draws, so the client payload stays small. Null when there is nothing to draw (no articles, or
 * none of them in a taxonomy skill).
 */
export function toBoardData(
  articles: ArticleCard[],
  sources: SourceSummary[] | null,
  taxonomy: Taxonomy,
): BoardData | null {
  if (articles.length === 0) return null;
  const names = new Map(taxonomy.domains.flatMap((d) => d.skills.map((s) => [s.id, s.name] as const)));

  // Skills: count articles that have the skill at all (primary or not); ties go to the one seen first (newest).
  const counts = new Map<string, { n: number; first: number }>();
  const skillsOf = articles.map((a, i) => {
    const ids = a.skills.toSorted((x, y) => Number(y.isPrimary) - Number(x.isPrimary)).map((s) => s.id);
    for (const id of new Set(ids)) {
      if (!names.has(id)) continue;
      const c = counts.get(id);
      if (c) c.n += 1;
      else counts.set(id, { n: 1, first: i });
    }
    return ids;
  });
  const focus = [...counts.entries()]
    .toSorted(([ia, a], [ib, b]) => b.n - a.n || a.first - b.first || ia.localeCompare(ib))
    .slice(0, FOCUS_SIZE)
    .map(([id, c]) => ({ id, name: names.get(id)!, count: c.n }));
  if (focus.length === 0) return null;

  // Sources: the full list from the api (zero counts included) plus any source only seen on an article.
  const bySource = new Map<string, { name: string; count: number }>();
  for (const s of sources ?? []) bySource.set(s.id, { name: s.name, count: 0 });
  for (const a of articles) {
    const s = bySource.get(a.sourceId);
    if (s) s.count += 1;
    else bySource.set(a.sourceId, { name: a.sourceName, count: 1 });
  }
  const sourceRows = [...bySource.values()].toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  const labels = taxonomy.levels.toSorted((a, b) => a.level - b.level).map((l) => l.label);
  const inFocus = new Set(focus.map((f) => f.id));
  const steps = pickSteps(
    articles.filter((_, i) => skillsOf[i]!.some((id) => inFocus.has(id))),
    STEP_COUNT,
  ).map((a) => ({ title: a.title, difficulty: a.difficulty, level: labels[a.difficulty] ?? `Level ${a.difficulty}` }));

  return {
    titles: articles.map((a) => ({ title: a.title, source: a.sourceName })),
    sources: sourceRows,
    focus,
    steps,
    skillTotal: names.size,
  };
}

/**
 * Up to `n` articles spread over the difficulty levels (round robin from the easiest level, each level's best-fitting
 * title first), then ordered easiest first. Stable: equal candidates keep their order (newest first).
 */
export function pickSteps<T extends { title: string; difficulty: number }>(articles: T[], n: number): T[] {
  const levels = [...new Set(articles.map((a) => a.difficulty))].toSorted((a, b) => a - b);
  const by = levels.map((d) =>
    articles
      .filter((a) => a.difficulty === d)
      .toSorted((x, y) => Math.abs(x.title.length - STEP_TITLE_LENGTH) - Math.abs(y.title.length - STEP_TITLE_LENGTH)),
  );
  const out: T[] = [];
  const deepest = Math.max(0, ...by.map((l) => l.length));
  for (let r = 0; r < deepest && out.length < n; r++) {
    for (const level of by) {
      if (out.length >= n) break;
      const a = level[r];
      if (a) out.push(a);
    }
  }
  return out.toSorted((x, y) => x.difficulty - y.difficulty);
}

// ---- helpers --------------------------------------------------------------------------------------------------------

export const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);

/** A seeded generator in [0, 1) (mulberry32). */
export function rng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A stable number in [0, 1) for two integers. */
export function hash(a: number, b: number): number {
  let h = Math.imul((a * 374761393 + b * 668265263) | 0, 1274126177);
  h ^= h >>> 13;
  h = Math.imul(h, 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** Measures a string's width in px in a canvas font (`ctx.measureText` in the browser, a stub in tests). */
export type Measure = (text: string, font: string) => number;

export interface BoardFonts {
  /** Resolved font-family lists, e.g. the value of `--font-hanken-grotesk`. */
  sans: string;
  mono: string;
}

export const fontSans = (f: BoardFonts, weight: number, size: number) => `${weight} ${size}px ${f.sans}, system-ui, sans-serif`;
export const fontMono = (f: BoardFonts, weight: number, size: number) => `${weight} ${size}px ${f.mono}, ui-monospace, monospace`;

/** `str` cut with an ellipsis to fit `maxW`; '' when not even one letter fits. */
export function fit(str: string, maxW: number, font: string, measure: Measure): string {
  if (measure(str, font) <= maxW) return str;
  let lo = 0;
  let hi = str.length;
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1;
    if (measure(`${str.slice(0, m)}…`, font) <= maxW) lo = m;
    else hi = m - 1;
  }
  return lo ? `${str.slice(0, lo).trimEnd()}…` : '';
}

/** `str` word-wrapped to `maxW`, at most `maxLines` lines (the last one cut with an ellipsis when it overflows). */
export function wrap(str: string, maxW: number, font: string, maxLines: number, measure: Measure): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const w of str.split(' ')) {
    const t = cur ? `${cur} ${w}` : w;
    if (measure(t, font) <= maxW || !cur) cur = t;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = fit(`${lines.slice(maxLines - 1).join(' ')} …`, maxW, font, measure);
    return kept;
  }
  return lines.map((l) => fit(l, maxW, font, measure));
}

// ---- grid -----------------------------------------------------------------------------------------------------------

export interface Grid {
  width: number;
  height: number;
  /** Phone layout (narrower than the md breakpoint, where the page gutter is 16px). */
  mobile: boolean;
  /** Page gutter, px. */
  pad: number;
  /** Dot pitch and dot size, px. */
  S: number;
  D: number;
  cols: number;
  rows: number;
  /** Top-left dot of the grid, px (the grid is centred). */
  ox: number;
  oy: number;
}

export const MOBILE_MAX = 767;

export function boardGrid(width: number, height: number): Grid {
  const mobile = width <= MOBILE_MAX;
  const pad = mobile ? 16 : 40;
  const S = mobile ? 7 : 12;
  const D = mobile ? 3 : 4;
  const cols = Math.max(1, Math.floor((width - D) / S) + 1);
  const rows = Math.max(1, Math.floor((height - D) / S) + 1);
  const ox = Math.round((width - (cols - 1) * S - D) / 2);
  const oy = Math.round((height - (rows - 1) * S - D) / 2);
  return { width, height, mobile, pad, S, D, cols, rows, ox, oy };
}

/** Where the CTA wordmark goes, in grid cells: font size, left edge, baseline. `ratio` = text width / font size. */
export function wordmarkPlacement(g: Grid, ratio: number): { size: number; x: number; baseline: number } {
  const r = Math.max(0.1, ratio);
  const size = Math.max(1, Math.floor(g.mobile ? (g.cols * 0.78) / r : Math.min(g.rows * 0.62, (g.cols * 0.46) / r)));
  const w = size * r;
  return {
    size,
    x: g.mobile ? (g.cols - w) / 2 : g.cols - w - Math.round(g.pad / g.S),
    baseline: g.mobile ? Math.round(g.rows * 0.3) : Math.round(g.rows * 0.62),
  };
}

// ---- layout ---------------------------------------------------------------------------------------------------------

/** Dot colours by role; the component maps them to theme colours. */
export const Tone = {
  grey: 0,
  amber: 1,
  orange: 2,
  deep: 3,
  sand1: 4,
  sand2: 5,
  peach: 6,
  rail: 7,
  word: 8,
} as const;
export type Tone = (typeof Tone)[keyof typeof Tone];
export const TONE_COUNT = 9;

export interface Target {
  x: number;
  y: number;
  tone: Tone;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface BoardView {
  width: number;
  height: number;
  /** Bottom edge (px from the stage top) of the text block of acts 2, 3 and 4. */
  copyBottoms: [number, number, number];
  /** Act 1's text block (the noise is kept back under it and the titles avoid it). */
  headline: Rect;
  /** Lit cells of the CTA wordmark, as [col, row] (sampled from the rendered word by the component). */
  wordmark: [number, number][];
}

export interface FlashLabel {
  title: string;
  titleW: number;
  source: string;
  sourceW: number;
}

export interface BoardLayout {
  grid: Grid;
  /** Per cell: how much of the noise shows (1 everywhere, kept back under the headline). */
  mask: Float32Array;
  headline: Rect;
  labels: FlashLabel[];
  labelFont: string;
  /** Dot targets of states 1–4 (state 0 is the noise, placed by `buildParticles`). */
  targets: [Target[], Target[], Target[], Target[]];
  bars2: { x: number; top: number; count: number; lines: string[] }[];
  top2: number;
  bot2: number;
  bars3: { x: number; top: number; count: number; rank: number; lines: string[] }[];
  top3: number;
  bot3: number;
  steps: { i: number; x: number; y: number; tx: number; lines: string[]; level: string }[];
  /** At least this many particles (fewer on phones). */
  minParticles: number;
}

export function layoutBoard(data: BoardData, view: BoardView, fonts: BoardFonts, measure: Measure): BoardLayout {
  const g = boardGrid(view.width, view.height);
  const { mobile: m, pad, S, cols, rows, ox, oy } = g;
  const W = view.width;
  const H = view.height;
  const cx = (c: number) => ox + c * S;
  const cy = (r: number) => oy + r * S;
  const rowOf = (y: number) => Math.floor((y - oy) / S);

  const hd = view.headline;
  const headline = { x0: hd.x0 - 20, y0: hd.y0 - 20, x1: hd.x1 + 20, y1: hd.y1 + 20 };
  const mask = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = cx(c);
      const y = cy(r);
      mask[r * cols + c] = x > headline.x0 && x < headline.x1 && y > headline.y0 && y < headline.y1 ? 0.22 : 1;
    }
  }

  const c0 = Math.ceil((pad - ox) / S);
  const c1 = Math.floor((W - pad - g.D - ox) / S);
  const avail = Math.max(1, c1 - c0 + 1);
  const [b2, b3, b4] = view.copyBottoms;

  // State 1: a bar per source, an article = `unit` rows of dots.
  const T2: Target[] = [];
  const top2 = b2 + (m ? 44 : 56);
  const bot2 = H - (m ? 112 : 88);
  const base2 = rowOf(bot2);
  const rAv2 = base2 - Math.ceil((top2 - oy) / S);
  const maxC = Math.max(1, ...data.sources.map((s) => s.count));
  const unit2 = clamp(Math.floor(rAv2 / maxC), 1, 3);
  const nSrc = Math.max(1, data.sources.length);
  const slot2 = Math.max(1, Math.floor(avail / nSrc));
  const bw2 = Math.max(1, slot2 - (m ? 1 : 2));
  const srcFont = fontMono(fonts, 400, m ? 9 : 10);
  const bars2 = data.sources.map((s, i) => {
    const sc = c0 + i * slot2;
    for (let u = 0; u < s.count; u++)
      for (let k = 0; k < unit2; k++)
        for (let c = 0; c < bw2; c++)
          T2.push({ x: cx(sc + c), y: cy(base2 - u * unit2 - k), tone: u % 2 ? Tone.sand2 : Tone.sand1 });
    return {
      x: cx(sc),
      top: cy(base2 - s.count * unit2 + 1),
      count: s.count,
      lines: m ? [fit(s.name, H - bot2 - 26, srcFont, measure)] : wrap(s.name, slot2 * S - 6, srcFont, 2, measure),
    };
  });

  // State 2: five focus-skill bars.
  const T3: Target[] = [];
  const top3 = b3 + (m ? 52 : 64);
  const bot3 = H - (m ? 96 : 92);
  const base3 = rowOf(bot3);
  const rAv3 = base3 - Math.ceil((top3 - oy) / S);
  const unit3 = clamp(Math.floor(rAv3 / Math.max(1, ...data.focus.map((f) => f.count))), 1, 3);
  const slot3 = Math.max(1, Math.floor(avail / FOCUS_SIZE));
  const bw3 = Math.max(1, m ? slot3 - 2 : Math.min(12, slot3 - 5));
  const skillFont = fontSans(fonts, 500, m ? 10 : 13);
  const bars3 = data.focus.map((f, i) => {
    const sc = c0 + i * slot3;
    for (let u = 0; u < f.count; u++)
      for (let k = 0; k < unit3; k++)
        for (let c = 0; c < bw3; c++)
          T3.push({ x: cx(sc + c), y: cy(base3 - u * unit3 - k), tone: u % 2 ? Tone.deep : Tone.orange });
    return {
      x: cx(sc),
      top: cy(base3 - f.count * unit3 + 1),
      count: f.count,
      rank: i,
      lines: wrap(f.name, slot3 * S - (m ? 6 : 16), skillFont, m ? 3 : 2, measure),
    };
  });

  // State 3: a staircase of numbered steps, easiest first (a diagonal list on phones).
  const T4: Target[] = [];
  const nS = Math.max(1, data.steps.length);
  const steps: BoardLayout['steps'] = [];
  const top4 = b4 + (m ? 28 : 40);
  const bot4 = H - (m ? 36 : 60);
  if (!m) {
    const base4 = rowOf(bot4);
    const slot4 = Math.max(3, Math.floor(avail / nS));
    const sw = slot4 - 2;
    const textRows = Math.ceil(96 / S);
    const rise = Math.max(2, Math.floor((base4 - Math.ceil((top4 - oy) / S) - textRows) / nS));
    const titleFont = fontSans(fonts, 500, 13);
    let prevTop = base4 + 1;
    data.steps.forEach((a, i) => {
      const sc = c0 + i * slot4;
      const topRow = base4 - (i + 1) * rise + 1;
      for (let c = 0; c < sw; c++)
        for (let k = 0; k < 2; k++) T4.push({ x: cx(sc + c), y: cy(topRow + k), tone: k === 0 ? Tone.peach : Tone.orange });
      for (let r = topRow + 2; r < prevTop; r++) T4.push({ x: cx(sc), y: cy(r), tone: Tone.amber });
      for (let r = topRow + 2; r <= base4; r++) if ((r - topRow) % 2 === 0) T4.push({ x: cx(sc + sw - 1), y: cy(r), tone: Tone.rail });
      prevTop = topRow;
      steps.push({ i, x: cx(sc), y: cy(topRow), tx: cx(sc), lines: wrap(a.title, sw * S - 4, titleFont, 3, measure), level: a.level });
    });
  } else {
    const rowH = Math.floor((bot4 - top4) / nS);
    const ind = 3;
    const sw = 5;
    const titleFont = fontSans(fonts, 500, 12);
    let prev: { row: number; sc: number } | null = null;
    data.steps.forEach((a, i) => {
      const sc = c0 + i * ind;
      const topRow = rowOf(top4 + i * rowH + 8);
      for (let c = 0; c < sw; c++)
        for (let k = 0; k < 2; k++) T4.push({ x: cx(sc + c), y: cy(topRow + k), tone: k === 0 ? Tone.peach : Tone.orange });
      if (prev) for (let r = prev.row + 2; r < topRow; r++) T4.push({ x: cx(prev.sc + sw - 1), y: cy(r), tone: Tone.amber });
      prev = { row: topRow, sc };
      const tx = cx(sc + sw) + 10;
      steps.push({ i, x: cx(sc), y: cy(topRow), tx, lines: wrap(a.title, W - pad - tx - 26, titleFont, 2, measure), level: a.level });
    });
  }

  // State 4: the wordmark.
  const T5: Target[] = view.wordmark
    .filter(([c, r]) => c >= 0 && c < cols && r >= 0 && r < rows)
    .map(([c, r]) => ({ x: cx(c), y: cy(r), tone: Tone.word }));

  // The titles that flash on the noise board.
  const labelFont = fontSans(fonts, 500, m ? 11 : 12);
  const sourceFont = fontMono(fonts, 400, 10);
  const labels = data.titles.map((t) => {
    const title = fit(t.title, m ? 210 : 340, labelFont, measure);
    return { title, titleW: measure(title, labelFont), source: t.source, sourceW: measure(t.source, sourceFont) };
  });

  return {
    grid: g,
    mask,
    headline,
    labels,
    labelFont,
    targets: [T2, T3, T4, T5],
    bars2,
    top2,
    bot2,
    bars3,
    top3,
    bot3,
    steps,
    minParticles: m ? 650 : 1100,
  };
}


// ---- particles ------------------------------------------------------------------------------------------------------

export interface ParticleState {
  x: Float32Array;
  y: Float32Array;
  tone: Uint8Array;
  /** 1 when the dot is part of this state's picture, 0 when it fades out where it is. */
  on: Uint8Array;
  /** A per-dot random in [0, 1) for the move's stagger. */
  rnd: Float32Array;
  /** How far a dot's path bows sideways on the way into this state (fraction of the distance, signed). */
  bend: Float32Array;
}

export interface Particles {
  count: number;
  states: ParticleState[];
  /** Flicker frequency and phase while a dot is noise. */
  freq: Float32Array;
  phase: Float32Array;
}

/**
 * One pool of dots for all five states. State 0 scatters every dot over the board (off the headline). Each next state
 * takes its dots from the previous one, matched left to right, so the move between neighbouring states reads as a
 * sweep; dots a state does not need stay where they were and fade.
 */
export function buildParticles(layout: BoardLayout, seed = 29): Particles {
  const { grid: g, mask, targets } = layout;
  const R = rng(seed);
  const P = Math.max(layout.minParticles, ...targets.map((t) => t.length));
  const make = (): ParticleState => ({
    x: new Float32Array(P),
    y: new Float32Array(P),
    tone: new Uint8Array(P),
    on: new Uint8Array(P),
    rnd: new Float32Array(P),
    bend: new Float32Array(P),
  });
  const states = Array.from({ length: STATE_COUNT }, make);
  const freq = new Float32Array(P);
  const phase = new Float32Array(P);
  const s0 = states[0]!;
  for (let j = 0; j < P; j++) {
    let c: number;
    let r: number;
    let tries = 0;
    do {
      c = Math.floor(R() * g.cols);
      r = Math.floor(R() * g.rows);
      tries++;
    } while (mask[r * g.cols + c]! < 1 && tries < 30);
    s0.x[j] = g.ox + c * g.S;
    s0.y[j] = g.oy + r * g.S;
    s0.tone[j] = R() < 0.45 ? Tone.grey : R() < 0.6 ? Tone.amber : Tone.orange;
    s0.on[j] = 1;
    s0.rnd[j] = R();
    s0.bend[j] = (R() - 0.5) * 0.55;
    freq[j] = 1.5 + R() * 5;
    phase[j] = R() * Math.PI * 2;
  }

  const evenly = (list: number[], n: number) => {
    const out: number[] = [];
    const step = list.length / Math.max(1, n);
    for (let i = 0; i < n; i++) out.push(list[Math.floor(i * step)]!);
    return out;
  };

  for (let k = 1; k < STATE_COUNT; k++) {
    const a = states[k - 1]!;
    const s = states[k]!;
    const T = targets[k - 1]!;
    const byX = (i: number, j: number) => a.x[i]! - a.x[j]! || a.y[i]! - a.y[j]!;
    const on: number[] = [];
    const off: number[] = [];
    for (let j = 0; j < P; j++) (a.on[j] ? on : off).push(j);
    on.sort(byX);
    off.sort(byX);
    const chosen = T.length <= on.length ? evenly(on, T.length) : on.concat(evenly(off, T.length - on.length));
    chosen.sort(byX);
    const tg = T.toSorted((p, q) => p.x - q.x || p.y - q.y);
    const used = new Uint8Array(P);
    chosen.forEach((j, i) => {
      const t = tg[i]!;
      used[j] = 1;
      s.x[j] = t.x;
      s.y[j] = t.y;
      s.tone[j] = t.tone;
      s.on[j] = 1;
    });
    for (let j = 0; j < P; j++) {
      if (!used[j]) {
        s.x[j] = a.x[j]!;
        s.y[j] = a.y[j]!;
        s.tone[j] = a.tone[j]!;
        s.on[j] = 0;
      }
      s.rnd[j] = R();
      s.bend[j] = (R() - 0.5) * 0.55;
    }
  }
  return { count: P, states, freq, phase };
}

// ---- timing ---------------------------------------------------------------------------------------------------------

/** One section change, in ms. */
export const TRANSITION_MS = 1300;

/** Ease in-out cubic (the mockup's dot easing). */
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * A dot's start delay as a fraction of the transition: half random, half a wave across the board. Going forward the
 * wave runs left to right by where the dot lands; going back it is the forward move played in reverse (the dots that
 * arrived last leave first).
 */
export function dotDelay(rnd: number, x: number, width: number, forward: boolean): number {
  const across = clamp(x / Math.max(1, width));
  return forward ? 0.5 * rnd + 0.5 * across : 0.5 * (1 - rnd) + 0.5 * (1 - across);
}

/** A dot's own progress (0–1) at transition progress `u`, given its delay. */
export const dotProgress = (u: number, delay: number) => ease(clamp((u - delay * 0.42) / 0.58));

/** How much of the noise shows at rest in each state. */
export const NOISE_LEVEL = [1, 0.14, 0.035, 0.07, 0.03] as const;
