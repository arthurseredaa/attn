import { MAX_FOCUS, type Taxonomy } from '@attn/shared';

/** Skills of a role, in taxonomy order. */
export function roleSkillIds(taxonomy: Taxonomy, role: string): string[] {
  return taxonomy.domains.flatMap((d) => d.skills.filter((s) => s.roles.includes(role)).map((s) => s.id));
}

export class FocusError extends Error {
  constructor(
    public readonly code: 'empty' | 'too_many' | 'duplicate' | 'unknown_skill',
    message: string,
  ) {
    super(message);
    this.name = 'FocusError';
  }
}

export function assertValidFocus(focus: string[], roleSkills: string[]): void {
  if (focus.length === 0) throw new FocusError('empty', 'Pick at least one focus skill');
  if (focus.length > MAX_FOCUS) throw new FocusError('too_many', `Pick at most ${MAX_FOCUS} focus skills`);
  if (new Set(focus).size !== focus.length) throw new FocusError('duplicate', 'Focus skills must be unique');
  const known = new Set(roleSkills);
  const unknown = focus.find((id) => !known.has(id));
  if (unknown !== undefined) throw new FocusError('unknown_skill', `Not a skill of this role: ${unknown}`);
}
