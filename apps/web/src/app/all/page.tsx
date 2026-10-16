import Link from 'next/link';
import { CircleAlert } from 'lucide-react';
import type { ArticlesPage } from '@attn/shared';
import { ArticleRow, ROWS_LIST } from '@/components/article-card';
import { EmptyState } from '@/components/empty-state';
import { FilterBar } from '@/components/filter-bar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ApiError, getArticles, getSources, getTaxonomy } from '@/lib/api';
import { filterParams, hasActiveFilters, pickFilters, type RawSearchParams } from '@/lib/filters';
import { buildQueryString } from '@/lib/query';

export const metadata = { title: 'All articles | ATTN' };

export default async function AllPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const filters = pickFilters(await searchParams);
  const { cursor, ...rest } = filters;
  const [sources, taxonomy] = await Promise.all([getSources(), getTaxonomy()]);
  const difficultyLabels = taxonomy.levels.toSorted((a, b) => a.level - b.level).map((l) => l.label);

  let page: ArticlesPage | null = null;
  let problem: string | null = null;
  try {
    page = await getArticles(filters);
  } catch (e) {
    if (e instanceof ApiError && e.status === 400) problem = e.message; // hand-edited URL: show it, do not crash
    else throw e;
  }

  return (
    <div>
      <h1 className="mb-4 text-2xl leading-tight font-semibold tracking-[-0.025em] sm:mb-5 sm:text-[28px]">All</h1>
      <FilterBar taxonomy={taxonomy} sources={sources} values={rest} />
      {problem ? (
        <Alert variant="destructive" className="mt-6">
          <CircleAlert aria-hidden />
          <AlertDescription>{problem}</AlertDescription>
        </Alert>
      ) : null}
      {page && page.items.length === 0 ? (
        <EmptyState title={hasActiveFilters(rest) ? 'No matching articles' : 'No articles yet'} />
      ) : null}
      {page && page.items.length > 0 ? (
        <ul role="list" className={`mt-3 ${ROWS_LIST}`}>
          {page.items.map((a) => (
            <ArticleRow key={a.id} article={a} difficultyLabel={difficultyLabels[a.difficulty] ?? `L${a.difficulty}`} />
          ))}
        </ul>
      ) : null}
      {cursor || page?.nextCursor ? (
        <nav aria-label="Pages" className="mt-5 flex justify-end gap-2">
          {cursor ? (
            <Button asChild variant="outline" className="px-3.5">
              <Link href={`/all${buildQueryString(filterParams(rest))}`}>Back to newest</Link>
            </Button>
          ) : null}
          {page?.nextCursor ? (
            <Button asChild variant="outline" className="px-3.5">
              <Link href={`/all${buildQueryString({ ...filterParams(rest), cursor: page.nextCursor })}`}>Older</Link>
            </Button>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
