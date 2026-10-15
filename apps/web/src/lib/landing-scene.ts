import type { ArticleCard, Taxonomy } from '@attn/shared';

/**
 * The landing page's scroll story: real articles that go from a scattered pile (chaos) to columns by source
 * (collected), to five focus skills with their articles under them (focus), to one ordered list (structured).
 *
 * Everything here is pure and deterministic: the "random" scatter is seeded from article ids, so a reload or a resize
 * gives the same picture and nothing depends on Math.random.
 */

export const FOCUS_SIZE = 5;

export interface SceneArticle {
  id: number;
  title: string;
  sourceId: string;
  sourceName: string;
  difficulty: number;
  /** Skill ids, the primary one first. */
  skills: string[];
}

export interface SceneData {
  /** Newest first. */
  articles: SceneArticle[];
  /** The five skills with the most articles in `articles`, most first; names from the taxonomy. */
  skills: { id: string; name: string }[];
  /** Taxonomy difficulty labels, index = level 0–4. */
  difficultyLabels: string[];
}

/** Only what the story draws, so the client payload stays small. Null when there is nothing to show. */
export function toSceneData(articles: ArticleCard[], taxonomy: Taxonomy): SceneData | null {
  const names = new Map(taxonomy.domains.flatMap((d) => d.skills.map((s) => [s.id, s.name] as const)));
  const counts = new Map<string, { n: number; first: number }>();
  const sceneArticles = articles.map((a, i) => {
    const skills = a.skills.toSorted((x, y) => Number(y.isPrimary) - Number(x.isPrimary)).map((s) => s.id);
    for (const id of skills) {
      if (!names.has(id)) continue;
      const c = counts.get(id);
      if (c) c.n += 1;
      else counts.set(id, { n: 1, first: i });
    }
    return { id: a.id, title: a.title, sourceId: a.sourceId, sourceName: a.sourceName, difficulty: a.difficulty, skills };
  });
  const skills = [...counts.entries()]
    .toSorted(([ia, a], [ib, b]) => b.n - a.n || a.first - b.first || ia.localeCompare(ib))
    .slice(0, FOCUS_SIZE)
    .map(([id]) => ({ id, name: names.get(id)! }));
  if (sceneArticles.length === 0 || skills.length === 0) return null;
  const difficultyLabels = taxonomy.levels.toSorted((a, b) => a.level - b.level).map((l) => l.label);
  return { articles: sceneArticles, skills, difficultyLabels };
}

