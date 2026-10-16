/**
 * The X-Robots-Tag for every response. Closed by default: only SITE_INDEXABLE=true (exactly) lets search engines
 * index the site, so a deploy that forgets the variable stays out of the index (plans/seo.md).
 */
export function robotsTag(siteIndexable: string | undefined): string | null {
  return siteIndexable === 'true' ? null : 'noindex';
}
