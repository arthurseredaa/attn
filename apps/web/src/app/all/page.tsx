import Link from 'next/link';
import type { ArticlesPage } from '@attn/shared';
import { ArticleCardView } from '@/components/article-card';
import { FiltersForm } from '@/components/filters-form';
import { ApiError, getArticles, getSources, getTaxonomy } from '@/lib/api';
import { pickFilters, type RawSearchParams } from '@/lib/filters';
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
      <FiltersForm sources={sources} taxonomy={taxonomy} values={rest} />
      {problem ? (
        <p role="alert" className="rounded-lg border border-line bg-accent-soft px-4 py-3 text-sm">
          {problem}
        </p>
      ) : null}
      {page && page.items.length === 0 ? <p className="text-muted">No articles match these filters.</p> : null}
      <div className="space-y-3">{page?.items.map((a) => <ArticleCardView key={a.id} article={a} />)}</div>
      <div className="flex gap-4 text-sm">
        {cursor ? (
          <Link href={`/all${buildQueryString(rest)}`} className="text-muted hover:text-fg">
            Back to newest
          </Link>
        ) : null}
        {page?.nextCursor ? (
          <Link href={`/all${buildQueryString({ ...rest, cursor: page.nextCursor })}`} className="font-medium text-accent">
            Older articles
          </Link>
        ) : null}
      </div>
    </div>
  );
}
