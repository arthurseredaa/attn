import Link from 'next/link';
import { skillNameMap } from '@attn/shared';
import { getTaxonomy } from '@/lib/api';
import { requireProfile } from '@/lib/guards';
import { FocusEditor } from '@/components/profile/focus-editor';
import { SkillCard } from '@/components/profile/skill-card';

export const metadata = { title: 'Profile | ATTN' };

const QUIZ_LINK_CAP = 12;
const quizHref = (ids: string[]) => `/onboarding/quiz?skills=${ids.map(encodeURIComponent).join(',')}`;

/** Names the count the link really covers (at most QUIZ_LINK_CAP skills). */
function quizAllLabel(left: number): string {
  if (left > QUIZ_LINK_CAP) return `Take the quiz for ${QUIZ_LINK_CAP} of ${left} skills`;
  return `Take the quiz for ${left} ${left === 1 ? 'skill' : 'skills'}`;
}

export default async function ProfilePage() {
  const profile = await requireProfile();
  const taxonomy = await getTaxonomy();
  const labels = new Map(taxonomy.levels.map((l) => [l.level, l.label]));

  const allSkills = profile.domains.flatMap((d) => d.skills.map((s) => ({ id: s.id, name: s.name, domain: d.name })));
  const unquizzed = profile.domains.flatMap((d) => d.skills).filter((s) => !s.quizzed);
  const { history, likes } = profile;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">Your profile</h1>
        <Link href="/onboarding" className="rounded-md border border-border px-3 py-1 text-sm hover:bg-primary/10">
          Redo onboarding
        </Link>
      </header>

      <FocusEditor
        key={profile.focus.map((f) => f.skillId).join(',')}
        focus={profile.focus}
        skills={allSkills}
        names={skillNameMap(profile)}
      />

      {unquizzed.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-3 text-sm">
          <Link href={quizHref(unquizzed.slice(0, QUIZ_LINK_CAP).map((s) => s.id))} className="font-medium underline">
            {quizAllLabel(unquizzed.length)}
          </Link>
        </div>
      )}

      {profile.domains.map((d) => {
        const open = d.skills.filter((s) => !s.quizzed).map((s) => s.id);
        return (
          <section key={d.id} className="space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">{d.name}</h2>
              {open.length > 0 && (
                <Link href={quizHref(open.slice(0, QUIZ_LINK_CAP))} className="text-sm underline">
                  Take quiz for this domain
                </Link>
              )}
            </div>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {d.skills.map((s) => (
                <SkillCard key={s.id} skill={s} levelLabel={s.level === null ? '' : (labels.get(s.level) ?? '')} />
              ))}
            </ul>
          </section>
        );
      })}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Reading history</h2>
        {history.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing read yet. Articles you open from For you will appear here.</p>
        ) : (
          <ul className="space-y-2">
            {history.items.map((h) => (
              <li key={`${h.articleId}-${h.readAt}`} className="text-sm">
                <a href={h.url} target="_blank" rel="noopener noreferrer" className="font-medium underline">
                  {h.title}
                </a>
                <span className="text-muted-foreground">
                  {' '}
                  · {h.sourceName} · {h.readAt.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-1">
        <h2 className="text-lg font-semibold">👍 share</h2>
        {likes.share === null ? (
          <p className="text-sm text-muted-foreground">No reads yet</p>
        ) : (
          <p className="text-sm">
            {Math.round(likes.share * 100)}% ({likes.liked} of {likes.read} read)
          </p>
        )}
      </section>
    </div>
  );
}
