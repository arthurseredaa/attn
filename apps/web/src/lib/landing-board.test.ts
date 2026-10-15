import { describe, expect, it } from 'vitest';
import type { ArticleCard, SourceSummary, Taxonomy } from '@attn/shared';
import {
  boardGrid,
  buildParticles,
  dotDelay,
  dotProgress,
  fit,
  layoutBoard,
  pickSteps,
  toBoardData,
  Tone,
  wordmarkPlacement,
  wrap,
  type BoardData,
  type BoardView,
  type Measure,
} from './landing-board';

const SKILLS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const taxonomy = {
  version: 1,
  levels: [4, 3, 2, 1, 0].map((level) => ({ level, label: `L${level}`, description: 'x' })),
  domains: [
    {
      id: 'dom',
      name: 'Domain',
      skills: SKILLS.map((id) => ({ id, name: `Skill ${id.toUpperCase()}`, description: 'x', roles: ['dev'] })),
    },
  ],
} satisfies Taxonomy;

function article(id: number, skills: [string, boolean][], extra: Partial<ArticleCard> = {}): ArticleCard {
  return {
    id,
    title: `Article ${id}`,
    url: `https://example.com/${id}`,
    sourceId: 's1',
    sourceName: 'Source One',
    publishedAt: '2026-03-01T10:00:00.000Z',
    wordCount: 1000,
    difficulty: 0,
    type: 'tutorial',
    quality: 3,
    skills: skills.map(([sid, isPrimary]) => ({ id: sid, name: sid, isPrimary })),
    ...extra,
  };
}

const sources: SourceSummary[] = [
  { id: 's1', name: 'Source One' },
  { id: 's2', name: 'Beta' },
  { id: 's3', name: 'Alpha' },
];

/** Every character is 6px wide at any font: enough to test wrapping and fitting. */
const measure: Measure = (s) => s.length * 6;
const fonts = { sans: 'Sans', mono: 'Mono' };

describe('toBoardData', () => {
  it('is null without articles or without any taxonomy skill', () => {
    expect(toBoardData([], sources, taxonomy)).toBeNull();
    expect(toBoardData([article(1, [['zzz', true]])], sources, taxonomy)).toBeNull();
  });

  it('counts articles per source, keeps zero-count sources from the list and adds unlisted ones', () => {
    const data = toBoardData(
      [
        article(1, [['a', true]]),
        article(2, [['a', true]], { sourceId: 's2', sourceName: 'Beta' }),
        article(3, [['a', true]]),
        article(4, [['a', true]], { sourceId: 'x', sourceName: 'Unlisted' }),
      ],
      sources,
      taxonomy,
    )!;
    expect(data.sources).toEqual([
      { name: 'Source One', count: 2 },
      { name: 'Beta', count: 1 },
      { name: 'Unlisted', count: 1 },
      { name: 'Alpha', count: 0 },
    ]);
  });

  it('works without the source list (only sources seen on articles)', () => {
    const data = toBoardData([article(1, [['a', true]])], null, taxonomy)!;
    expect(data.sources).toEqual([{ name: 'Source One', count: 1 }]);
  });

  it('focuses the five skills with the most articles (primary or not), ties to the newest', () => {
    const data = toBoardData(
      [
        article(1, [['g', true]]),
        article(2, [['b', true], ['a', false]]),
        article(3, [['a', true], ['zzz', false]]),
        article(4, [['c', true], ['b', false]]),
        article(5, [['d', true]]),
        article(6, [['e', true]]),
        article(7, [['f', true], ['a', false]]),
      ],
      sources,
      taxonomy,
    )!;
    expect(data.focus.map((f) => [f.id, f.count])).toEqual([
      ['a', 3],
      ['b', 2],
      ['g', 1],
      ['c', 1],
      ['d', 1],
    ]);
    expect(data.focus[0]!.name).toBe('Skill A');
    expect(data.skillTotal).toBe(SKILLS.length);
    expect(data.titles).toHaveLength(7);
  });

  it('builds the staircase from focus articles only, easiest first, with level labels', () => {
    const arts = [
      article(1, [['a', true]], { difficulty: 3 }),
      article(2, [['a', true]], { difficulty: 0 }),
      article(3, [['zzz', true]], { difficulty: 1 }),
      article(4, [['b', true]], { difficulty: 2 }),
      article(5, [['a', true]], { difficulty: 4 }),
    ];
    const data = toBoardData(arts, sources, taxonomy)!;
    expect(data.steps.map((s) => s.title)).toEqual(['Article 2', 'Article 4', 'Article 1', 'Article 5']);
    expect(data.steps.map((s) => s.level)).toEqual(['L0', 'L2', 'L3', 'L4']);
  });
});