/** A seeded number in [0, 1) for an article id and a purpose (`salt`). */
export function seeded(id: number, salt: number): number {
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface SceneChip {
  article: SceneArticle;
  /** Index into `skills` of the focus skill this article sits under, or null (it steps back). */
  focus: number | null;
}

/**
 * The chips on stage: up to `perSkill` articles under each focus skill and up to `others` outside the focus, newest
 * first. An article belongs to the first of its skills (primary first) that is in focus. The out-of-focus chips come
 * first so the focus chips draw on top.
 */
export function pickChips(data: SceneData, opts: { perSkill: number; others: number }): SceneChip[] {
  const rank = new Map(data.skills.map((s, i) => [s.id, i]));
  const perSkill = data.skills.map(() => 0);
  const inFocus: SceneChip[] = [];
  const outside: SceneChip[] = [];
  for (const article of data.articles) {
    const hit = article.skills.find((id) => rank.has(id));
    const focus = hit === undefined ? null : rank.get(hit)!;
    if (focus === null) {
      if (outside.length < opts.others) outside.push({ article, focus });
    } else if (perSkill[focus]! < opts.perSkill) {
      perSkill[focus]! += 1;
      inFocus.push({ article, focus });
    }
  }
  return [...outside, ...inFocus];
}

/** The final list order: by focus rank, then difficulty (easiest first), then newest. */
export function listOrder(chips: SceneChip[], data: SceneData): SceneChip[] {
  const newest = new Map(data.articles.map((a, i) => [a.id, i]));
  return chips
    .filter((c) => c.focus !== null)
    .toSorted(
      (a, b) =>
        a.focus! - b.focus! ||
        a.article.difficulty - b.article.difficulty ||
        newest.get(a.article.id)! - newest.get(b.article.id)!,
    );
}

// ---- layout ---------------------------------------------------------------------------------------------------------

/** One chip's place in one act: centre, rotation (deg), scale, opacity. */
export interface Pose {
  x: number;
  y: number;
  r: number;
  s: number;
  o: number;
}

export interface ChipLayout extends SceneChip {
  /** Chaos, collected, focus, structured. */
  poses: [Pose, Pose, Pose, Pose];
  /** Extra offset the chaos pose drifts by while the first act is on screen. */
  drift: { x: number; y: number; r: number };
  /** Per-transition start offsets (0–1 of the stagger window), so chips do not move in lockstep. */
  delays: [number, number, number];
  /** Row in the final list, or null when it does not make the list. */
  row: number | null;
}

export interface SceneLayout {
  width: number;
  height: number;
  narrow: boolean;
  chipW: number;
  chipH: number;
  chips: ChipLayout[];
  /** Source names over their column groups in the collected act (top-left corner, scale). */
  headers: { key: string; label: string; x: number; y: number; w: number; s: number }[];
  /** x of the hairlines between source columns. */
  dividers: number[];
  blockW: number;
  blockH: number;
  rows: { chip: SceneChip; y: number }[];
  rowH: number;
  /** Width of the rank column in a list row; the chip lands with its text where the row title starts. */
  rankW: number;
}

/** How many chips a stage of this width shows. */
export function chipBudget(width: number): { perSkill: number; others: number } {
  return width < 440 ? { perSkill: 2, others: 8 } : { perSkill: 4, others: 12 };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function layoutScene(chips: SceneChip[], data: SceneData, width: number, height: number): SceneLayout {
  const W = width;
  const H = height;
  const narrow = W < 440;
  const cols = W >= 680 ? 4 : W >= 440 ? 3 : 2;
  const gap = narrow ? 8 : 12;
  const chipW = Math.floor((W - gap * (cols - 1)) / cols);
  const chipH = narrow ? 28 : 48;
  const step = chipH + 6;
  const headerH = narrow ? 20 : 24;
  const groupGap = narrow ? 8 : 12;

  // Chaos: a jittered grid, cells handed out in a seeded order, small tilts.
  const gridCols = Math.max(2, Math.round(Math.sqrt((chips.length * W) / H)));
  const gridRows = Math.max(1, Math.ceil(chips.length / gridCols));
  const order = chips.map((c, i) => ({ i, k: seeded(c.article.id, 1) })).toSorted((a, b) => a.k - b.k);
  const cell = new Map(order.map((o, n) => [o.i, n]));
  const chaos = chips.map((c, i): Pose => {
    const n = cell.get(i)!;
    const gx = n % gridCols;
    const gy = Math.floor(n / gridCols);
    const cx = ((gx + 0.5 + (seeded(c.article.id, 2) - 0.5) * 0.8) * W) / gridCols;
    const cy = ((gy + 0.5 + (seeded(c.article.id, 3) - 0.5) * 0.8) * H) / gridRows;
    return {
      x: clamp(cx, chipW * 0.32, W - chipW * 0.32),
      y: clamp(cy, chipH * 0.6, H - chipH * 0.6),
      r: (seeded(c.article.id, 4) - 0.5) * 16,
      s: 0.92 + seeded(c.article.id, 5) * 0.1,
      o: 1,
    };
  });

  // Collected: groups by source, largest first onto the shortest column; scaled to fit, centred.
  const groups = new Map<string, number[]>();
  chips.forEach((c, i) => groups.set(c.article.sourceId, [...(groups.get(c.article.sourceId) ?? []), i]));
  const nameOf = (members: number[]) => chips[members[0]!]!.article.sourceName;
  const sortedGroups = [...groups.entries()].toSorted(
    ([a, x], [b, y]) => y.length - x.length || nameOf(x).localeCompare(nameOf(y)) || a.localeCompare(b),
  );
  const colH = Array.from({ length: cols }, () => 0);
  const colGroups: string[][] = Array.from({ length: cols }, () => []);
  for (const [key, members] of sortedGroups) {
    const c = colH.indexOf(Math.min(...colH));
    colH[c]! += (colH[c]! > 0 ? groupGap : 0) + headerH + members.length * step - 6;
    colGroups[c]!.push(key);
  }
  const tallest = Math.max(...colH, 1);
  const fit = Math.min(1, H / tallest);
  const totalW = W * fit;
  const ox = (W - totalW) / 2;
  const oy = (H - tallest * fit) / 2;
  const collected: Pose[] = chips.map(() => ({ x: 0, y: 0, r: 0, s: fit, o: 1 }));
  const headers: SceneLayout['headers'] = [];
  colGroups.forEach((keys, c) => {
    const left = c * (chipW + gap);
    let y = 0;
    for (const key of keys) {
      if (y > 0) y += groupGap;
      const members = groups.get(key)!;
      headers.push({
        key,
        label: chips[members[0]!]!.article.sourceName,
        x: ox + left * fit,
        y: oy + y * fit,
        w: chipW,
        s: fit,
      });
      y += headerH;
      for (const i of members) {
        collected[i] = { x: ox + (left + chipW / 2) * fit, y: oy + (y + chipH / 2) * fit, r: 0, s: fit, o: 1 };
        y += step;
      }
      y -= 6;
    }
  });
  const dividers = Array.from({ length: cols - 1 }, (_, c) => ox + ((c + 1) * (chipW + gap) - gap / 2) * fit);

  // Focus: five blocks along the top, each skill's chips stacked under its block; the rest step back below.
  const blockW = W / FOCUS_SIZE;
  const blockH = narrow ? 78 : 92;
  const s2 = Math.min(1, (blockW - (narrow ? 6 : 14)) / chipW);
  const step2 = chipH * s2 + (narrow ? 4 : 6);
  const under = data.skills.map(() => 0);
  const firstRow = blockH + (narrow ? 8 : 12);
  let focusBottom = firstRow;
  const focusPoses: Pose[] = chips.map((c, i) => {
    if (c.focus === null) return collected[i]!;
    const j = under[c.focus]!++;
    const y = firstRow + j * step2 + (chipH * s2) / 2;
    focusBottom = Math.max(focusBottom, y + (chipH * s2) / 2);
    return { x: blockW * c.focus + blockW / 2, y, r: 0, s: s2, o: 1 };
  });
  const backTop = focusBottom + (narrow ? 16 : 28);
  chips.forEach((c, i) => {
    if (c.focus !== null) return;
    const from = collected[i]!;
    focusPoses[i] = {
      x: from.x,
      y: backTop + (from.y / H) * Math.max(0, H - backTop - chipH * 0.4),
      r: (seeded(c.article.id, 6) - 0.5) * 6,
      s: 0.84 * fit,
      o: 0.15,
    };
  });

  // Structured: the focus chips land in list rows under the blocks, then hand over to the rows.
  const rowH = narrow ? 34 : 42;
  const rankW = narrow ? 28 : 40;
  const listTop = blockH + (narrow ? 12 : 20);
  const capacity = clamp(Math.floor((H - listTop) / rowH), 0, narrow ? 8 : 10);
  const ordered = listOrder(chips, data).slice(0, capacity);
  const rowOf = new Map(ordered.map((c, n) => [c.article.id, n]));
  const rows = ordered.map((chip, n) => ({ chip, y: listTop + n * rowH }));
  const padX = narrow ? 8 : 10;

  const layouts = chips.map((c, i): ChipLayout => {
    const id = c.article.id;
    const row = rowOf.get(id) ?? null;
    const p2 = focusPoses[i]!;
    const structured: Pose =
      row === null
        ? { ...p2, y: p2.y + 16, o: 0 }
        : { x: rankW - padX + chipW / 2, y: listTop + row * rowH + rowH / 2, r: 0, s: 1, o: 0 };
    return {
      ...c,
      poses: [chaos[i]!, collected[i]!, p2, structured],
      drift: {
        x: (seeded(id, 7) - 0.5) * 44,
        y: (seeded(id, 8) - 0.5) * 32,
        r: (seeded(id, 9) - 0.5) * 6,
      },
      delays: [seeded(id, 10), seeded(id, 11), seeded(id, 12)],
      row,
    };
  });

  return { width: W, height: H, narrow, chipW, chipH, chips: layouts, headers, dividers, blockW, blockH, rows, rowH, rankW };
}

// ---- timeline -------------------------------------------------------------------------------------------------------

/**
 * Scroll progress (0–1 over the pinned section) to the story position (0 chaos, 1 collected, 2 focus, 3 structured).
 * Short holds at each act, long overlapping transitions between them.
 */
const P_KEYS = [0, 0.08, 0.33, 0.4, 0.65, 0.72, 0.94, 1];
const T_KEYS = [0, 0, 1, 1, 2, 2, 3, 3];

export function storyAt(p: number): number {
  const q = clamp(p, 0, 1);
  for (let k = 1; k < P_KEYS.length; k++) {
    const p1 = P_KEYS[k]!;
    if (q <= p1) {
      const p0 = P_KEYS[k - 1]!;
      const t0 = T_KEYS[k - 1]!;
      const t1 = T_KEYS[k]!;
      return p1 === p0 ? t1 : t0 + ((q - p0) / (p1 - p0)) * (t1 - t0);
    }
  }
  return 3;
}

/** A scroll progress that shows act `k` at rest (the middle of its hold). */
export function restingProgress(k: 0 | 1 | 2 | 3): number {
  return [0, 0.365, 0.685, 1][k]!;
}

/** Smootherstep: starts and ends at rest. */
const ease = (u: number) => u * u * u * (u * (u * 6 - 15) + 10);
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** How much of each transition the stagger may delay a chip by. */
const STAGGER = 0.3;

/** A chip's pose at scroll progress `p`. */
export function chipPose(chip: ChipLayout, p: number): Pose {
  const t = storyAt(p);
  const d = clamp(p / 0.2, 0, 1);
  const c0 = chip.poses[0];
  const chaos: Pose = { ...c0, x: c0.x + chip.drift.x * d, y: c0.y + chip.drift.y * d, r: c0.r + chip.drift.r * d };
  const k = Math.min(2, Math.floor(t));
  const from = k === 0 ? chaos : chip.poses[k]!;
  const to = chip.poses[k + 1]!;
  const u = ease(clamp((t - k - chip.delays[k]! * STAGGER) / (1 - STAGGER), 0, 1));
  // A little lift mid-flight, so the moves read as physical rather than linear.
  const lift = Math.sin(Math.PI * u) * (k === 0 ? 10 : 6);
  // Into the list, the chip keeps its opacity while it travels and fades only as its row takes over.
  const o = k === 2 ? lerp(from.o, to.o, clamp((u - 0.7) / 0.3, 0, 1)) : lerp(from.o, to.o, u);
  return {
    x: lerp(from.x, to.x, u),
    y: lerp(from.y, to.y, u) - lift,
    r: lerp(from.r, to.r, u),
    s: lerp(from.s, to.s, u),
    o,
  };
}

/** Opacity of a band that is fully on within ±`hold` of `at` and gone by ±(`hold` + `fade`). */
export function bandOpacity(t: number, at: number, hold = 0.15, fade = 0.3): number {
  return clamp(1 - (Math.abs(t - at) - hold) / fade, 0, 1);
}
