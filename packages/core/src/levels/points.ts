import { effectiveLevel, MAX_LEVEL } from './scale';

export interface SkillProgress {
  level: number | null;
  points: number;
}

export function applyReadPoint(
  state: SkillProgress,
  articleDifficulty: number,
  pointsPerLevel: number,
): SkillProgress & { awarded: boolean; leveledUp: boolean } {
  const eff = effectiveLevel(state.level);
  if (eff >= MAX_LEVEL || articleDifficulty < eff) {
    return { ...state, awarded: false, leveledUp: false };
  }
  const points = state.points + 1;
  if (points >= pointsPerLevel) {
    return { level: eff + 1, points: 0, awarded: true, leveledUp: true };
  }
  return { level: state.level, points, awarded: true, leveledUp: false };
}

/** Progress toward the next level; null at the cap. */
export function progressToNext(
  level: number | null,
  points: number,
  pointsPerLevel: number,
): { points: number; needed: number } | null {
  if (effectiveLevel(level) >= MAX_LEVEL) return null;
  return { points, needed: pointsPerLevel };
}
