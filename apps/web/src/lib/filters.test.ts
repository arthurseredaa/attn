import { describe, expect, it } from 'vitest';
import { filterParams, hasActiveFilters, pickFilters, toggleSkill } from './filters';
import { buildQueryString } from './query';

describe('pickFilters (URL -> state)', () => {
  it('reads repeated skill params, a single one, and none', () => {
    expect(pickFilters({ skill: ['a', 'b'] }).skill).toEqual(['a', 'b']);
    expect(pickFilters({ skill: 'a' }).skill).toEqual(['a']);
    expect(pickFilters({}).skill).toEqual([]);
  });

  it('drops blanks and duplicates and caps the list at 10', () => {
    expect(pickFilters({ skill: ['a', '', 'a', 'b'] }).skill).toEqual(['a', 'b']);
    const many = Array.from({ length: 15 }, (_, i) => `s${i}`);
    expect(pickFilters({ skill: many }).skill).toHaveLength(10);
  });

  it('trims q and caps it at 100 characters', () => {
    expect(pickFilters({ q: '  rag  ' }).q).toBe('rag');
    expect(pickFilters({}).q).toBe('');
    expect(pickFilters({ q: 'x'.repeat(150) }).q).toHaveLength(100);
  });

  it('keeps source, from, to and cursor', () => {
    expect(pickFilters({ source: 's', from: '2026-01-01', to: '2026-02-01', cursor: 'c' })).toEqual({
      skill: [],
      q: '',
      source: 's',
      from: '2026-01-01',
      to: '2026-02-01',
      cursor: 'c',
    });
  });
});

describe('state -> URL', () => {
  it('round-trips through the query string', () => {
    const state = { skill: ['a', 'b'], q: 'agents & more', source: 'src', from: '2026-01-01', to: undefined };
    const qs = buildQueryString(filterParams(state));
    expect(qs).toBe('?skill=a&skill=b&q=agents+%26+more&source=src&from=2026-01-01');
    const parsed = Object.fromEntries(
      [...new Set([...new URLSearchParams(qs).keys()])].map((k) => {
        const all = new URLSearchParams(qs).getAll(k);
        return [k, all.length > 1 ? all : all[0]];
      }),
    );
    expect(pickFilters(parsed)).toMatchObject({
      skill: ['a', 'b'],
      q: 'agents & more',
      source: 'src',
      from: '2026-01-01',
    });
  });

  it('writes nothing for empty filters', () => {
    expect(buildQueryString(filterParams({ skill: [], q: '' }))).toBe('');
  });
});

describe('toggleSkill and hasActiveFilters', () => {
  it('adds, removes and respects the cap', () => {
    expect(toggleSkill(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleSkill(['a', 'b'], 'a')).toEqual(['b']);
    const ten = Array.from({ length: 10 }, (_, i) => `s${i}`);
    expect(toggleSkill(ten, 'x')).toEqual(ten);
    expect(toggleSkill(ten, 's3')).toHaveLength(9);
  });

  it('detects any narrowing filter', () => {
    expect(hasActiveFilters({ skill: [], q: '' })).toBe(false);
    expect(hasActiveFilters({ skill: ['a'], q: '' })).toBe(true);
    expect(hasActiveFilters({ skill: [], q: 'x' })).toBe(true);
    expect(hasActiveFilters({ skill: [], q: '', from: '2026-01-01' })).toBe(true);
  });
});