describe('pickSteps', () => {
  it('spreads over the levels round robin, at most n, ordered easiest first', () => {
    const items = [
      { title: 'x'.repeat(44), difficulty: 0 },
      { title: 'y'.repeat(10), difficulty: 0 },
      { title: 'z'.repeat(44), difficulty: 2 },
      { title: 'w'.repeat(44), difficulty: 4 },
      { title: 'v'.repeat(44), difficulty: 4 },
    ];
    const out = pickSteps(items, 4);
    expect(out.map((a) => a.difficulty)).toEqual([0, 0, 2, 4]);
    // The best-fitting title of a level comes first.
    expect(out[0]!.title).toBe('x'.repeat(44));
    expect(pickSteps(items, 10)).toHaveLength(5);
    expect(pickSteps([], 6)).toEqual([]);
  });
});

describe('text fitting', () => {
  it('cuts with an ellipsis and wraps to a line budget', () => {
    expect(fit('hello world', 66, 'f', measure)).toBe('hello world');
    expect(fit('hello world', 36, 'f', measure)).toBe('hello…');
    expect(fit('hello', 3, 'f', measure)).toBe('');
    expect(wrap('one two three four', 48, 'f', 3, measure)).toEqual(['one two', 'three', 'four']);
    const two = wrap('one two three four five six', 48, 'f', 2, measure);
    expect(two).toHaveLength(2);
    expect(two[1]!.endsWith('…')).toBe(true);
  });
});

describe('boardGrid', () => {
  it('uses a 7px grid on phones and 12px from the md breakpoint, centred', () => {
    const phone = boardGrid(390, 724);
    expect(phone).toMatchObject({ mobile: true, S: 7, D: 3, pad: 16 });
    const desk = boardGrid(1440, 844);
    expect(desk).toMatchObject({ mobile: false, S: 12, D: 4, pad: 40 });
    for (const g of [phone, desk]) {
      const right = g.width - (g.ox + (g.cols - 1) * g.S + g.D);
      expect(Math.abs(right - g.ox)).toBeLessThanOrEqual(1);
      expect(g.ox).toBeGreaterThanOrEqual(0);
      expect(g.oy).toBeGreaterThanOrEqual(0);
    }
  });

  it('places the wordmark inside the grid', () => {
    for (const g of [boardGrid(390, 724), boardGrid(1440, 844)]) {
      const p = wordmarkPlacement(g, 1.9);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.size * 1.9).toBeLessThanOrEqual(g.cols);
      expect(p.baseline).toBeLessThan(g.rows);
      expect(p.baseline - p.size * 0.75).toBeGreaterThan(0);
    }
  });
});

function sampleData(): BoardData {
  const arts = Array.from({ length: 40 }, (_, i) =>
    article(i + 1, [[SKILLS[i % 6]!, true]], {
      difficulty: i % 5,
      sourceId: `s${(i % 3) + 1}`,
      sourceName: sources[i % 3]!.name,
      title: `A reasonably long article title number ${i + 1}`,
    }),
  );
  return toBoardData(arts, [...sources, { id: 's4', name: 'Quiet source' }], taxonomy)!;
}

function view(width: number, height: number): BoardView {
  return {
    width,
    height,
    copyBottoms: [180, 160, 170],
    headline: { x0: 40, y0: height - 300, x1: 900, y1: height - 80 },
    wordmark: [
      [3, 4],
      [4, 4],
      [9999, 4],
    ],
  };
}

