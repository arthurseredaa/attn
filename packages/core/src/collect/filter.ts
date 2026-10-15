import type { SourceFilter } from '@attn/shared';

function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/** Path rules only (path_prefix / exclude_path_prefix). Usable before a title is known. */
export function passesPathFilter(url: string, filter: SourceFilter | undefined): boolean {
  if (!filter) return true;
  const pathname = pathnameOf(url);
  if (pathname === null) return false;
  if (filter.path_prefix && !filter.path_prefix.some((p) => pathname.startsWith(p))) return false;
  if (filter.exclude_path_prefix?.some((p) => pathname.startsWith(p))) return false;
  return true;
}

const trimSlash = (p: string): string => (p.length > 1 ? p.replace(/\/+$/, '') || '/' : p);

/** The name of an exclusion rule (a filter key) that blocks `entry`, or null. */
export type ExclusionRule = 'exclude_path_prefix' | 'exclude_paths' | 'exclude_path_regex' | 'exclude_title_regex';

/**
 * The first exclusion rule that blocks this entry, or null. Path rules only count for URLs inside `path_prefix`
 * (outside it the entry is simply not of interest and is skipped, not "filtered"). Title rules run only when a
 * title is known (`title` null = not fetched yet), so a sitemap page is not fetched for a URL a path rule already blocks.
 * Regexes are validated at config load (`sourcesSchema`); an invalid one here would throw.
 */
export function exclusionRule(
  entry: { url: string; title: string | null },
  filter: SourceFilter | undefined,
): ExclusionRule | null {
  if (!filter) return null;
  const pathname = pathnameOf(entry.url);
  if (pathname === null) return null;
  if (filter.path_prefix && !filter.path_prefix.some((p) => pathname.startsWith(p))) return null;
  if (filter.exclude_path_prefix?.some((p) => pathname.startsWith(p))) return 'exclude_path_prefix';
  const path = trimSlash(pathname);
  if (filter.exclude_paths?.some((p) => trimSlash(p) === path)) return 'exclude_paths';
  if (filter.exclude_path_regex?.some((r) => new RegExp(r).test(pathname))) return 'exclude_path_regex';
  if (entry.title !== null && filter.exclude_title_regex?.some((r) => new RegExp(r, 'i').test(entry.title as string))) {
    return 'exclude_title_regex';
  }
  return null;
}

function keywordRegex(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}

/** Path rules AND (if keywords given) a whole-word keyword hit in title or URL path. */
export function passesFilter(entry: { url: string; title: string }, filter: SourceFilter | undefined): boolean {
  if (!filter) return true;
  if (!passesPathFilter(entry.url, filter)) return false;
  if (exclusionRule(entry, filter) !== null) return false;
  if (!filter.keywords) return true;
  const haystack = `${entry.title}\n${pathnameOf(entry.url) ?? ''}`;
  return filter.keywords.some((k) => keywordRegex(k).test(haystack));
}
