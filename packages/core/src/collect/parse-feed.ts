import { decodeEntities } from './normalize';
import type { RawEntry } from './types';
import { asArray, asObject, parseDate, parseXml, text } from './xml';

function cleanTitle(raw: string | null, stripTags: boolean): string | null {
  if (raw === null) return null;
  let t = decodeEntities(raw);
  if (stripTags) t = t.replace(/<[^>]*>/g, '');
  t = t.trim();
  return t === '' ? null : t;
}

function rssEntry(item: Record<string, unknown>): RawEntry | null {
  const url = text(item.link);
  if (!url) return null;
  return {
    url,
    guid: text(item.guid),
    title: cleanTitle(text(item.title), false),
    publishedAt: parseDate(text(item.pubDate) ?? text(item['dc:date'])),
  };
}

function atomLink(links: unknown): string | null {
  for (const l of asArray(links)) {
    const o = asObject(l);
    if (!o) continue;
    const rel = o['@_rel'];
    if (rel === undefined || rel === 'alternate') {
      const href = text(o['@_href']);
      if (href) return href;
    }
  }
  return null;
}

function atomEntry(entry: Record<string, unknown>): RawEntry | null {
  const url = atomLink(entry.link);
  if (!url) return null;
  const titleObj = asObject(entry.title);
  const isHtml = titleObj?.['@_type'] === 'html';
  return {
    url,
    guid: text(entry.id),
    title: cleanTitle(text(entry.title), isHtml),
    publishedAt: parseDate(text(entry.published) ?? text(entry.updated)),
  };
}

export function parseFeed(xml: string): RawEntry[] {
  const doc = parseXml(xml);
  const rss = asObject(doc.rss);
  if (rss) {
    const channel = asObject(rss.channel);
    return asArray(channel?.item)
      .map((i) => (asObject(i) ? rssEntry(i as Record<string, unknown>) : null))
      .filter((e): e is RawEntry => e !== null);
  }
  const feed = asObject(doc.feed);
  if (feed) {
    return asArray(feed.entry)
      .map((e) => (asObject(e) ? atomEntry(e as Record<string, unknown>) : null))
      .filter((e): e is RawEntry => e !== null);
  }
  throw new Error('unrecognized feed format');
}
