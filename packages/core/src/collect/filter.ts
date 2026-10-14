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

function keywordRegex(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu');
}

/** Path rules AND (if keywords given) a whole-word keyword hit in title or URL path. */
export function passesFilter(entry: { url: string; title: string }, filter: SourceFilter | undefined): boolean {
  if (!filter) return true;
  if (!passesPathFilter(entry.url, filter)) return false;
  if (!filter.keywords) return true;
  const haystack = `${entry.title}\n${pathnameOf(entry.url) ?? ''}`;
  return filter.keywords.some((k) => keywordRegex(k).test(haystack));
}
