import Link from 'next/link';
import type { ArticlesPage } from '@attn/shared';
import { ArticleCardView } from '@/components/article-card';
import { FilterBar } from '@/components/filter-bar';
import { ApiError, getArticles, getSources, getTaxonomy } from '@/lib/api';
import { filterParams, hasActiveFilters, pickFilters, type RawSearchParams } from '@/lib/filters';
import { buildQueryString } from '@/lib/query';

export const metadata = { title: 'All articles | ATTN' };

export default async function AllPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const filters = pickFilters(await searchParams);
  const { cursor, ...rest } = filters;
  const [sources, taxonomy] = await Promise.all([getSources(), getTaxonomy()]);

  let page: ArticlesPage | null = null;
  let problem: string | null = null;
  try {
    page = await getArticles(filters);
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) problem = e.message; // hand-edited URL: show it, do not crash
    else throw e;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">All articles</h1>
      <FilterBar taxonomy={taxonomy} sources={sources} values={rest} />
      {problem ? (
        <p role="alert" className="rounded-lg border border-border bg-primary/10 px-4 py-3 text-sm">
          {problem}
        </p>
      ) : null}
      {page && page.items.length === 0 ? (
        <p className="text-muted-foreground">
          {hasActiveFilters(rest) ? 'No articles match these filters. Try removing a skill or changing the search.' : 'No articles yet.'}
        </p>
      ) : null}
      <div className="space-y-3">{page?.items.map((a) => <ArticleCardView key={a.id} article={a} />)}</div>
      <div className="flex gap-4 text-sm">
        {cursor ? (
          <Link href={`/all${buildQueryString(filterParams(rest))}`} className="text-muted-foreground hover:text-foreground">
            Back to newest
          </Link>
        ) : null}
        {page?.nextCursor ? (
          <Link
            href={`/all${buildQueryString({ ...filterParams(rest), cursor: page.nextCursor })}`}
            className="font-medium text-primary"
          >
            Older articles
          </Link>
        ) : null}
      </div>
    </div>
  );
}
