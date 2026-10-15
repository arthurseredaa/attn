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

/**
 * The relevance gate's verdict (only the jev labeler gives one). `probability` is the model's probability that the
 * article is useful for the skill map; null = no usable answer (refused or missing), which counts as relevant.
 */
export interface RelevanceVerdict {
  probability: number | null;
}

/** A label, plus the optional relevance verdict. A labeler without a gate (Claude, Gemini, fake) omits it = relevant. */
export type LabelResult = LabelOutput & { relevance?: RelevanceVerdict };

export interface Labeler {
  readonly model: string;
  label(article: PublicArticle): Promise<LabelResult>;
  /** Optional: a labeler that sees provider token counts reports their running totals. */
  usage?(): LabelTokenUsage;
}

export function makePublicArticle(input: { title: string; url: string; text: string }): PublicArticle {
  return { title: input.title, url: input.url, text: input.text };
}
