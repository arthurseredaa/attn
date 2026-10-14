import { describe, it, expect } from 'vitest';
import { loadTaxonomy, loadSources, loadConfig } from './data';

describe('real data files', () => {
  it('taxonomy: 6 domains, 32 skills, all dev, 5 levels, English-only', () => {
    const t = loadTaxonomy();
    expect(t.domains).toHaveLength(6);
    const skills = t.domains.flatMap((d) => d.skills);
    expect(skills).toHaveLength(32);
    expect(skills.every((s) => s.roles.includes('dev'))).toBe(true);
    expect(t.levels.map((l) => l.level)).toEqual([0, 1, 2, 3, 4]);
    const text = JSON.stringify(t);
    expect(text).not.toMatch(/[Ѐ-ӿ]/); // no Cyrillic left
  });
  it('sources: exactly the 13 first-party ids', () => {
    const ids = loadSources().map((s) => s.id).sort();
    expect(ids).toEqual([
      'addy-osmani','ai-hero','anthropic-engineering','anthropic-news','claude-dev','cloudflare-ai',
      'github-blog-ai','hamel-evals','latent-space','mcp-blog','mozilla-ai-blog',
      'simon-willison','vercel',
    ]);
  });
  it('vercel filter keeps /blog/ only', () => {
    const v = loadSources().find((s) => s.id === 'vercel');
    expect(v?.filter?.path_prefix).toEqual(['/blog/']);
  });
  it('config: loads and matches spec-stated values', () => {
    const c = loadConfig();
    expect(c).toMatchObject({ points_per_level: 5, interest_decay: 0.8, interest_min: 0.2,
      quality_min: 2, background_quality_min: 4, fresh_days: 14, page_size: 20 });
  });
});
