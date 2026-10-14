import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { USER_AGENT, type FetchFn } from '../collect/http';

export type ExtractErrorKind = 'http' | 'not_html' | 'unreadable' | 'too_short';

export class ExtractError extends Error {
  readonly kind: ExtractErrorKind;
  constructor(kind: ExtractErrorKind, message: string) {
    super(message);
    this.name = 'ExtractError';
    this.kind = kind;
  }
}

export interface ExtractedArticle {
  title: string;
  text: string;
  wordCount: number;
}

const DEFAULT_TIMEOUT_MS = 20000;
const ACCEPT = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1';

const normalizeSpace = (s: string): string => s.replace(/\s+/g, ' ').trim();

export function countWords(text: string): number {
  const t = text.trim();
  return t === '' ? 0 : t.split(/\s+/).length;
}

export function truncateText(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export function limitText(text: string, opts: { minChars: number; maxChars: number }): string {
  if (text.length < opts.minChars) {
    throw new ExtractError('too_short', `text too short: ${text.length} < ${opts.minChars} chars`);
  }
  return truncateText(text, opts.maxChars);
}

export function extractFromHtml(html: string, url: string): ExtractedArticle {
  const dom = new JSDOM(html, { url });
  try {
    const doc = dom.window.document;
    // Readability mutates the document, so grab the fallback text first.
    const bodyText = normalizeSpace(doc.body?.textContent ?? '');
    const docTitle = doc.title.trim();
    const article = new Readability(doc).parse();
    let text = normalizeSpace(article?.textContent ?? '');
    let title = article?.title?.trim() || '';
    if (text === '') {
      text = bodyText;
      title = docTitle;
    }
    if (text === '') throw new ExtractError('unreadable', `no readable text at ${url}`);
    return { title: title || url, text, wordCount: countWords(text) };
  } finally {
    dom.window.close();
  }
}

export async function fetchArticleText(
  url: string,
  opts: { fetchFn?: FetchFn; timeoutMs?: number } = {},
): Promise<ExtractedArticle> {
  const fetchFn = opts.fetchFn ?? fetch;
  const res = await fetchFn(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: ACCEPT },
    redirect: 'follow',
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new ExtractError('http', `HTTP ${res.status} for ${url}`);
  const contentType = res.headers.get('content-type');
  if (contentType && !contentType.toLowerCase().includes('html')) {
    throw new ExtractError('not_html', `not HTML (${contentType}) for ${url}`);
  }
  return extractFromHtml(await res.text(), res.url || url);
}
