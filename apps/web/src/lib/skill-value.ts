import type { Profile, ProfileSkill } from '@attn/shared';

/** One axis of a profile radar: a domain or a focus skill, its 0–4 value and the taxonomy label for that level. */
export type RadarPoint = { id: string; name: string; value: number; levelLabel: string; focused: boolean };

/**
 * A skill's position on the 0–4 scale: its level (an unassessed skill counts as level 1, as everywhere else) plus the
 * progress towards the next level, kept below the next whole level. Capped at 4.
 */
export function skillValue(skill: Pick<ProfileSkill, 'level' | 'points' | 'pointsNeeded'>): number {
  const progress = skill.pointsNeeded ? Math.min(skill.points / skill.pointsNeeded, 0.99) : 0;
  return Math.min(4, (skill.level ?? 1) + progress);
}

/** The taxonomy label of the whole level a 0–4 value sits on. */
export function levelLabelFor(value: number, labels: ReadonlyMap<number, string>): string {
  const level = Math.min(4, Math.max(0, Math.floor(value)));
  return labels.get(level) ?? `L${level}`;
}

/** One point per domain: the mean skill value; `focused` when the domain holds a focus skill. */
export function domainPoints(domains: Profile['domains'], labels: ReadonlyMap<number, string>): RadarPoint[] {
  return domains.map((d) => {
    const value = d.skills.length ? d.skills.reduce((sum, s) => sum + skillValue(s), 0) / d.skills.length : 0;
    return {
      id: d.id,
      name: d.name,
      value,
      levelLabel: levelLabelFor(value, labels),
      focused: d.skills.some((s) => s.focusRank !== null),
    };
  });
}

/** One point per focus skill, in focus-rank order. */
export function focusPoints(domains: Profile['domains'], labels: ReadonlyMap<number, string>): RadarPoint[] {
  return domains
    .flatMap((d) => d.skills)
    .filter((s) => s.focusRank !== null)
    .toSorted((a, b) => (a.focusRank ?? 0) - (b.focusRank ?? 0))
    .map((s) => {
      const value = skillValue(s);
      return { id: s.id, name: s.name, value, levelLabel: levelLabelFor(value, labels), focused: true };
    });
}
