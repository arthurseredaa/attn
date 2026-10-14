// Spec names generateObject; in ai 7 it is deprecated, generateText + Output.object is the same structured-output call.
import { APICallError, Output, RetryError, generateText, type LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { buildLabelOutputSchema, normalizeLabel, taxonomySkillIds, type Taxonomy } from '@attn/shared';
import { RateLimitError } from './errors';
import { buildSystemPrompt, buildUserPrompt } from './prompt';
import type { Labeler, PublicArticle } from './types';

export interface GeminiLabelerOptions {
  model: string;
  taxonomy: Taxonomy;
  apiKey?: string;
  languageModel?: LanguageModel;
  maxRetries?: number;
}

function is429(e: unknown): boolean {
  return APICallError.isInstance(e) && e.statusCode === 429;
}

export function isRateLimitError(err: unknown): boolean {
  if (is429(err)) return true;
  return RetryError.isInstance(err) && is429(err.lastError);
}

export function createGeminiLabeler(opts: GeminiLabelerOptions): Labeler {
  const model = opts.languageModel ?? createGoogleGenerativeAI({ apiKey: opts.apiKey })(opts.model);
  const schema = buildLabelOutputSchema(taxonomySkillIds(opts.taxonomy));
  const system = buildSystemPrompt(opts.taxonomy);
  const maxRetries = opts.maxRetries ?? 1;
  return {
    model: opts.model,
    async label(article: PublicArticle) {
      try {
        const result = await generateText({
          model,
          output: Output.object({ schema }),
          system,
          prompt: buildUserPrompt(article),
          temperature: 0,
          maxRetries,
        });
        return normalizeLabel(result.output);
      } catch (e) {
        if (isRateLimitError(e)) throw new RateLimitError('provider rate limit (429)', { cause: e });
        throw e;
      }
    },
  };
}
