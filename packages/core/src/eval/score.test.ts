import { describe, expect, it } from 'vitest';
import type { GoldenItem, LabelOutput } from '@attn/shared';
import { buildReport, findDisagreements, formatEvalReport, jaccard, scoreItem } from './score';

const golden = (over: Partial<GoldenItem> = {}): GoldenItem => ({
  url: 'http://x.test/a',
  primary_skill: 'cc-hooks',
  secondary_skills: [],
  difficulty: 2,
  type: 'tutorial',
  quality: 3,
  ...over,
});
const label = (over: Partial<LabelOutput> = {}): LabelOutput => ({
  primary_skill: 'cc-hooks',
  secondary_skills: [],
  difficulty: 2,
  type: 'tutorial',
  quality: 3,
  ...over,
});

describe('jaccard', () => {
  it('handles empties, overlap, order and duplicates', () => {
    expect(jaccard([], [])).toBe(1);
    expect(jaccard(['a'], [])).toBe(0);
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3);
    expect(jaccard(['a', 'b'], ['b', 'a', 'a'])).toBe(1);
  });
});

describe('scoreItem', () => {
  it('scores difficulty exact and within 1', () => {
    expect(scoreItem(golden({ difficulty: 2 }), label({ difficulty: 3 }))).toMatchObject({
      difficultyExact: false,
      difficultyWithin1: true,
    });
    expect(scoreItem(golden({ difficulty: 2 }), label({ difficulty: 4 }))).toMatchObject({
      difficultyExact: false,
      difficultyWithin1: false,
    });
  });
  it('scores quality within 1, primary and type exact', () => {
    expect(scoreItem(golden({ quality: 3 }), label({ quality: 4 })).qualityWithin1).toBe(true);
    expect(scoreItem(golden({ quality: 4 }), label({ quality: 2 })).qualityWithin1).toBe(false);
    const s = scoreItem(golden(), label({ primary_skill: 'cc-mcp-usage', type: 'news' }));
    expect(s.primary).toBe(false);
    expect(s.typeExact).toBe(false);
    expect(scoreItem(golden(), label())).toMatchObject({ primary: true, typeExact: true, secondaryJaccard: 1 });
  });
});

describe('findDisagreements', () => {
  it('is empty for identical items', () => {
    expect(findDisagreements('u', golden(), label())).toEqual([]);
  });
  it('lists difficulty off by one but not quality off by one', () => {
    const d = findDisagreements('u', golden(), label({ difficulty: 3, quality: 4 }));
    expect(d).toEqual([{ url: 'u', field: 'difficulty', expected: '2', actual: '3' }]);
  });
  it('lists differing secondary skills', () => {
    const d = findDisagreements(
      'u',
      golden({ secondary_skills: ['cc-hooks'] }),
      label({ secondary_skills: ['cc-hooks', 'cc-plugins'] }),
    );
    expect(d).toEqual([{ url: 'u', field: 'secondary_skills', expected: 'cc-hooks', actual: 'cc-hooks,cc-plugins' }]);
  });
  it('renders empty secondary as -', () => {
    const d = findDisagreements('u', golden(), label({ secondary_skills: ['cc-hooks'] }));
    expect(d[0]).toMatchObject({ expected: '-', actual: 'cc-hooks' });
  });
});

const scenario = () =>
  buildReport({
    model: 'fake-model',
    total: 4,
    failures: [{ url: 'http://x.test/g4', error: 'HTTP 404 for http://x.test/g4' }],
    rateLimited: false,
    scored: [
      {
        url: 'http://x.test/g1',
        expected: golden({ primary_skill: 'context-engineering', secondary_skills: ['cc-hooks'], difficulty: 2 }),
        actual: label({
          primary_skill: 'context-engineering',
          secondary_skills: ['cc-hooks', 'cc-plugins'],
          difficulty: 3,
        }),
      },
      {
        url: 'http://x.test/g2',
        expected: golden({ difficulty: 3, type: 'deep_dive', quality: 4 }),
        actual: label({ primary_skill: 'cc-subagents', difficulty: 3, type: 'news', quality: 2 }),
      },
      {
        url: 'http://x.test/g3',
        expected: golden({
          primary_skill: 'cc-mcp-usage',
          secondary_skills: ['cc-plugins', 'cc-hooks'],
          difficulty: 1,
          type: 'release',
          quality: 2,
        }),
        actual: label({
          primary_skill: 'cc-mcp-usage',
          secondary_skills: ['cc-hooks', 'cc-plugins'],
          difficulty: 1,
          type: 'release',
          quality: 3,
        }),
      },
    ],
  });

