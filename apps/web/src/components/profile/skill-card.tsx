import Link from 'next/link';
import type { ProfileSkill } from '@attn/shared';

const UNCERTAIN_HINT =
  'Your quiz answers were inconsistent, or the skill is not assessed yet. Reading feedback will calibrate it.';

export function SkillCard({ skill, levelLabel }: { skill: ProfileSkill; levelLabel: string }) {
  const focused = skill.focusRank !== null;
  const pct = skill.pointsNeeded ? Math.min(100, Math.round((skill.points / skill.pointsNeeded) * 100)) : 100;
  return (
    <li className={`space-y-2 rounded-lg border p-3 ${focused ? 'border-primary bg-primary/10' : 'border-border bg-card'}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold" title={skill.description}>
          {skill.name}
        </h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {skill.uncertain && (
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground" title={UNCERTAIN_HINT}>
              Uncertain
            </span>
          )}
          {skill.focusRank !== null && (
            <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">#{skill.focusRank}</span>
          )}
        </div>
      </div>
      {skill.level === null ? (
        <p className="text-xs text-muted-foreground">Not assessed (treated as level 1)</p>
      ) : (
        <p className="text-xs">
          L{skill.level} {levelLabel}
        </p>
      )}
      {skill.level !== null && (
        <div className="space-y-1">
          <div className="h-1 overflow-hidden rounded-full bg-border" aria-hidden>
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">{skill.pointsNeeded === null ? 'Max level' : `${skill.points}/${skill.pointsNeeded}`}</p>
        </div>
      )}
      {!skill.quizzed && (
        <Link href={`/onboarding/quiz?skills=${encodeURIComponent(skill.id)}`} className="text-xs underline">
          Take quiz
        </Link>
      )}
    </li>
  );
}
