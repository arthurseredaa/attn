/**
 * The canvas side of the landing board (browser only): draws a `BoardLayout` and plays time-based transitions between
 * its five states. Layout and data selection are in `lib/landing-board.ts`.
 */
import {
  buildParticles,
  clamp,
  dotDelay,
  dotProgress,
  ease,
  fontMono,
  fontSans,
  hash,
  layoutBoard,
  NOISE_LEVEL,
  pad2,
  rng,
  smooth,
  STATE_COUNT,
  Tone,
  TONE_COUNT,
  TRANSITION_MS,
  wordmarkPlacement,
  boardGrid,
  type BoardData,
  type BoardFonts,
  type BoardLayout,
  type BoardView,
  type Particles,
} from '@/lib/landing-board';

type RGB = [number, number, number];

export interface Palette {
  /** For change detection. */
  key: string;
  bg: string;
  dim: string;
  fg: string;
  muted: string;
  faint: string;
  line: string;
  accent: string;
  labelSource: string;
  tones: RGB[];
  sweep: RGB;
  wordBright: RGB;
}

// ---- theme ----------------------------------------------------------------------------------------------------------

const probe = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');

/** Any CSS colour to rgb, through the canvas parser (it normalises to #rrggbb or rgba()). */
function toRGB(value: string, fallback: RGB): RGB {
  if (!probe || !value.trim()) return fallback;
  probe.fillStyle = '#000';
  probe.fillStyle = value.trim();
  const s = String(probe.fillStyle);
  if (s.startsWith('#') && s.length === 7) return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)) as RGB;
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const [r, g, b] = m[1]!.split(',').map((n) => parseFloat(n));
    if ([r, g, b].every((n) => Number.isFinite(n))) return [r!, g!, b!];
  }
  return fallback;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB) => `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
const luminance = (c: RGB) => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

/** Board colours from the theme tokens in globals.css (read from computed styles, so both themes work). */
export function readPalette(el: Element): Palette {
  const cs = getComputedStyle(el);
  const v = (name: string, fb: RGB) => toRGB(cs.getPropertyValue(name), fb);
  const bg = v('--background', [18, 18, 17]);
  const fg = v('--foreground', [236, 236, 230]);
  const muted = v('--muted-foreground', [154, 154, 145]);
  const faint = v('--faint', [110, 110, 102]);
  const segment = v('--segment', [58, 58, 53]);
  const primary = v('--primary', [255, 122, 69]);
  const signal = v('--signal', [194, 65, 12]);
  const dark = luminance(bg) < 0.5;
  // Amber is the board's one extra colour (warm, between the orange and the sand).
  const amber: RGB = dark ? [242, 163, 58] : [204, 124, 24];
  const sand1 = mix(fg, amber, 0.2);
  const tones: RGB[] = new Array(TONE_COUNT);
  tones[Tone.grey] = mix(faint, muted, 0.4);
  tones[Tone.amber] = amber;
  tones[Tone.orange] = primary;
  tones[Tone.deep] = dark ? mix(signal, primary, 0.35) : mix(signal, fg, 0.28);
  tones[Tone.sand1] = sand1;
  tones[Tone.sand2] = mix(sand1, bg, dark ? 0.2 : 0.35);
  tones[Tone.peach] = dark ? mix(primary, fg, 0.4) : mix(primary, amber, 0.45);
  tones[Tone.rail] = mix(bg, primary, 0.3);
  tones[Tone.word] = signal;
  const palette = {
    bg: css(bg),
    dim: css(mix(bg, segment, dark ? 0.42 : 0.55)),
    fg: css(fg),
    muted: css(muted),
    faint: css(faint),
    line: css(segment),
    accent: css(primary),
    labelSource: css(mix(muted, faint, 0.5)),
    tones,
    sweep: dark ? ([255, 255, 255] as RGB) : mix(amber, bg, 0.35),
    wordBright: dark ? primary : mix(signal, amber, 0.6),
  };
  return { ...palette, key: JSON.stringify(palette) };
}

/** The resolved next/font families (the `--font-*` variables on <html>). */
export function readFonts(el: Element): BoardFonts {
  const cs = getComputedStyle(el);
  return {
    sans: cs.getPropertyValue('--font-hanken-grotesk').trim() || 'system-ui',
    mono: cs.getPropertyValue('--font-jetbrains-mono').trim() || 'ui-monospace',
  };
}

const measureCtx = probe;
export const measureText = (text: string, font: string) => {
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
};

/** The lit cells of the word "attn" drawn in a bold sans on the board's grid. */
export function sampleWordmark(width: number, height: number, fonts: BoardFonts): [number, number][] {
  const g = boardGrid(width, height);
  const tc = document.createElement('canvas');
  tc.width = g.cols;
  tc.height = g.rows;
  const t = tc.getContext('2d', { willReadFrequently: true });
  if (!t) return [];
  t.font = fontSans(fonts, 700, 100);
  const p = wordmarkPlacement(g, t.measureText('attn').width / 100);
  t.font = fontSans(fonts, 700, p.size);
  t.textBaseline = 'alphabetic';
  t.fillStyle = '#fff';
  t.fillText('attn', p.x, p.baseline);
  const px = t.getImageData(0, 0, g.cols, g.rows).data;
  const out: [number, number][] = [];
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) if (px[(r * g.cols + c) * 4 + 3]! > 120) out.push([c, r]);
  return out;
}

// ---- the board ------------------------------------------------------------------------------------------------------

const colCache = new Map<number, string>();
function colStr(r: number, g: number, b: number): string {
  const k = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
  let s = colCache.get(k);
  if (!s) {
    s = `rgb(${(r >> 2) << 2},${(g >> 2) << 2},${(b >> 2) << 2})`;
    colCache.set(k, s);
  }
  return s;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const NOISE_TONES = [Tone.grey, Tone.amber, Tone.orange] as const;
const GLOWING = new Set<number>([Tone.orange, Tone.deep, Tone.peach]);

interface Built {
  L: BoardLayout;
  P: Particles;
  base: HTMLCanvasElement;
  nv: Float32Array;
  nh: Uint8Array;
  buckets: Int32Array[];
  bc: Int32Array;
}

export class DotBoard {
  private ctx: CanvasRenderingContext2D;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private b: Built | null = null;
  private pal: Palette | null = null;
  private fonts: BoardFonts = { sans: 'system-ui', mono: 'ui-monospace' };

  /** The state the board is heading to, when it started, and which way. */
  private target = 0;
  private t0 = -Infinity;
  private forward = true;
  // Where each dot starts (a snapshot of the frame when the transition began), and its path and delay.
  private f = { x: new Float32Array(0), y: new Float32Array(0), r: new Float32Array(0), g: new Float32Array(0), b: new Float32Array(0), on: new Float32Array(0), nw: new Float32Array(0) };
  private c = { x: new Float32Array(0), y: new Float32Array(0), r: new Float32Array(0), g: new Float32Array(0), b: new Float32Array(0), on: new Float32Array(0), nw: new Float32Array(0) };
  private qx = new Float32Array(0);
  private qy = new Float32Array(0);
  private dl = new Float32Array(0);
  private vis0 = new Float32Array(STATE_COUNT);
  private vis = new Float32Array(STATE_COUNT);
  private nl0 = 1;
  private nl = 1;
  private glow0 = 0;
  private glow = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private data: BoardData,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas unavailable');
    this.ctx = ctx;
  }

  get state() {
    return this.target;
  }

  /** (Re)builds the board for a size and puts it at rest in `state`. */
  build(view: BoardView, fonts: BoardFonts, palette: Palette, state: number) {
    this.fonts = fonts;
    this.pal = palette;
    this.W = view.width;
    this.H = view.height;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    const L = layoutBoard(this.data, view, fonts, measureText);
    const P = buildParticles(L);
    const N = L.grid.cols * L.grid.rows;
    const R = rng(31);
    const nv = new Float32Array(N);
    const nh = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      nv[i] = R() < 0.08 ? 0.7 + R() * 0.3 : Math.pow(R(), 2.4) * 0.65;
      nh[i] = R() < 0.56 ? 0 : R() < 0.62 ? 1 : 2;
    }
    this.b = {
      L,
      P,
      base: document.createElement('canvas'),
      nv,
      nh,
      buckets: Array.from({ length: 18 }, () => new Int32Array(N)),
      bc: new Int32Array(18),
    };
    this.paintBase();
    const n = P.count;
    const arrays = () => ({ x: new Float32Array(n), y: new Float32Array(n), r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), on: new Float32Array(n), nw: new Float32Array(n) });
    this.f = arrays();
    this.c = arrays();
    this.qx = new Float32Array(n);
    this.qy = new Float32Array(n);
    this.dl = new Float32Array(n);
    this.settle(state);
  }

  /** New theme colours: repaint the faint board; the dots pick their colours up on the next frame. */
  setPalette(palette: Palette) {
    if (this.pal?.key === palette.key) return;
    this.pal = palette;
    this.paintBase();
    this.settle(this.target);
  }

  /** Puts every dot at rest in `state` (no animation). */
  settle(state: number) {
    const b = this.b;
    if (!b || !this.pal) return;
    this.target = state;
    this.t0 = -Infinity;
    const s = b.P.states[state]!;
    for (let j = 0; j < b.P.count; j++) {
      const col = this.pal.tones[s.tone[j]!]!;
      this.c.x[j] = s.x[j]!;
      this.c.y[j] = s.y[j]!;
      this.c.r[j] = col[0];
      this.c.g[j] = col[1];
      this.c.b[j] = col[2];
      this.c.on[j] = s.on[j]!;
      this.c.nw[j] = state === 0 ? 1 : 0;
    }
    this.f.x.set(this.c.x);
    this.f.y.set(this.c.y);
    this.f.r.set(this.c.r);
    this.f.g.set(this.c.g);
    this.f.b.set(this.c.b);
    this.f.on.set(this.c.on);
    this.f.nw.set(this.c.nw);
    this.vis.fill(0);
    this.vis[state] = 1;
    this.vis0.set(this.vis);
    this.nl = this.nl0 = NOISE_LEVEL[state as 0]!;
    this.glow = this.glow0 = state === 2 || state === 3 ? 1 : 0;
  }

  /** Starts a transition to `state` from wherever the dots are now (also mid-flight). */
  goTo(state: number, now: number) {
    const b = this.b;
    if (!b || state === this.target) return;
    this.forward = state > this.target;
    this.target = state;
    this.t0 = now;
    this.f.x.set(this.c.x);
    this.f.y.set(this.c.y);
    this.f.r.set(this.c.r);
    this.f.g.set(this.c.g);
    this.f.b.set(this.c.b);
    this.f.on.set(this.c.on);
    this.f.nw.set(this.c.nw);
    this.vis0.set(this.vis);
    this.nl0 = this.nl;
    this.glow0 = this.glow;
    const s = b.P.states[state]!;
    for (let j = 0; j < b.P.count; j++) {
      const fx = this.f.x[j]!;
      const fy = this.f.y[j]!;
      const tx = s.x[j]!;
      const ty = s.y[j]!;
      const bend = s.bend[j]!;
      this.qx[j] = (fx + tx) / 2 - (ty - fy) * bend;
      this.qy[j] = (fy + ty) / 2 + (tx - fx) * bend;
      this.dl[j] = dotDelay(s.rnd[j]!, this.forward ? tx : fx, this.W, this.forward);
    }
  }

  /** One frame. `still` draws a calm, fixed frame (reduced motion). */
  draw(now: number, dt: number, still = false) {
    const b = this.b;
    const pal = this.pal;
    if (!b || !pal) return;
    const ctx = this.ctx;
    const { L, P } = b;
    const g = L.grid;
    const k = this.target;
    const time = now / 1000;
    const u = still ? 1 : clamp((now - this.t0) / TRANSITION_MS);

    // Levels that follow the transition as a whole.
    this.nl = lerp(this.nl0, NOISE_LEVEL[k as 0]!, smooth(u));
    const glowTo = k === 2 || k === 3 ? 1 : 0;
    this.glow = lerp(this.glow0, glowTo, glowTo > this.glow0 ? smooth(clamp((u - 0.5) / 0.5)) : smooth(clamp(u / 0.3)));
    for (let s = 0; s < STATE_COUNT; s++) {
      if (s === k) {
        const enter = s === 0 ? smooth(clamp((u - 0.55) / 0.45)) : s === 3 ? ease(clamp((u - 0.62) / 0.25)) : ease(clamp((u - 0.6) / 0.4));
        this.vis[s] = lerp(this.vis0[s]!, 1, enter);
      } else {
        const leave = s === 0 ? smooth(clamp(u / 0.45)) : ease(clamp(u / 0.3));
        this.vis[s] = this.vis0[s]! * (1 - leave);
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(b.base, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // The static on the board.
    if (!still) this.updateNoise(dt);
    const { nv, nh, buckets, bc } = b;
    const nl = this.nl;
    const N = g.cols * g.rows;
    bc.fill(0);
    for (let i = 0; i < N; i++) {
      const lv = nv[i]! * nl * L.mask[i]!;
      if (lv < 0.07) continue;
      const bk = nh[i]! * 6 + Math.min(5, (lv * 6) | 0);
      buckets[bk]![bc[bk]!++] = i;
    }
    for (let bk = 0; bk < 18; bk++) {
      if (!bc[bk]) continue;
      const tone = NOISE_TONES[(bk / 6) | 0]!;
      const col = pal.tones[tone]!;
      ctx.globalAlpha = (((bk % 6) + 1) / 6) * (tone === Tone.grey ? 0.8 : 1);
      ctx.fillStyle = css(col);
      ctx.beginPath();
      const arr = buckets[bk]!;
      for (let n = 0; n < bc[bk]!; n++) {
        const i = arr[n]!;
        ctx.rect(g.ox + (i % g.cols) * g.S, g.oy + ((i / g.cols) | 0) * g.S, g.D, g.D);
      }
      ctx.fill();
    }

    // The dots.
    const st = P.states[k]!;
    const nwTo = k === 0 ? 1 : 0;
    const halo = new Path2D();
    let haloN = 0;
    const D = g.D;
    const sw = pal.sweep;
    const wb = pal.wordBright;
    const word = pal.tones[Tone.word]!;
    const f = this.f;
    const c = this.c;
    for (let j = 0; j < P.count; j++) {
      const tj = u >= 1 ? 1 : dotProgress(u, this.dl[j]!);
      let x: number;
      let y: number;
      if (tj <= 0) {
        x = f.x[j]!;
        y = f.y[j]!;
      } else if (tj >= 1) {
        x = st.x[j]!;
        y = st.y[j]!;
      } else {
        const v = 1 - tj;
        x = v * v * f.x[j]! + 2 * v * tj * this.qx[j]! + tj * tj * st.x[j]!;
        y = v * v * f.y[j]! + 2 * v * tj * this.qy[j]! + tj * tj * st.y[j]!;
      }
      const tone = st.tone[j]!;
      const col = pal.tones[tone]!;
      let r = lerp(f.r[j]!, col[0], tj);
      let gg = lerp(f.g[j]!, col[1], tj);
      let bb = lerp(f.b[j]!, col[2], tj);
      const on = lerp(f.on[j]!, st.on[j]!, tj);
      const nw = lerp(f.nw[j]!, nwTo, tj);
      c.x[j] = x;
      c.y[j] = y;
      c.r[j] = r;
      c.g[j] = gg;
      c.b[j] = bb;
      c.on[j] = on;
      c.nw[j] = nw;
      if (on < 0.02) continue;
      let al = on;
      if (nw > 0) {
        const fl = still
          ? 0.25 + 0.75 * hash(j, 7) * hash(j, 9)
          : 0.18 + 0.82 * Math.pow(0.5 + 0.5 * Math.sin(time * P.freq[j]! + P.phase[j]!), 6);
        al *= lerp(1, fl, nw);
      }
      if (!still && tj >= 1) {
        if (k === 2) al *= 0.86 + 0.14 * Math.sin(time * 1.3 + x * 0.02);
        if ((k === 2 && u >= 1) || k === 3) {
          const wv = Math.pow(Math.max(0, Math.sin(x * 0.012 - y * 0.004 - time * 2.1)), 14) * 0.55;
          r += (sw[0] - r) * wv;
          gg += (sw[1] - gg) * wv;
          bb += (sw[2] - bb) * wv;
        }
      }
      if (k === 4 && st.on[j]) {
        // The wordmark twinkles, and a brighter wave runs across it.
        const wv = still || tj < 1 ? 0 : Math.pow(Math.max(0, Math.sin(x * 0.01 - time * 1.6)), 10);
        const a = (still ? 0.85 : 0.62 + 0.2 * Math.sin(time * 1.7 + P.phase[j]!)) + wv * 0.3;
        al = lerp(al, a, tj);
        if (wv > 0.3) {
          r = wb[0];
          gg = wb[1];
          bb = wb[2];
        } else if (tj >= 1) {
          r = word[0];
          gg = word[1];
          bb = word[2];
        }
      }
      ctx.globalAlpha = al > 1 ? 1 : al;
      ctx.fillStyle = colStr(r | 0, gg | 0, bb | 0);
      ctx.fillRect(x, y, D, D);
      if (this.glow > 0 && tj > 0.5 && al > 0.5 && GLOWING.has(tone)) {
        halo.rect(x - 2, y - 2, D + 4, D + 4);
        haloN++;
      }
    }
    if (haloN) {
      ctx.globalAlpha = 0.1 * this.glow;
      ctx.fillStyle = pal.accent;
      ctx.fill(halo);
    }

    this.drawLabels(time, u, still);
    ctx.globalAlpha = 1;
  }

  private drawLabels(time: number, u: number, still: boolean) {
    const b = this.b!;
    const pal = this.pal!;
    const ctx = this.ctx;
    const { L } = b;
    const m = L.grid.mobile;
    const k = this.target;
    const F = this.fonts;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    // An element of the entering state with its own stagger.
    const staggered = (s: number, delay: number, span: number) =>
      still ? 1 : s === k ? lerp(this.vis0[s]!, 1, ease(clamp((u - delay) / span))) : this.vis[s]!;

    if (this.vis[0]! > 0.01) this.drawFlashTitles(time, this.vis[0]!, still);

    const v2 = this.vis[1]!;
    if (v2 > 0.01) {
      for (const bar of L.bars2) {
        ctx.globalAlpha = v2 * (bar.count ? 1 : 0.45);
        ctx.fillStyle = bar.count ? pal.fg : pal.faint;
        ctx.font = fontMono(F, 500, m ? 9 : 11);
        ctx.fillText(String(bar.count), bar.x, (bar.count ? bar.top : L.bot2) - (m ? 6 : 9));
        ctx.fillStyle = bar.count ? pal.muted : pal.faint;
        ctx.font = fontMono(F, 400, m ? 9 : 10);
        if (m) {
          ctx.save();
          ctx.translate(bar.x + L.grid.D, L.bot2 + 12);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = 'right';
          ctx.fillText(bar.lines[0] ?? '', 0, 0);
          ctx.restore();
          ctx.textAlign = 'left';
        } else {
          bar.lines.forEach((ln, i) => ctx.fillText(ln, bar.x, L.bot2 + 22 + i * 13));
        }
      }
      ctx.globalAlpha = v2;
      ctx.fillStyle = pal.muted;
      ctx.font = fontMono(F, 400, m ? 10 : 11);
      ctx.textAlign = 'right';
      ctx.fillText('articles per source', this.W - L.grid.pad, L.top2 - (m ? 22 : 30));
      ctx.textAlign = 'left';
    }

    if (this.vis[2]! > 0.01 || k === 2) {
      const rankFont = fontMono(F, 600, m ? 10 : 12);
      const rankW = measureText('00', rankFont);
      for (const bar of L.bars3) {
        const va = staggered(2, 0.6 + bar.rank * 0.05, 0.3);
        if (va < 0.01) continue;
        ctx.globalAlpha = va;
        ctx.fillStyle = pal.accent;
        ctx.font = rankFont;
        ctx.fillText(pad2(bar.rank + 1), bar.x, bar.top - (m ? 8 : 12));
        ctx.fillStyle = pal.muted;
        ctx.font = fontMono(F, 400, m ? 10 : 12);
        ctx.fillText(String(bar.count), bar.x + rankW + (m ? 6 : 10), bar.top - (m ? 8 : 12));
        ctx.fillStyle = pal.fg;
        ctx.font = fontSans(F, 500, m ? 10 : 13);
        bar.lines.forEach((ln, i) => ctx.fillText(ln, bar.x, L.bot3 + (m ? 18 : 24) + i * (m ? 12 : 16)));
      }
      ctx.globalAlpha = this.vis[2]!;
      ctx.fillStyle = pal.muted;
      ctx.font = fontMono(F, 400, m ? 10 : 11);
      ctx.textAlign = 'right';
      ctx.fillText(`${this.data.focus.length} of ${this.data.skillTotal} skills · articles each`, this.W - L.grid.pad, L.top3 - (m ? 26 : 34));
      ctx.textAlign = 'left';
    }

    if (this.vis[3]! > 0.01 || k === 3) {
      const numFont = fontMono(F, 600, m ? 10 : 12);
      const numW = measureText('00', numFont);
      for (const s of L.steps) {
        const va = staggered(3, 0.62 + s.i * 0.05, 0.25);
        if (va < 0.01) continue;
        ctx.globalAlpha = va;
        if (!m) {
          const lh = 17;
          const y0 = s.y - 14 - (s.lines.length - 1) * lh;
          ctx.fillStyle = pal.accent;
          ctx.font = numFont;
          ctx.fillText(pad2(s.i + 1), s.x, y0 - 22);
          ctx.fillStyle = pal.muted;
          ctx.font = fontMono(F, 400, 11);
          ctx.fillText(s.level, s.x + numW + 10, y0 - 22);
          ctx.fillStyle = pal.fg;
          ctx.font = fontSans(F, 500, 13);
          s.lines.forEach((ln, i) => ctx.fillText(ln, s.x, y0 + i * lh));
        } else {
          ctx.fillStyle = pal.accent;
          ctx.font = numFont;
          ctx.fillText(pad2(s.i + 1), s.tx, s.y + 6);
          ctx.fillStyle = pal.fg;
          ctx.font = fontSans(F, 500, 12);
          s.lines.forEach((ln, i) => ctx.fillText(ln, s.tx + 22, s.y + 6 + i * 15));
          ctx.fillStyle = pal.muted;
          ctx.font = fontMono(F, 400, 9);
          ctx.fillText(s.level, s.tx + 22, s.y + 6 + s.lines.length * 15);
        }
      }
    }
  }

  /** Real titles flashing in and out on the noise board, never over the headline. */
  private drawFlashTitles(time: number, v: number, still: boolean) {
    const b = this.b!;
    const pal = this.pal!;
    const ctx = this.ctx;
    const { L } = b;
    if (L.labels.length === 0) return;
    const m = L.grid.mobile;
    const pad = L.grid.pad;
    const hl = L.headline;
    const top = 16;
    const K = m ? 5 : 9;
    for (let s = 0; s < K; s++) {
      const dur = 1.5 + hash(s, 1) * 1.8;
      const tt = still ? hash(s, 5) * dur * 0.5 : time + hash(s, 2) * dur;
      const cyc = Math.floor(tt / dur);
      const fr = tt / dur - cyc;
      if (fr > 0.64) continue;
      let on = 1;
      if (fr < 0.07) on = Math.floor(fr * 140) % 2 ? 0.25 : 1;
      if (fr > 0.58) on = Math.floor(fr * 140) % 2 ? 0.2 : 0.8;
      const lab = L.labels[Math.floor(hash(s * 31 + 7, cyc) * L.labels.length)]!;
      const w = lab.titleW + (m ? 16 : 22) + (m ? 0 : lab.sourceW + 14);
      const h = m ? 24 : 28;
      let x = pad + hash(s, cyc + 11) * Math.max(1, this.W - 2 * pad - w);
      let y = top + hash(s, cyc + 23) * Math.max(1, this.H - top - h - 30);
      if (x + w > hl.x0 && x < hl.x1 && y + h > hl.y0 && y < hl.y1) {
        // Moved off the headline to the larger free band: above it on wide screens, below it on phones (where the
        // text sits at the top).
        const above = hl.y0 - top - h;
        const below = this.H - 30 - h - hl.y1;
        const r = hash(s, cyc + 29);
        y = below > above ? hl.y1 + r * Math.max(1, below) : top + r * Math.max(1, above);
      }
      x = Math.round(x);
      y = Math.round(y);
      ctx.globalAlpha = v * on;
      ctx.fillStyle = pal.bg;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = pal.line;
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      ctx.fillStyle = pal.accent;
      ctx.fillRect(x, y, 2, h);
      ctx.fillStyle = pal.fg;
      ctx.font = L.labelFont;
      ctx.fillText(lab.title, x + (m ? 9 : 12), y + h / 2 + 4);
      if (!m) {
        ctx.fillStyle = pal.labelSource;
        ctx.font = fontMono(this.fonts, 400, 10);
        ctx.fillText(lab.source, x + 12 + lab.titleW + 12, y + h / 2 + 3.5);
      }
    }
  }

  private updateNoise(dt: number) {
    const { nv, nh } = this.b!;
    const N = nv.length;
    const rolls = Math.floor(N * 0.05 * Math.min(dt * 60, 3));
    const dec = Math.pow(0.925, dt * 60);
    for (let i = 0; i < N; i++) nv[i] = nv[i]! * dec;
    for (let n = 0; n < rolls; n++) {
      const i = (Math.random() * N) | 0;
      nv[i] = Math.random() < 0.07 ? 0.75 + Math.random() * 0.25 : Math.pow(Math.random(), 2.2) * 0.6;
      nh[i] = Math.random() < 0.56 ? 0 : Math.random() < 0.62 ? 1 : 2;
    }
  }

  /** The background and the faint dot grid, painted once per size and theme. */
  private paintBase() {
    const b = this.b;
    const pal = this.pal;
    if (!b || !pal) return;
    const g = b.L.grid;
    b.base.width = this.canvas.width;
    b.base.height = this.canvas.height;
    const x = b.base.getContext('2d');
    if (!x) return;
    x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    x.fillStyle = pal.bg;
    x.fillRect(0, 0, this.W, this.H);
    x.fillStyle = pal.dim;
    x.beginPath();
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) x.rect(g.ox + c * g.S, g.oy + r * g.S, g.D, g.D);
    x.fill();
  }
}
