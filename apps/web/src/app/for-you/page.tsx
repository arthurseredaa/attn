import type { FeedPage } from '@attn/shared';
import { ApiError, getFeed, getTaxonomy } from '@/lib/api';
import { requireProfile, signedIn } from '@/lib/guards';
import { hasActiveFilters, pickFilters, type RawSearchParams } from '@/lib/filters';
import { FeedList } from '@/components/feed-list';
import { FilterBar } from '@/components/filter-bar';

export const metadata = { title: 'For you | ATTN' };
export const dynamic = 'force-dynamic';

export default async function ForYouPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const { skill, q } = pickFilters(await searchParams);
  await requireProfile();
  const taxonomy = await getTaxonomy();

  let page: FeedPage | null = null;
  let problem: string | null = null;
  try {
    page = await signedIn(getFeed(0, { skill, q }));
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) problem = e.message; // hand-edited URL: show it, do not crash
    else throw e;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">For you</h1>
      <FilterBar taxonomy={taxonomy} values={{ skill, q }} />
      {problem ? (
        <p role="alert" className="rounded-lg border border-line bg-accent-soft px-4 py-3 text-sm">
          {problem}
        </p>
      ) : null}
      {page ? (
        // A new key per filter set: a fresh list (paging, served/excluded counts) for every change.
        <FeedList key={JSON.stringify([skill, q])} initial={page} filters={{ skill, q }} filtered={hasActiveFilters({ skill, q })} />
      ) : null}
    </div>
  );
}
