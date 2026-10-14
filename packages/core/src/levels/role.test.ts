import type { Taxonomy } from '@attn/shared';
import { describe, expect, it } from 'vitest';
import { assertValidFocus, FocusError, roleSkillIds } from './role';

const sk = (id: string, roles: string[]) => ({ id, name: id, description: id, roles });
const t = {
  version: 1,
  levels: [],
  domains: [
    { id: 'd1', name: 'd1', skills: [sk('a', ['dev']), sk('b', ['dev', 'pm'])] },
    { id: 'd2', name: 'd2', skills: [sk('c', ['pm'])] },
  ],
} as unknown as Taxonomy;

describe('roleSkillIds', () => {
  it('returns role skills in taxonomy order', () => {
    expect(roleSkillIds(t, 'dev')).toEqual(['a', 'b']);
    expect(roleSkillIds(t, 'pm')).toEqual(['b', 'c']);
    expect(roleSkillIds(t, 'nope')).toEqual([]);
  });
});

describe('assertValidFocus', () => {
  const code = (focus: string[], skills: string[]) => {
    try {
      assertValidFocus(focus, skills);
    } catch (e) {
      expect(e).toBeInstanceOf(FocusError);
      return (e as FocusError).code;
    }
    return 'ok';
  };
  it('accepts a valid focus', () => expect(code(['a', 'b'], ['a', 'b'])).toBe('ok'));
  it('rejects bad focus', () => {
    expect(code([], ['a'])).toBe('empty');
    expect(code(['a', 'b', 'c', 'd', 'e', 'f'], ['a', 'b', 'c', 'd', 'e', 'f'])).toBe('too_many');
    expect(code(['a', 'a'], ['a'])).toBe('duplicate');
    expect(code(['z'], ['a'])).toBe('unknown_skill');
  });
});
