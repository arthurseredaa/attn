import { createHash } from 'node:crypto';

const TRACKING_PARAM = /^(utm_|ref$|fbclid$)/i;

/** Canonical form of a URL for dedup, or null if unparsable / not http(s). */
export function normalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const kept = [...url.searchParams.entries()].filter(([key]) => !TRACKING_PARAM.test(key));
  url.search = '';
  for (const [key, value] of kept) url.searchParams.append(key, value);
  url.hash = '';

  const pathname = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${pathname}${url.search}`;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function fromCodePoint(code: number, original: string): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return original;
  }
}

/** Decodes the common XML/HTML entities; unknown entities are left untouched. */
export function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, dec, hex, name) => {
    if (dec !== undefined) return fromCodePoint(Number.parseInt(dec, 10), match);
    if (hex !== undefined) return fromCodePoint(Number.parseInt(hex, 16), match);
    return NAMED_ENTITIES[(name as string).toLowerCase()] ?? match;
  });
}

export function titleHash(title: string): string {
  const canonical = decodeEntities(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  return createHash('sha256').update(canonical).digest('hex');
}

/** UTC calendar day as YYYY-MM-DD. */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Half-open [start, end) bounds of the UTC day containing d. */
export function utcDayBounds(d: Date): { start: Date; end: Date } {
  const start = new Date(`${utcDay(d)}T00:00:00.000Z`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
