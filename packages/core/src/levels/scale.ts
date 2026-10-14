import type { Level } from '@attn/shared';

export const UNASSESSED_LEVEL = 1;
export const MAX_LEVEL = 4;

/** A skill without a quiz result is treated as level 1. */
export function effectiveLevel(level: number | null): Level {
  return (level ?? UNASSESSED_LEVEL) as Level;
}

/** A skill without a quiz result is always uncertain. */
export function effectiveUncertain(level: number | null, uncertain: boolean): boolean {
  return level === null ? true : uncertain;
}
