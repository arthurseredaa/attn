import Link from 'next/link';
import { authErrorMessage } from '@attn/shared';
import { getMe } from '@/lib/api';

export default async function Landing({ searchParams }: { searchParams: Promise<{ auth_error?: string | string[] }> }) {
  const params = await searchParams;
  const code = Array.isArray(params.auth_error) ? params.auth_error[0] : params.auth_error;
  const error = authErrorMessage(code); // fixed messages only; never echoes the query text
  const me = await getMe();

  return (
    <div className="space-y-12">
      {error ? (
        <p role="alert" className="rounded-lg border border-line bg-accent-soft px-4 py-3 text-sm">
          {error}
        </p>
      ) : null}

      <section className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">AI articles that fit your level.</h1>
        <p className="max-w-2xl text-lg text-muted">
          ATTN ranks existing AI articles by your skill priorities and skill level, not by topic alone. Curation only:
          every card links to the original article.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          {me ? (
            <Link href="/profile" className="rounded-md bg-accent px-4 py-2 font-medium text-accent-fg">
              Open ATTN
            </Link>
          ) : (
            <a href="/api/auth/github" className="rounded-md bg-accent px-4 py-2 font-medium text-accent-fg">
              Sign in with GitHub
            </a>
          )}
          <Link href="/all" className="rounded-md border border-line px-4 py-2 text-muted hover:text-fg">
            Browse all articles
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ['Pick your focus', 'Choose up to five skills that matter most right now.'],
          ['Take a short quiz', 'Situational questions place you on a level from 0 to 4 for each skill.'],
          ['Read what fits', 'Articles are ranked by skill priority and difficulty relative to your level.'],
        ].map(([title, text]) => (
          <div key={title} className="rounded-xl border border-line bg-card p-4">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-1 text-sm text-muted">{text}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
