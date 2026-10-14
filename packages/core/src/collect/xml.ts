import { XMLParser, XMLValidator } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
  isArray: (name) => ['item', 'entry', 'link', 'url', 'sitemap'].includes(name),
});

export function parseXml(xml: string): Record<string, unknown> {
  if (XMLValidator.validate(xml) !== true) throw new Error('malformed XML');
  return parser.parse(xml) as Record<string, unknown>;
}

/** Unwraps arrays (first non-empty), `{#text}` objects, strings and numbers to trimmed text. */
export function text(v: unknown): string | null {
  if (Array.isArray(v)) {
    for (const x of v) {
      const t = text(x);
      if (t) return t;
    }
    return null;
  }
  if (v && typeof v === 'object') return text((v as Record<string, unknown>)['#text']);
  if (typeof v === 'string' || typeof v === 'number') {
    const t = String(v).trim();
    return t === '' ? null : t;
  }
  return null;
}

export function parseDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v == null ? [] : [v];
}
