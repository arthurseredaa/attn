import type { SitemapUrl } from './types';
import { asArray, asObject, parseDate, parseXml, text } from './xml';

export function isSitemapIndex(xml: string): boolean {
  return parseXml(xml).sitemapindex !== undefined;
}

export function parseSitemapIndex(xml: string): string[] {
  const idx = asObject(parseXml(xml).sitemapindex);
  return asArray(idx?.sitemap)
    .map((s) => text(asObject(s)?.loc))
    .filter((l): l is string => l !== null);
}

export function parseSitemap(xml: string, pathPrefix: string): SitemapUrl[] {
  const doc = parseXml(xml);
  if (doc.sitemapindex !== undefined) throw new Error('sitemap index: follow child sitemaps');
  const urlset = asObject(doc.urlset);
  const out: SitemapUrl[] = [];
  for (const u of asArray(urlset?.url)) {
    const o = asObject(u);
    const loc = text(o?.loc);
    if (!o || !loc) continue;
    let pathname: string;
    try {
      pathname = new URL(loc).pathname;
    } catch {
      continue;
    }
    if (!pathname.startsWith(pathPrefix) || pathname === pathPrefix) continue;
    out.push({ url: loc, lastmod: parseDate(text(o.lastmod)) });
  }
  return out;
}
