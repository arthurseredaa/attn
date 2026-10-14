import { describe, it, expect } from 'vitest';
import { buildLabelOutputSchema, normalizeLabel, taxonomySkillIds, type LabelOutput, type Taxonomy } from './index';

const ids = ['a', 'b', 'c'] as const;
const schema = buildLabelOutputSchema(ids);
const valid: LabelOutput = { primary_skill: 'a', secondary_skills: ['b'], difficulty: 2, type: 'tutorial', quality: 3 };

const levels = [0, 1, 2, 3, 4].map((level) => ({ level, label: `L${level}`, description: `d${level}` }));
const skill = (id: string) => ({ id, name: id, description: 'x', roles: ['dev'] });

describe('buildLabelOutputSchema', () => {
  it('accepts a valid label', () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });
  it('rejects a skill outside the taxonomy', () => {
    expect(schema.safeParse({ ...valid, primary_skill: 'bogus' }).success).toBe(false);
  });
  it('rejects more than 3 secondary skills', () => {
    expect(schema.safeParse({ ...valid, secondary_skills: ['a', 'b', 'c', 'a'] }).success).toBe(false);
  });
  it('rejects out-of-range difficulty and quality', () => {
    expect(schema.safeParse({ ...valid, difficulty: 5 }).success).toBe(false);
    expect(schema.safeParse({ ...valid, quality: -1 }).success).toBe(false);
  });
  it('rejects an unknown article type', () => {
    expect(schema.safeParse({ ...valid, type: 'blog' }).success).toBe(false);
  });
});

describe('normalizeLabel', () => {
  it('drops secondaries equal to the primary or repeated, keeping order', () => {
    const out = normalizeLabel({ ...valid, primary_skill: 'a', secondary_skills: ['a', 'b', 'b', 'c'] });
    expect(out.secondary_skills).toEqual(['b', 'c']);
  });
});

describe('taxonomySkillIds', () => {
  it('returns all skill ids in file order', () => {
    const t: Taxonomy = {
      version: 1,
      levels,
      domains: [
        { id: 'd1', name: 'D1', skills: [skill('x')] },
        { id: 'd2', name: 'D2', skills: [skill('y')] },
      ],
    };
    expect(taxonomySkillIds(t)).toEqual(['x', 'y']);
  });
  it('throws when there are no skills', () => {
    expect(() => taxonomySkillIds({ version: 1, levels, domains: [] })).toThrow('taxonomy has no skills');
  });
});