describe('layoutBoard', () => {
  for (const [w, h] of [
    [1440, 844],
    [390, 724],
  ] as const) {
    it(`keeps every target on the board and under the act text (${w}×${h})`, () => {
      const data = sampleData();
      const L = layoutBoard(data, view(w, h), fonts, measure);
      const [t2, t3, t4, t5] = L.targets;
      for (const t of [...t2, ...t3, ...t4, ...t5]) {
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.x).toBeLessThanOrEqual(w);
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.y).toBeLessThanOrEqual(h);
      }
      expect(Math.min(...t2.map((t) => t.y))).toBeGreaterThan(180);
      expect(Math.min(...t3.map((t) => t.y))).toBeGreaterThan(160);
      expect(Math.min(...t4.map((t) => t.y))).toBeGreaterThan(170);
      // One bar per source (the zero-count one included, with no dots); five focus bars; six steps.
      expect(L.bars2.map((b) => b.count)).toEqual(data.sources.map((s) => s.count));
      expect(L.bars2.at(-1)!.count).toBe(0);
      expect(L.bars3).toHaveLength(5);
      expect(L.steps).toHaveLength(6);
      // The wordmark keeps only cells on the grid.
      expect(t5).toHaveLength(2);
      expect(t5.every((t) => t.tone === Tone.word)).toBe(true);
      expect(L.minParticles).toBe(w < 768 ? 650 : 1100);
    });
  }

  it('builds a staircase that rises left to right on desktop and steps down on phones', () => {
    const desk = layoutBoard(sampleData(), view(1440, 844), fonts, measure).steps;
    for (let i = 1; i < desk.length; i++) {
      expect(desk[i]!.x).toBeGreaterThan(desk[i - 1]!.x);
      expect(desk[i]!.y).toBeLessThan(desk[i - 1]!.y);
    }
    const phone = layoutBoard(sampleData(), view(390, 724), fonts, measure).steps;
    for (let i = 1; i < phone.length; i++) expect(phone[i]!.y).toBeGreaterThan(phone[i - 1]!.y);
  });

  it('keeps the noise back under the headline', () => {
    const L = layoutBoard(sampleData(), view(1440, 844), fonts, measure);
    const g = L.grid;
    const c = Math.round((400 - g.ox) / g.S);
    const r = Math.round((844 - 200 - g.oy) / g.S);
    expect(L.mask[r * g.cols + c]).toBeLessThan(1);
    expect(L.mask[0]).toBe(1);
  });
});

describe('buildParticles', () => {
  it('lights exactly the targets of each state and is deterministic', () => {
    const L = layoutBoard(sampleData(), view(1440, 844), fonts, measure);
    const p = buildParticles(L);
    expect(p.count).toBeGreaterThanOrEqual(Math.max(L.minParticles, ...L.targets.map((t) => t.length)));
    expect(Array.from(p.states[0]!.on).every((v) => v === 1)).toBe(true);
    L.targets.forEach((T, k) => {
      const s = p.states[k + 1]!;
      const lit: string[] = [];
      for (let j = 0; j < p.count; j++) if (s.on[j]) lit.push(`${s.x[j]},${s.y[j]}`);
      expect(lit.toSorted()).toEqual(T.map((t) => `${t.x},${t.y}`).toSorted());
    });
    const again = buildParticles(L);
    expect(Array.from(again.states[2]!.x)).toEqual(Array.from(p.states[2]!.x));
  });
});

describe('timing', () => {
  it('staggers forward left to right and plays the reverse backwards', () => {
    expect(dotDelay(0, 0, 1000, true)).toBe(0);
    expect(dotDelay(1, 1000, 1000, true)).toBe(1);
    expect(dotDelay(0, 0, 1000, false)).toBe(1);
    expect(dotDelay(1, 1000, 1000, false)).toBe(0);
    // Every dot has arrived by the end of the transition, none has left at its start.
    expect(dotProgress(1, 1)).toBe(1);
    expect(dotProgress(0, 0)).toBe(0);
  });
});
