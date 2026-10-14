import type { LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { Taxonomy } from '@attn/shared';
import { createAiSdkLabeler } from './ai-sdk';
import { buildSystemPrompt } from './prompt';
import type { Labeler } from './types';

export { isFatalProviderError, isOverloadedError, isRateLimitError } from './ai-sdk';

export interface GeminiLabelerOptions {
  model: string;
  taxonomy: Taxonomy;
  apiKey?: string;
  languageModel?: LanguageModel;
  maxRetries?: number;
}

export function createGeminiLabeler(opts: GeminiLabelerOptions): Labeler {
  const languageModel = opts.languageModel ?? createGoogleGenerativeAI({ apiKey: opts.apiKey })(opts.model);
  return createAiSdkLabeler({
    model: opts.model,
    languageModel,
    taxonomy: opts.taxonomy,
    system: buildSystemPrompt(opts.taxonomy),
    ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
  });
}
