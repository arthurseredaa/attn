import Link from 'next/link';
import type { ProfileSkill } from '@attn/shared';
import { LevelMeter } from '@/components/level-meter';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const UNCERTAIN_HINT =
  'Your quiz answers were inconsistent, or the skill is not assessed yet. Reading feedback will calibrate it.';

/** A small text link inside quiet rows. */
export const QUIET_LINK =
  'rounded-sm text-muted-foreground underline decoration-faint underline-offset-3 outline-none hover:text-foreground hover:decoration-current focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring';

/** The ul for skill rows: the container the row grid queries, with the top hairline. */
export const SKILL_ROWS = '@container border-t border-border';

/**
 * The row grid, sized by the list's container, mobile first:
 * - narrow: the name and the level on the first line, points · uncertain · quiz under them;
 * - from 640px: one 42px line, name · level · points · uncertain · quiz in fixed right-hand columns.
 */
export const SKILL_ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-b border-border py-2.5 @min-[640px]:h-[42px] @min-[640px]:grid-cols-[minmax(0,1fr)_200px_56px_76px_68px] @min-[640px]:px-2 @min-[640px]:py-0';

export function SkillRow({ skill, levelLabel }: { skill: ProfileSkill; levelLabel: string }) {
  const showPoints = skill.level !== null || skill.points > 0;
  // Unassessed skills are always uncertain; "Not assessed" already says so.
  const showUncertain = skill.uncertain && skill.level !== null;
  return (
    <li className={SKILL_ROW_GRID}>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="truncate text-sm" title={skill.description}>
          {skill.name}
        </span>
        {skill.focusRank !== null ? (
          <span className="font-mono text-[13px] text-primary">
            <span className="sr-only">focus rank </span>#{skill.focusRank}
          </span>
        ) : null}
      </div>
      {skill.level === null ? (
        <span className="text-[13px] text-muted-foreground">Not assessed</span>
      ) : (
        <span className="inline-flex items-center gap-2">
          <LevelMeter level={skill.level} />
          <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">{levelLabel}</span>
        </span>
      )}
      {/* Narrow: the second line. Wider: its children become grid cells (contents) in the fixed columns. */}
      <div className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] @min-[640px]:contents">
        {showPoints ? (
          <span className="font-mono whitespace-nowrap text-muted-foreground @min-[640px]:text-right">
            {skill.pointsNeeded === null ? 'Max' : `${skill.points}/${skill.pointsNeeded}`}
            <span className="sr-only"> points</span>
          </span>
        ) : (
          <span className="hidden @min-[640px]:block" />
        )}
        {showUncertain ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="justify-self-start rounded-sm whitespace-nowrap text-warning outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Uncertain
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{UNCERTAIN_HINT}</TooltipContent>
          </Tooltip>
        ) : (
          <span className="hidden @min-[640px]:block" />
        )}
        {!skill.quizzed ? (
          <Link
            href={`/onboarding/quiz?skills=${encodeURIComponent(skill.id)}`}
            className={`${QUIET_LINK} justify-self-end whitespace-nowrap`}
          >
            Take quiz<span className="sr-only"> for {skill.name}</span>
          </Link>
        ) : (
          <span className="hidden @min-[640px]:block" />
        )}
      </div>
    </li>
  );
}
