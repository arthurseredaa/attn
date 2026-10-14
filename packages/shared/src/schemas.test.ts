import { describe, it, expect } from 'vitest';
import {
  taxonomySchema,
  sourcesSchema,
  sourceSchema,
  configSchema,
  goldenSchema,
  quizSchema,
  articleTypeSchema,
} from './index';

const levels = [0, 1, 2, 3, 4].map((level) => ({ level, label: `L${level}`, description: `d${level}` }));
const skill = (id: string, roles: string[] = ['dev']) => ({ id, name: id, description: 'x', roles });
const taxonomy = (skills = [skill('a')]) => ({
  version: 1,
  levels,
  domains: [{ id: 'd1', name: 'D1', skills }],
});

const config = {
  backfill_days: 30,
  label_batch: 10,
  label_delay_ms: 500,
  label_max_chars: 8000,
  label_min_chars: 200,
  label_max_attempts: 3,
  schedule_cron: '0 * * * *',
  uncertain_spread: 1.5,
  points_per_level: 5,
  offset_k: 2,
  interest_decay: 0.8,
  interest_min: 0.2,
  quality_min: 2,
  background_quality_min: 4,
  fresh_days: 14,
  page_size: 20,
};

describe('taxonomySchema', () => {
  it('parses a minimal taxonomy', () => {
    expect(taxonomySchema.safeParse(taxonomy()).success).toBe(true);
  });
  it('rejects duplicate skill ids', () => {
    expect(taxonomySchema.safeParse(taxonomy([skill('a'), skill('a')])).success).toBe(false);
  });
  it('rejects a skill with empty roles', () => {
    expect(taxonomySchema.safeParse(taxonomy([skill('a', [])])).success).toBe(false);
  });
  it('rejects duplicate domain ids', () => {
    const t = taxonomy();
    t.domains.push({ id: 'd1', name: 'D1b', skills: [skill('b')] });
    expect(taxonomySchema.safeParse(t).success).toBe(false);
  });
  it('requires exactly five levels 0..4', () => {
    expect(taxonomySchema.safeParse({ ...taxonomy(), levels: levels.slice(0, 4) }).success).toBe(false);
  });
});

describe('sourcesSchema', () => {
  it('requires path_prefix for sitemap', () => {
    const r = sourcesSchema.safeParse([{ id: 'a', name: 'A', type: 'sitemap', url: 'https://x.test/s.xml' }]);
    expect(r.success).toBe(false);
  });
  it('rejects unknown type', () => {
    expect(sourceSchema.safeParse({ id: 'a', name: 'A', type: 'atom', url: 'https://x.test/f' }).success).toBe(false);
  });
  it('rejects duplicate ids', () => {
    const s = { id: 'a', name: 'A', type: 'rss', url: 'https://x.test/f' };
    expect(sourcesSchema.safeParse([s, s]).success).toBe(false);
  });
  it('accepts a filter on rss and sitemap', () => {
    const filter = { path_prefix: ['/blog/'], keywords: ['ai'] };
    expect(sourceSchema.safeParse({ id: 'a', name: 'A', type: 'rss', url: 'https://x.test/f', filter }).success).toBe(true);
    expect(
      sourceSchema.safeParse({ id: 'b', name: 'B', type: 'sitemap', url: 'https://x.test/s.xml', path_prefix: '/news/', filter }).success,
    ).toBe(true);
  });
  it('rejects filter path prefixes not starting with /', () => {
    const s = { id: 'a', name: 'A', type: 'rss', url: 'https://x.test/f', filter: { path_prefix: ['blog'] } };
    expect(sourceSchema.safeParse(s).success).toBe(false);
  });
});

describe('configSchema', () => {
  it('parses a full config', () => {
    expect(configSchema.safeParse(config).success).toBe(true);
  });
  it('rejects a missing key', () => {
    const rest: Partial<typeof config> = { ...config };
    delete rest.page_size;
    expect(configSchema.safeParse(rest).success).toBe(false);
  });
  it('rejects an extra key', () => {
    expect(configSchema.safeParse({ ...config, extra: 1 }).success).toBe(false);
  });
  it('rejects out-of-range values', () => {
    expect(configSchema.safeParse({ ...config, interest_decay: 0 }).success).toBe(false);
    expect(configSchema.safeParse({ ...config, quality_min: 5 }).success).toBe(false);
    expect(configSchema.safeParse({ ...config, page_size: 0 }).success).toBe(false);
  });
});

describe('goldenSchema', () => {
  const item = {
    url: 'https://x.test/a',
    primary_skill: 'a',
    difficulty: 2,
    type: 'news',
    quality: 3,
  };
  it('defaults secondary_skills to []', () => {
    const r = goldenSchema.parse([item]);
    expect(r[0]?.secondary_skills).toEqual([]);
  });
  it('rejects difficulty 5', () => {
    expect(goldenSchema.safeParse([{ ...item, difficulty: 5 }]).success).toBe(false);
  });
  it('rejects more than 3 secondary skills', () => {
    expect(goldenSchema.safeParse([{ ...item, secondary_skills: ['a', 'b', 'c', 'd'] }]).success).toBe(false);
  });
});

describe('quizSchema', () => {
  const q = (n: number) => ({
    id: 'q1',
    skill_id: 'a',
    situation: 's',
    options: Array.from({ length: n }, (_, i) => ({ text: `o${i}`, level: i % 5 })),
  });
  it('accepts 4 options', () => {
    expect(quizSchema.safeParse({ version: 1, questions: [q(4)] }).success).toBe(true);
  });
  it('rejects 3 options', () => {
    expect(quizSchema.safeParse({ version: 1, questions: [q(3)] }).success).toBe(false);
  });
});

describe('articleTypeSchema', () => {
  it('lists the five types', () => {
    expect(articleTypeSchema.options).toEqual(['release', 'tutorial', 'deep_dive', 'news', 'research']);
  });
});
