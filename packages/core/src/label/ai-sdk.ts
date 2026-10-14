// Spec names generateObject; in ai 7 it is deprecated, generateText + Output.object is the same structured-output call.
import { GatewayError } from '@ai-sdk/gateway';
import {
  APICallError,
  Experimental_DecisionUnsupportedQuestionTypeError,
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

/** The HTTP status and text of a failed provider call, whether the AI SDK raised an APICallError or the gateway a GatewayError. */
interface HttpFailure {
  statusCode: number | undefined;
  message: string;
  responseBody: string | undefined;
}

function httpFailure(e: unknown): HttpFailure | undefined {
  if (APICallError.isInstance(e)) return { statusCode: e.statusCode, message: e.message, responseBody: e.responseBody };
  if (GatewayError.isInstance(e)) return { statusCode: e.statusCode, message: e.message, responseBody: undefined };
  return undefined;
}

function is429(e: unknown): boolean {
  return httpFailure(e)?.statusCode === 429;
}

export function isRateLimitError(err: unknown): boolean {
  if (is429(err)) return true;
  return RetryError.isInstance(err) && is429(err.lastError);
}

/** A label is ~100 tokens of JSON; the cap bounds the cost of a runaway response. */
export const LABEL_MAX_OUTPUT_TOKENS = 1024;

const OVERLOAD_STATUSES = new Set([503, 529]);
const OVERLOAD_TEXT = /overloaded|high demand/i;
/** Statuses a gateway raises for a transient upstream failure; the Anthropic and Google paths keep OVERLOAD_STATUSES. */
const GATEWAY_TRANSIENT_STATUSES = new Set([409, 500, 502, 503, 504, 529]);

/** Per-provider tuning of the error mapping. */
export interface ErrorMappingOptions {
  /**
   * Gateway-style provider: besides 401/402/403/404, a 400/422 whose message does not point at the article
   * (context length, token count) is fatal, because a rejected request or config repeats for every article;
   * 409/500/502/504 count as transient like 503/529. Other 4xx (413, 408, input-caused 400/422) fail that article only.
   */
  gateway?: boolean;
}

function isOverload(e: unknown, opts: ErrorMappingOptions): boolean {
  const f = httpFailure(e);
  if (!f || f.statusCode === 429) return false;
  const statuses = opts.gateway ? GATEWAY_TRANSIENT_STATUSES : OVERLOAD_STATUSES;
  if (f.statusCode !== undefined && statuses.has(f.statusCode)) return true;
  return OVERLOAD_TEXT.test(f.message);
}

/** A transient provider overload (503/529 first, the provider's "overloaded"/"high demand" text second), also inside a RetryError. Never a 429. */
export function isOverloadedError(err: unknown, opts: ErrorMappingOptions = {}): boolean {
  if (isOverload(err, opts)) return true;
  return RetryError.isInstance(err) && isOverload(err.lastError, opts);
}

// 402 is Anthropic's billing_error; Google never sends it.
const FATAL_STATUSES = new Set([401, 402, 403, 404]);

/** Anthropic's answer when the account has no credit: a 400 `invalid_request_error` saying "credit balance is too low". */
function isCreditExhausted(f: HttpFailure): boolean {
  if (f.statusCode !== 400 || f.responseBody === undefined) return false;
  try {
    const body = JSON.parse(f.responseBody) as { error?: { type?: unknown; message?: unknown } } | null;
    return (
      body?.error?.type === 'invalid_request_error' &&
      typeof body.error.message === 'string' &&
      /credit balance is too low/i.test(body.error.message)
    );
  } catch {
    return false;
  }
}

/** A 400/422 that blames the article itself (too long, too many tokens) is a per-article failure, not a config problem. */
const INPUT_CAUSED = /context|too (long|large)|token|length/i;

/** The provider's own message on one line, at most 300 characters, with anything key-shaped masked. */
function describe(message: string): string {
  const one = message.replace(/\s+/g, ' ').trim().replace(/\b(?:vck|sk|AIza)[-_A-Za-z0-9]{8,}/g, '[redacted]');
  return one.length > 300 ? `${one.slice(0, 300)}...` : one;
}

function fatalReason(e: unknown, opts: ErrorMappingOptions): string | undefined {
  if (LoadAPIKeyError.isInstance(e)) return 'missing API key';
  if (opts.gateway && Experimental_DecisionUnsupportedQuestionTypeError.isInstance(e)) {
    return `the decision model does not support a question type this labeler sends: ${describe(e.message)}`;
  }
  const f = httpFailure(e);
  if (!f || f.statusCode === undefined) return undefined;
  const rejected = `provider rejected the request (${f.statusCode}): ${describe(f.message)}`;
  if (FATAL_STATUSES.has(f.statusCode) || isCreditExhausted(f)) return rejected;
  if (opts.gateway && (f.statusCode === 400 || f.statusCode === 422) && !INPUT_CAUSED.test(f.message)) return rejected;
  return undefined;
}

/** True for a bad or missing API key, an unknown model id, a billing error or no credit, also inside a RetryError. */
export function isFatalProviderError(err: unknown, opts: ErrorMappingOptions = {}): boolean {
  if (fatalReason(err, opts) !== undefined) return true;
  return RetryError.isInstance(err) && fatalReason(err.lastError, opts) !== undefined;
}

/**
 * Maps a provider failure to RateLimitError (429), FatalLabelerError (bad key, unknown model, billing, and for a
 * gateway any request-level 4xx) or OverloadedError (transient), in that order; anything else is returned as is.
 */
export function mapProviderError(e: unknown, opts: ErrorMappingOptions = {}): unknown {
  if (isRateLimitError(e)) return new RateLimitError('provider rate limit (429)', { cause: e });
  if (isFatalProviderError(e, opts)) {
    const inner = RetryError.isInstance(e) ? e.lastError : e;
    return new FatalLabelerError(fatalReason(inner, opts) ?? 'provider error', { cause: e });
  }
  if (isOverloadedError(e, opts)) return new OverloadedError('provider overloaded (503)', { cause: e });
  return e;
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
        throw mapProviderError(e);
      }
    },
  };
}
