import { load } from 'cheerio';

export function parsePageTitle(html: string): string | null {
  const $ = load(html);
  const og = $('meta[property="og:title"]').attr('content')?.trim();
  if (og) return og;
  const t = $('title').first().text().trim();
  return t === '' ? null : t;
}
