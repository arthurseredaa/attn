import Link from 'next/link';
import { CircleAlert } from 'lucide-react';
import { authErrorMessage } from '@attn/shared';
import { LandingStory } from '@/components/landing/landing-story';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { getArticles, getMe, getSources, getTaxonomy } from '@/lib/api';
import { toSceneData } from '@/lib/landing-scene';

/** The newest articles the story is drawn from. */
const STORY_POOL = 40;

export default async function Landing({ searchParams }: { searchParams: Promise<{ auth_error?: string | string[] }> }) {
  const params = await searchParams;
  const code = Array.isArray(params.auth_error) ? params.auth_error[0] : params.auth_error;
  const error = authErrorMessage(code); // fixed messages only; never echoes the query text
  // The story draws real data; if any of it fails, the acts render as text and the page still works.
  const [me, articles, sources, taxonomy] = await Promise.all([
    getMe(),
    getArticles({ limit: STORY_POOL }).catch(() => null),
    getSources().catch(() => null),
    getTaxonomy().catch(() => null),
  ]);
  const data = articles && taxonomy ? toSceneData(articles.items, taxonomy) : null;

  return (
    <>
      {error ? (
        <div className="mx-auto max-w-[1440px] px-4 pt-5 md:px-10">
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : null}

      <LandingStory data={data} sourceCount={sources?.length ?? null} />

      <section aria-labelledby="landing-cta" className="bg-signal text-signal-foreground">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-8 px-4 py-16 sm:py-24 md:px-10 lg:flex-row lg:items-end lg:justify-between">
          <h2
            id="landing-cta"
            className="text-[34px] leading-[1.05] font-semibold tracking-[-0.035em] sm:text-[44px] lg:text-[52px] xl:text-[60px]"
          >
            Find your way through it.
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              asChild
              size="lg"
              className="bg-signal-foreground px-4 text-signal hover:brightness-100 hover:bg-signal-foreground/90 focus-visible:outline-signal-foreground"
            >
              {me ? (
                <Link href="/for-you">Open For you</Link>
              ) : (
                // Plain anchor: this is an api redirect, not a Next route.
                <a href="/api/auth/github">Sign in with GitHub</a>
              )}
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="border-signal-foreground/60 bg-transparent px-4 text-signal-foreground hover:border-signal-foreground hover:bg-signal-foreground/10 focus-visible:outline-signal-foreground"
            >
              <Link href="/all">Browse all articles →</Link>
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
