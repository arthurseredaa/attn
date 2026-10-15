import { CircleAlert } from 'lucide-react';
import type { FeedPage } from '@attn/shared';
import { ApiError, getFeed, getTaxonomy } from '@/lib/api';
import { requireProfile, signedIn } from '@/lib/guards';
import { hasActiveFilters, pickFilters, type RawSearchParams } from '@/lib/filters';
import { FeedList } from '@/components/feed-list';
import { FilterBar } from '@/components/filter-bar';
import { Alert, AlertDescription } from '@/components/ui/alert';

export const metadata = { title: 'For you | ATTN' };
export const dynamic = 'force-dynamic';

export default async function ForYouPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { skill, q } = pickFilters(await searchParams);
  await requireProfile();
  let page: FeedPage | null = null;
  let problem: string | null = null;
  const taxonomyP = getTaxonomy();
  taxonomyP.catch(() => undefined); // awaited below; avoids an unhandled rejection if the feed throws first
  try {
    page = await signedIn(getFeed(0, { skill, q }));
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) problem = e.message; // hand-edited URL: show it, do not crash
    else throw e;
  }

  const taxonomy = await taxonomyP;
  const difficultyLabels = taxonomy.levels.toSorted((a, b) => a.level - b.level).map((l) => l.label);

  return (
    <div>
      {/* Title left, filters right on one row (they wrap under it on narrow screens). */}
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3.5 sm:mb-6 sm:gap-6">
        <h1 className="text-2xl leading-tight font-semibold tracking-[-0.025em] sm:text-[28px]">For you</h1>
        <FilterBar taxonomy={taxonomy} values={{ skill, q }} />
      </header>
      {problem ? (
        <Alert variant="destructive" className="mb-6">
          <CircleAlert aria-hidden />
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      ) : null}
      {page ? (
        // A new key per filter set: a fresh list (paging, served/excluded counts) for every change.
        <FeedList
          key={JSON.stringify([skill, q])}
          initial={page}
          filters={{ skill, q }}
          filtered={hasActiveFilters({ skill, q })}
          difficultyLabels={difficultyLabels}
        />
      ) : null}
    </div>
  );
}
