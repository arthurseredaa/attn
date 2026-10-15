import { describe, expect, it } from 'vitest';
import type { ArticleCard, Taxonomy } from '@attn/shared';
import {
  bandOpacity,
  chipBudget,
  chipPose,
  layoutScene,
  listOrder,
  pickChips,
  restingProgress,
  seeded,
  storyAt,
  toSceneData,
  type SceneData,
} from './landing-scene';

const SKILLS = ['a', 'b', 'c', 'd', 'e', 'f'];
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
    sourceId: `src-${id % 3}`,
    sourceName: `Source ${id % 3}`,
    publishedAt: '2026-10-01T00:00:00.000Z',
    wordCount: 1000,
    difficulty: (id % 5) as ArticleCard['difficulty'],
    type: 'tutorial',
    quality: 3,
    skills: skills.map(([sid, isPrimary]) => ({ id: sid, name: sid, isPrimary })),
    ...extra,
  };
}

// Counts: a 4, b 3, c 3, d 2, e 1, f 1 (f appears later than e), plus one article on an unknown skill.
const ARTICLES: ArticleCard[] = [
  article(1, [['a', true]]),
  article(2, [['b', false], ['a', true]]),
  article(3, [['c', true], ['b', false]]),
  article(4, [['a', true], ['d', false]]),
  article(5, [['e', true]]),
  article(6, [['zzz', true]]),
  article(7, [['b', true], ['c', false]]),
  article(8, [['a', true], ['c', false]]),
  article(9, [['f', true], ['d', false]]),
  article(10, []),
];

describe('toSceneData', () => {
  it('picks the five skills with the most articles, ties by first appearance, names from the taxonomy', () => {
    const data = toSceneData(ARTICLES, taxonomy)!;
    expect(data.skills.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(data.skills[0]!.name).toBe('Skill A');
    expect(data.difficultyLabels).toEqual(['L0', 'L1', 'L2', 'L3', 'L4']);
  });
  it('puts the primary skill first', () => {
    expect(toSceneData(ARTICLES, taxonomy)!.articles[1]!.skills).toEqual(['a', 'b']);
  });
  it('is null for an empty pool', () => {
    expect(toSceneData([], taxonomy)).toBeNull();
    expect(toSceneData([article(1, [['zzz', true]])], taxonomy)).toBeNull();
  });
});

describe('pickChips / listOrder', () => {
  const data = toSceneData(ARTICLES, taxonomy)!;
  it('caps chips per focus skill and outside the focus, out-of-focus first', () => {
    const chips = pickChips(data, { perSkill: 1, others: 2 });
    expect(chips.map((c) => [c.article.id, c.focus])).toEqual([
      [6, null],
      [10, null],
      [1, 0],
      [3, 2],
      [5, 4],
      [7, 1],
      [9, 3],
    ]);
  });
  it('orders the list by focus rank, then easiest first', () => {
    const chips = pickChips(data, { perSkill: 5, others: 0 });
    const ids = listOrder(chips, data).map((c) => c.article.id);
    // a: 1 (difficulty 1), 2 (2), 8 (3), 4 (4); then b: 7; c: 3; d: 9 (via its second skill); e: 5.
    expect(ids).toEqual([1, 2, 8, 4, 7, 3, 9, 5]);
  });
});

describe('layoutScene', () => {
  const data: SceneData = toSceneData(ARTICLES, taxonomy)!;
  it('is deterministic and keeps every resting pose on stage', () => {
    for (const [w, h] of [
      [358, 440],
      [520, 600],
      [760, 640],
    ] as const) {
      const chips = pickChips(data, chipBudget(w));
      const a = layoutScene(chips, data, w, h);
      expect(layoutScene(chips, data, w, h)).toEqual(a);
      for (const chip of a.chips) {
        for (const pose of chip.poses.slice(0, 3)) {
          expect(pose.x).toBeGreaterThanOrEqual(0);
          expect(pose.x).toBeLessThanOrEqual(w);
          expect(pose.y).toBeGreaterThanOrEqual(0);
          expect(pose.y).toBeLessThanOrEqual(h);
        }
      }
      expect(a.rows.length).toBeLessThanOrEqual(chips.filter((c) => c.focus !== null).length);
      expect(a.rows.at(-1)!.y + a.rowH).toBeLessThanOrEqual(h);
    }
  });
  it('rests at each act and ends with every chip handed over to the list', () => {
    const chips = pickChips(data, chipBudget(760));
    const a = layoutScene(chips, data, 760, 640);
    for (const chip of a.chips) {
      expect(chipPose(chip, 0)).toMatchObject(chip.poses[0]);
      expect(chipPose(chip, restingProgress(1))).toMatchObject(chip.poses[1]);
      expect(chipPose(chip, restingProgress(2))).toMatchObject(chip.poses[2]);
      expect(chipPose(chip, 1).o).toBe(0);
    }
  });
});

describe('timeline helpers', () => {
  it('maps scroll progress onto the four acts with holds', () => {
    expect(storyAt(0)).toBe(0);
    expect(storyAt(0.05)).toBe(0);
    expect(storyAt(restingProgress(1))).toBe(1);
    expect(storyAt(restingProgress(2))).toBe(2);
    expect(storyAt(1)).toBe(3);
    expect(storyAt(0.2)).toBeGreaterThan(0);
    expect(storyAt(0.2)).toBeLessThan(1);
  });
  it('fades bands in and out around their act', () => {
    expect(bandOpacity(1, 1)).toBe(1);
    expect(bandOpacity(1.1, 1)).toBe(1);
    expect(bandOpacity(1.5, 1)).toBe(0);
    expect(bandOpacity(1.3, 1)).toBeCloseTo(0.5);
  });
  it('seeds stay in [0, 1) and differ by salt', () => {
    const xs = Array.from({ length: 200 }, (_, i) => seeded(i, 1));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    expect(seeded(5, 1)).not.toBe(seeded(5, 2));
  });
});
