import type { LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { Taxonomy } from '@attn/shared';
import { createAiSdkLabeler } from './ai-sdk';
import { buildSystemPrompt } from './prompt';
import type { Labeler } from './types';

export interface AnthropicLabelerOptions {
  model: string;
  taxonomy: Taxonomy;
  apiKey?: string;
  languageModel?: LanguageModel;
  maxRetries?: number;
  /** For tests: replaces the HTTP client so no request leaves the process. */
  fetch?: typeof globalThis.fetch;
}

/**
 * A Claude labeler. Same prompt, schema, temperature and error mapping as the Gemini one; the system prompt
 * (taxonomy and rubrics, identical on every call) carries an ephemeral cache-control mark, so after the first
 * call it is billed as a cache read while the 5-minute cache lives. Extended thinking is turned off (or minimized).
 */
export function createAnthropicLabeler(opts: AnthropicLabelerOptions): Labeler {
  const languageModel =
    opts.languageModel ??
    createAnthropic({ apiKey: opts.apiKey, ...(opts.fetch ? { fetch: opts.fetch } : {}) })(opts.model);
  return createAiSdkLabeler({
    model: opts.model,
    languageModel,
    taxonomy: opts.taxonomy,
    system: {
      role: 'system',
      content: buildSystemPrompt(opts.taxonomy),
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    },
    // A classification needs no extended thinking (billed as output). @ai-sdk/anthropic maps 'none' per model:
    // thinking disabled where the model allows it (Haiku 5.5), else the lowest thinking setting or effort 'low'.
    reasoning: 'none',
    ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
  });
}
