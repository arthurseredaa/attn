import type { LabelOutput } from '@attn/shared';

export interface PublicArticle {
  readonly title: string;
  readonly url: string;
  readonly text: string;
}

/** Token totals over every successful call so far. Cache fields are present only when the provider reported them. */
export interface LabelTokenUsage {
  /** All input tokens, cached ones included. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface Labeler {
  readonly model: string;
  label(article: PublicArticle): Promise<LabelOutput>;
  /** Optional: a labeler that sees provider token counts reports their running totals. */
  usage?(): LabelTokenUsage;
}

export function makePublicArticle(input: { title: string; url: string; text: string }): PublicArticle {
  return { title: input.title, url: input.url, text: input.text };
}
