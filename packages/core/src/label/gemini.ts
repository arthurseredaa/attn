// Spec names generateObject; in ai 7 it is deprecated, generateText + Output.object is the same structured-output call.
import { APICallError, LoadAPIKeyError, Output, RetryError, generateText, type LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { buildLabelOutputSchema, normalizeLabel, taxonomySkillIds, type Taxonomy } from '@attn/shared';
import { FatalLabelerError, RateLimitError } from './errors';
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

const FATAL_STATUSES = new Set([401, 403, 404]);

function fatalReason(e: unknown): string | undefined {
  if (LoadAPIKeyError.isInstance(e)) return 'missing API key';
  if (APICallError.isInstance(e) && e.statusCode !== undefined && FATAL_STATUSES.has(e.statusCode)) {
    return `provider rejected the request (${e.statusCode}): check the API key and the model id`;
  }
  return undefined;
}

/** True for a bad or missing API key and for an unknown model id, also when wrapped in a RetryError. */
export function isFatalProviderError(err: unknown): boolean {
  if (fatalReason(err) !== undefined) return true;
  return RetryError.isInstance(err) && fatalReason(err.lastError) !== undefined;
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
        if (isFatalProviderError(e)) {
          const inner = RetryError.isInstance(e) ? e.lastError : e;
          throw new FatalLabelerError(fatalReason(inner) ?? 'provider error', { cause: e });
        }
        throw e;
      }
    },
  };
}
