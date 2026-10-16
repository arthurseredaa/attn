import { describe, it, expect } from 'vitest';
import { loadTaxonomy, loadSources, loadConfig } from './data';
import { exclusionRule } from './collect/filter';

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
  it('sources: exactly the 14 ids (mozilla-ai-blog and jetbrains-ai dropped, simon-willison tag feeds, philschmid added)', () => {
    const ids = loadSources()
      .map((s) => s.id)
      .sort();
    expect(ids).toEqual([
      'addy-osmani',
      'ai-hero',
      'anthropic-engineering',
      'anthropic-news',
      'claude-dev',
      'cloudflare-ai',
      'github-blog-ai',
      'hamel-evals',
      'latent-space',
      'mcp-blog',
      'philschmid',
      'simon-willison',
      'simon-willison-claude-code',
      'vercel',
    ]);
  });
  it('sources: new feeds, and no collect rule for anthropic-news or the new unfiltered sources', () => {
    const by = new Map(loadSources().map((s) => [s.id, s]));
    expect(by.get('simon-willison')?.url).toBe('https://simonwillison.net/tags/ai-assisted-programming.atom');
    expect(by.get('simon-willison-claude-code')?.url).toBe('https://simonwillison.net/tags/claude-code.atom');
    expect(by.get('philschmid')?.url).toBe('https://www.philschmid.de/rss');
    expect(by.has('jetbrains-ai')).toBe(false);
    for (const id of ['anthropic-news', 'philschmid']) expect(by.get(id)?.filter).toBeUndefined();
  });
  it('sources: the owner-approved exclusion rules block exactly the intended urls', () => {
    const by = new Map(loadSources().map((s) => [s.id, s]));
    const rule = (id: string, path: string, title: string | null = 'AI') =>
      exclusionRule({ url: `https://x.test${path}`, title }, by.get(id)?.filter);
    for (const p of [
      '/skills',
      '/skills-catalog',
      '/newsletter',
      '/ai-coding-dictionary',
      '/skills/subscribe',
      '/workshops/x',
    ]) {
      expect(rule('ai-hero', p)).not.toBeNull();
    }
    expect(rule('ai-hero', '/skills/tdd')).toBeNull();
    expect(rule('ai-hero', '/tutorials/x')).toBeNull();
    expect(rule('vercel', '/blog/how-rogo-ships-agent-code-on-vercel')).toBe('exclude_path_regex');
    expect(rule('vercel', '/blog/2026-vercel-ai-accelerator-recap')).toBe('exclude_path_regex');
    expect(rule('vercel', '/blog/ai-gateway-ga')).toBeNull();
    for (const t of [
      'Birthday Week 2026',
      "Annual Founders' Letter",
      'Everything we launched during X',
      'One year of Y',
      'Sovereign AI',
      'Civil Society',
    ]) {
      expect(rule('cloudflare-ai', '/p', t)).toBe('exclude_title_regex');
    }
    expect(rule('cloudflare-ai', '/p', 'Building agents on Workers')).toBeNull();
  });
  it('vercel filter keeps /blog/ only', () => {
    const v = loadSources().find((s) => s.id === 'vercel');
    expect(v?.filter?.path_prefix).toEqual(['/blog/']);
  });
  it('config: loads and matches spec-stated values', () => {
    const c = loadConfig();
    expect(c).toMatchObject({
      points_per_level: 5,
      interest_decay: 0.8,
      interest_min: 0.2,
      quality_min: 2,
      background_quality_min: 4,
      fresh_days: 14,
      page_size: 20,
      label_overload_backoff_ms: [2000, 5000, 10000],
      jev_secondary_threshold: 0.5,
      relevance_threshold: 0.3,
    });
  });
});
