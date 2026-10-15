import type { LabelOutput } from '@attn/shared';
import type { LabelResult, Labeler, PublicArticle } from './types';

export interface FakeLabeler extends Labeler {
  readonly calls: PublicArticle[];
}

export const DEFAULT_FAKE_LABEL: LabelOutput = {
  primary_skill: 'context-engineering',
  secondary_skills: [],
  difficulty: 2,
  type: 'tutorial',
  quality: 3,
};

export function createFakeLabeler(
  respond: (article: PublicArticle, callIndex: number) => LabelResult | Promise<LabelResult> = () =>
    DEFAULT_FAKE_LABEL,
  model = 'fake-model',
): FakeLabeler {
  const calls: PublicArticle[] = [];
  return {
    model,
    calls,
    async label(article) {
      const index = calls.length;
      calls.push(article);
      return respond(article, index);
    },
  };
}