describe('buildReport', () => {
  it('computes the scenario metrics', () => {
    const r = scenario();
    expect(r.evaluated).toBe(3);
    expect(r.total).toBe(4);
    expect(r.metrics!.primary_skill).toBeCloseTo(2 / 3);
    expect(r.metrics!.secondary_skills).toBeCloseTo(2.5 / 3);
    expect(r.metrics!.difficulty_exact).toBeCloseTo(2 / 3);
    expect(r.metrics!.difficulty_within1).toBe(1);
    expect(r.metrics!.type).toBeCloseTo(2 / 3);
    expect(r.metrics!.quality_within1).toBeCloseTo(2 / 3);
  });
  it('has null metrics when nothing was scored', () => {
    const r = buildReport({ model: 'm', total: 2, scored: [], failures: [], rateLimited: false });
    expect(r.metrics).toBeNull();
    expect(r.evaluated).toBe(0);
  });
});

describe('formatEvalReport', () => {
  it('prints the pinned layout', () => {
    const out = formatEvalReport(scenario());
    for (const s of [
      'model: fake-model',
      'articles: evaluated=3 of 4 failed=1',
      'primary_skill'.padEnd(20) + '66.7%',
      'secondary_skills'.padEnd(20) + '83.3%',
      'difficulty_exact'.padEnd(20) + '66.7%',
      'difficulty_within1'.padEnd(20) + '100.0%',
      'type'.padEnd(20) + '66.7%',
      'quality_within1'.padEnd(20) + '66.7%',
      'disagreements:',
      '    secondary_skills: expected=cc-hooks actual=cc-hooks,cc-plugins',
      '    primary_skill: expected=cc-hooks actual=cc-subagents',
      'failed:',
    ]) {
      expect(out).toContain(s);
    }
    expect(out).not.toContain('rate limited');
  });
  it('handles no metrics and rate limit', () => {
    const out = formatEvalReport(buildReport({ model: 'm', total: 1, scored: [], failures: [], rateLimited: true }));
    expect(out).toContain('no articles evaluated');
    expect(out).toContain('rate limited: evaluation stopped early');
    expect(out).not.toContain('disagreements:');
  });
  it('ends with the token totals, after a stop line, and omits cache fields the provider did not report', () => {
    const base = { model: 'm', total: 1, scored: [], failures: [], rateLimited: true };
    const full = formatEvalReport(
      buildReport({ ...base, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 0 } }),
    ).split('\n');
    expect(full.at(-2)).toBe('rate limited: evaluation stopped early');
    expect(full.at(-1)).toBe('tokens: input=100 output=20 cache_read=80 cache_write=0');
    const bare = formatEvalReport(buildReport({ ...base, usage: { inputTokens: 100, outputTokens: 20 } })).split('\n');
    expect(bare.at(-1)).toBe('tokens: input=100 output=20');
  });
});

describe('formatEvalReport per-model usage', () => {
  it('prints one indented line per model after the total', () => {
    const base = { model: 'a+b', total: 1, scored: [], failures: [], rateLimited: false };
    const out = formatEvalReport(
      buildReport({
        ...base,
        usage: { inputTokens: 30, outputTokens: 5 },
        usageByModel: { a: { inputTokens: 20, outputTokens: 3 }, b: { inputTokens: 10, outputTokens: 2 } },
      }),
    ).split('\n');
    expect(out.slice(-3)).toEqual([
      'tokens: input=30 output=5',
      '  a  tokens: input=20 output=3',
      '  b  tokens: input=10 output=2',
    ]);
  });
});
