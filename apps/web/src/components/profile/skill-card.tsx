import Link from 'next/link';
import type { ProfileSkill } from '@attn/shared';

const UNCERTAIN_HINT =
  'Your quiz answers were inconsistent, or the skill is not assessed yet. Reading feedback will calibrate it.';

export function SkillCard({ skill, levelLabel }: { skill: ProfileSkill; levelLabel: string }) {
  const focused = skill.focusRank !== null;
  const pct = skill.pointsNeeded ? Math.min(100, Math.round((skill.points / skill.pointsNeeded) * 100)) : 100;
  return (
    <li className={`space-y-2 rounded-lg border p-3 ${focused ? 'border-accent bg-accent-soft' : 'border-line bg-card'}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold" title={skill.description}>
          {skill.name}
        </h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {skill.uncertain && (
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted" title={UNCERTAIN_HINT}>
              Uncertain
            </span>
          )}
          {skill.focusRank !== null && (
            <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-accent-fg">#{skill.focusRank}</span>
          )}
        </div>
      </div>
      {skill.level === null ? (
        <p className="text-xs text-muted">Not assessed (treated as level 1)</p>
      ) : (
        <p className="text-xs">
          L{skill.level} {levelLabel}
        </p>
      )}
      {skill.level !== null && (
        <div className="space-y-1">
          <div className="h-1 overflow-hidden rounded-full bg-line" aria-hidden>
            <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted">{skill.pointsNeeded === null ? 'Max level' : `${skill.points}/${skill.pointsNeeded}`}</p>
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
