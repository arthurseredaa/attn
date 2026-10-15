import { AppValidationError } from './zod';

/** 400 for any skill id that is not in the taxonomy. */
export function assertKnownSkills(skills: readonly string[] | undefined, known: ReadonlySet<string>): void {
  const bad = skills?.find((s) => !known.has(s));
  if (bad !== undefined) throw new AppValidationError(`skill: unknown skill "${bad.slice(0, 60)}"`);
}
