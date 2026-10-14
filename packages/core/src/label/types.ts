import type { LabelOutput } from '@attn/shared';

export interface PublicArticle {
  readonly title: string;
  readonly url: string;
  readonly text: string;
}

export interface Labeler {
  readonly model: string;
  label(article: PublicArticle): Promise<LabelOutput>;
}

export function makePublicArticle(input: { title: string; url: string; text: string }): PublicArticle {
  return { title: input.title, url: input.url, text: input.text };
}
