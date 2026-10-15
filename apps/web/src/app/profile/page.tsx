import Link from 'next/link';
import { skillNameMap } from '@attn/shared';
import { shortDate } from '@/components/article-meta';
import { FocusEditor } from '@/components/profile/focus-editor';
import { ProfileRadar } from '@/components/profile/profile-radar';
import { QUIET_LINK, SKILL_ROWS, SkillRow } from '@/components/profile/skill-row';
import { Button } from '@/components/ui/button';
import { getTaxonomy } from '@/lib/api';
import { requireProfile } from '@/lib/guards';
import { domainPoints, focusPoints } from '@/lib/skill-value';

export const metadata = { title: 'Profile | ATTN' };

const QUIZ_LINK_CAP = 12;
const quizHref = (ids: string[]) => `/onboarding/quiz?skills=${ids.map(encodeURIComponent).join(',')}`;

/** Names the count the link really covers (at most QUIZ_LINK_CAP skills). */
function quizAllLabel(left: number): string {
  if (left > QUIZ_LINK_CAP) return `Take the quiz for ${QUIZ_LINK_CAP} of ${left} skills`;
  return `Take the quiz for ${left} ${left === 1 ? 'skill' : 'skills'}`;
}

/** The focus radar needs at least three axes to be a shape. */
const MIN_FOCUS_RADAR = 3;

/** History rows: title, then source and read date in fixed right-hand columns from 600px; two lines below it. */
const HISTORY_ROW =
  'grid grid-cols-1 gap-y-0.5 border-b border-border py-2.5 @min-[600px]:h-[42px] @min-[600px]:grid-cols-[minmax(0,1fr)_200px_52px] @min-[600px]:items-center @min-[600px]:gap-x-4 @min-[600px]:px-2 @min-[600px]:py-0';

export default async function ProfilePage() {
  const profile = await requireProfile();
  const taxonomy = await getTaxonomy();
  const labels = new Map(taxonomy.levels.map((l) => [l.level, l.label]));

  const allSkills = profile.domains.flatMap((d) => d.skills.map((s) => ({ id: s.id, name: s.name, domain: d.name })));
  const unquizzed = profile.domains.flatMap((d) => d.skills).filter((s) => !s.quizzed);
  const { history, likes } = profile;
  const domains = domainPoints(profile.domains, labels);
  const focus = focusPoints(profile.domains, labels);
  const showFocusRadar = focus.length >= MIN_FOCUS_RADAR;

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl leading-tight font-semibold tracking-[-0.025em] sm:text-[28px]">Profile</h1>
        <div className="flex flex-wrap gap-2">
          {unquizzed.length > 0 ? (
            <Button asChild variant="outline" className="px-3.5">
              <Link href={quizHref(unquizzed.slice(0, QUIZ_LINK_CAP).map((s) => s.id))}>
                {quizAllLabel(unquizzed.length)}
              </Link>
            </Button>
          ) : null}
          <Button asChild variant="outline" className="px-3.5">
            <Link href="/onboarding">Redo onboarding</Link>
          </Button>
        </div>
      </header>

      <FocusEditor
        key={profile.focus.map((f) => f.skillId).join(',')}
        focus={profile.focus}
        skills={allSkills}
        names={skillNameMap(profile)}
        domainsChart={
          <section aria-labelledby="radar-domains" className="space-y-1 border border-signal bg-signal p-5 text-signal-foreground">
            <h2 id="radar-domains" className="text-sm font-semibold">
              Domains
            </h2>
            <ProfileRadar points={domains} variant="domains" caption="Domains" className="mx-auto" />
          </section>
        }
        focusChart={
          showFocusRadar ? (
            <section aria-labelledby="radar-focus" className="space-y-1 border border-border bg-card p-5 @max-[699px]:border-t-0 @min-[700px]:border-l-0">
              <h2 id="radar-focus" className="text-sm font-semibold">
                Focus
              </h2>
              <ProfileRadar points={focus} variant="focus" caption="Focus" className="mx-auto" />
            </section>
          ) : null
        }
      />

      {profile.domains.map((d) => {
        const open = d.skills.filter((s) => !s.quizzed).map((s) => s.id);
        return (
          <section key={d.id} id={`domain-${d.id}`} aria-labelledby={`domain-${d.id}-heading`} className="scroll-mt-20 md:scroll-mt-6">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id={`domain-${d.id}-heading`} className="text-lg font-semibold tracking-[-0.01em]">
                {d.name}
              </h2>
              {open.length > 0 ? (
                <Link href={quizHref(open.slice(0, QUIZ_LINK_CAP))} className={`${QUIET_LINK} text-[13px]`}>
                  Take quiz for this domain
                </Link>
              ) : null}
            </div>
            <ul role="list" className={SKILL_ROWS}>
              {d.skills.map((s) => (
                <SkillRow key={s.id} skill={s} levelLabel={s.level === null ? '' : (labels.get(s.level) ?? '')} />
              ))}
            </ul>
          </section>
        );
      })}

      <section aria-labelledby="history-heading">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="history-heading" className="text-lg font-semibold tracking-[-0.01em]">
            Reading history
          </h2>
          {likes.share !== null ? (
            <p className="text-[13px] text-muted-foreground">
              Liked <span className="font-mono">{Math.round(likes.share * 100)}%</span>
              <span aria-hidden className="mx-1.5 text-faint">
                ·
              </span>
              <span className="font-mono">{likes.liked}</span> of <span className="font-mono">{likes.read}</span>
            </p>
          ) : null}
        </div>
        {history.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing read yet</p>
        ) : (
          <ul role="list" className="@container border-t border-border">
            {history.items.map((h) => (
              <li key={`${h.articleId}-${h.readAt}`} className={HISTORY_ROW}>
                <a
                  href={h.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="line-clamp-2 rounded-sm text-sm leading-snug decoration-2 underline-offset-3 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring @min-[600px]:block @min-[600px]:truncate"
                >
                  {h.title}
                </a>
                <p className="flex min-w-0 items-baseline gap-x-2 text-[13px] text-muted-foreground @min-[600px]:contents">
                  <span className="min-w-0 truncate">{h.sourceName}</span>
                  <span aria-hidden className="text-faint @min-[600px]:hidden">
                    ·
                  </span>
                  <time dateTime={h.readAt} className="font-mono whitespace-nowrap @min-[600px]:text-right">
                    {shortDate(h.readAt)}
                  </time>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
