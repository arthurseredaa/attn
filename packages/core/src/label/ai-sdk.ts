// Spec names generateObject; in ai 7 it is deprecated, generateText + Output.object is the same structured-output call.
import {
  APICallError,
  LoadAPIKeyError,
  NoObjectGeneratedError,
  Output,
  RetryError,
  generateText,
  type Instructions,
  type LanguageModel,
  type LanguageModelUsage,
} from 'ai';
import { buildLabelOutputSchema, normalizeLabel, taxonomySkillIds, type Taxonomy } from '@attn/shared';
import { FatalLabelerError, OverloadedError, RateLimitError } from './errors';
import { buildUserPrompt } from './prompt';
import type { LabelTokenUsage, Labeler, PublicArticle } from './types';

function is429(e: unknown): boolean {
  return APICallError.isInstance(e) && e.statusCode === 429;
}

export function isRateLimitError(err: unknown): boolean {
  if (is429(err)) return true;
  return RetryError.isInstance(err) && is429(err.lastError);
}

/** A label is ~100 tokens of JSON; the cap bounds the cost of a runaway response. */
export const LABEL_MAX_OUTPUT_TOKENS = 1024;

const OVERLOAD_STATUSES = new Set([503, 529]);
const OVERLOAD_TEXT = /overloaded|high demand/i;

function isOverload(e: unknown): boolean {
  if (!APICallError.isInstance(e) || e.statusCode === 429) return false;
  if (e.statusCode !== undefined && OVERLOAD_STATUSES.has(e.statusCode)) return true;
  return OVERLOAD_TEXT.test(e.message);
}

/** A transient provider overload (503/529 first, the provider's "overloaded"/"high demand" text second), also inside a RetryError. Never a 429. */
export function isOverloadedError(err: unknown): boolean {
  if (isOverload(err)) return true;
  return RetryError.isInstance(err) && isOverload(err.lastError);
}

// 402 is Anthropic's billing_error; Google never sends it.
const FATAL_STATUSES = new Set([401, 402, 403, 404]);

/** Anthropic's answer when the account has no credit: a 400 `invalid_request_error` saying "credit balance is too low". */
function isCreditExhausted(e: APICallError): boolean {
  if (e.statusCode !== 400 || e.responseBody === undefined) return false;
  try {
    const body = JSON.parse(e.responseBody) as { error?: { type?: unknown; message?: unknown } } | null;
    return (
      body?.error?.type === 'invalid_request_error' &&
      typeof body.error.message === 'string' &&
      /credit balance is too low/i.test(body.error.message)
    );
  } catch {
    return false;
  }
}

function fatalReason(e: unknown): string | undefined {
  if (LoadAPIKeyError.isInstance(e)) return 'missing API key';
  if (!APICallError.isInstance(e)) return undefined;
  if (e.statusCode !== undefined && FATAL_STATUSES.has(e.statusCode)) {
    return e.statusCode === 402
      ? 'provider rejected the request (402): billing problem on the provider account'
      : `provider rejected the request (${e.statusCode}): check the API key and the model id`;
  }
  if (isCreditExhausted(e)) return 'provider rejected the request (400): credit balance is too low';
  return undefined;
}

/** True for a bad or missing API key, an unknown model id, a billing error or no credit, also inside a RetryError. */
export function isFatalProviderError(err: unknown): boolean {
  if (fatalReason(err) !== undefined) return true;
  return RetryError.isInstance(err) && fatalReason(err.lastError) !== undefined;
}

function addUsage(total: LabelTokenUsage, u: LanguageModelUsage): void {
  total.inputTokens += u.inputTokens ?? 0;
  total.outputTokens += u.outputTokens ?? 0;
  const { cacheReadTokens, cacheWriteTokens } = u.inputTokenDetails ?? {};
  if (cacheReadTokens !== undefined) total.cacheReadTokens = (total.cacheReadTokens ?? 0) + cacheReadTokens;
  if (cacheWriteTokens !== undefined) total.cacheWriteTokens = (total.cacheWriteTokens ?? 0) + cacheWriteTokens;
}

export interface AiSdkLabelerOptions {
  model: string;
  languageModel: LanguageModel;
  taxonomy: Taxonomy;
  /** The system prompt, as a string or as a system message carrying provider options (e.g. Anthropic cache control). */
  system: Instructions;
  /** Reasoning level for providers that think by default; omitted from the call when unset. */
  reasoning?: 'none';
  maxRetries?: number;
}

/**
 * The provider-neutral labeler: one structured-output call at temperature 0, with provider errors mapped to
 * RateLimitError (429), FatalLabelerError (bad key, unknown model) and OverloadedError (503/529), in that order.
 */
export function createAiSdkLabeler(opts: AiSdkLabelerOptions): Labeler {
  const { languageModel: model, system } = opts;
  const schema = buildLabelOutputSchema(taxonomySkillIds(opts.taxonomy));
  const maxRetries = opts.maxRetries ?? 1;
  const usage: LabelTokenUsage = { inputTokens: 0, outputTokens: 0 };
  return {
    model: opts.model,
    usage: () => ({ ...usage }),
    async label(article: PublicArticle) {
      try {
        const result = await generateText({
          model,
          output: Output.object({ schema }),
          system,
          prompt: buildUserPrompt(article),
          temperature: 0,
          maxOutputTokens: LABEL_MAX_OUTPUT_TOKENS,
          maxRetries,
          ...(opts.reasoning !== undefined ? { reasoning: opts.reasoning } : {}),
        });
        addUsage(usage, result.usage);
        return normalizeLabel(result.output);
      } catch (e) {
        // A call that reached the model but whose output failed to parse or validate was still billed, and the SDK
        // attaches its usage to NoObjectGeneratedError. HTTP error responses (APICallError, RetryError) and network
        // failures carry no usage in the AI SDK, so they add nothing here.
        if (NoObjectGeneratedError.isInstance(e) && e.usage) addUsage(usage, e.usage);
        if (isRateLimitError(e)) throw new RateLimitError('provider rate limit (429)', { cause: e });
        if (isFatalProviderError(e)) {
          const inner = RetryError.isInstance(e) ? e.lastError : e;
          throw new FatalLabelerError(fatalReason(inner) ?? 'provider error', { cause: e });
        }
        if (isOverloadedError(e)) throw new OverloadedError('provider overloaded (503)', { cause: e });
        throw e;
      }
    },
  };
}
