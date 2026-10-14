import { describe, it, expect } from 'vitest';
import { APICallError, LoadAPIKeyError, RetryError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { loadTaxonomy } from '../data';
import { createGeminiLabeler, isFatalProviderError, isOverloadedError, isRateLimitError } from './gemini';
import { buildSystemPrompt } from './prompt';
import { FatalLabelerError, OverloadedError, RateLimitError } from './errors';
import { makePublicArticle } from './types';

const taxonomy = loadTaxonomy();
const article = makePublicArticle({ title: 'Hooks deep dive', url: 'https://e.com/hooks', text: 'Body about hooks.' });

function okModel(obj: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text: JSON.stringify(obj) }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

function failingModel(err: unknown) {
  return new MockLanguageModelV4({
    doGenerate: async () => {
      throw err;
    },
  });
}

const api = (statusCode: number) =>
  new APICallError({ message: 'boom', url: 'u', requestBodyValues: {}, statusCode, isRetryable: statusCode === 429 });

const valid = { primary_skill: 'cc-hooks', secondary_skills: ['cc-hooks', 'cc-plugins'], difficulty: 3, type: 'deep_dive', quality: 4 };

describe('createGeminiLabeler', () => {
  it('returns a normalized label', async () => {
    const label = createGeminiLabeler({ model: 'm', taxonomy, languageModel: okModel(valid) });
    expect(await label.label(article)).toEqual({ ...valid, secondary_skills: ['cc-plugins'] });
  });

  it('sends temperature 0, a json schema with skill ids, and the full prompt', async () => {
    const model = okModel(valid);
    await createGeminiLabeler({ model: 'm', taxonomy, languageModel: model }).label(article);
    const call = model.doGenerateCalls[0]!;
    expect(call.temperature).toBe(0);
    expect(call.responseFormat?.type).toBe('json');
    const schema = JSON.stringify((call.responseFormat as { schema?: unknown }).schema);
    expect(schema).toContain('cc-hooks');
    expect(schema).toContain('context-engineering');
    const prompt = JSON.stringify(call.prompt);
    expect(prompt).toContain('Hooks deep dive');
    expect(prompt).toContain('https://e.com/hooks');
    expect(prompt).toContain('Body about hooks.');
    expect(prompt).toContain(JSON.stringify(buildSystemPrompt(taxonomy)).slice(1, -1));
  });

  it('rejects a skill outside the taxonomy, not as a rate limit', async () => {
    const label = createGeminiLabeler({ model: 'm', taxonomy, languageModel: okModel({ ...valid, primary_skill: 'not-a-skill' }) });
    const err = await label.label(article).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('AI_NoObjectGeneratedError');
    expect(err).not.toBeInstanceOf(RateLimitError);
  });

  it('maps a 429 to RateLimitError with the original cause', async () => {
    const e429 = api(429);
    const label = createGeminiLabeler({ model: 'm', taxonomy, maxRetries: 0, languageModel: failingModel(e429) });
    const err = await label.label(article).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).cause).toBe(e429);
  });

  it('passes a 500 through unchanged', async () => {
    const e500 = api(500);
    const label = createGeminiLabeler({ model: 'm', taxonomy, maxRetries: 0, languageModel: failingModel(e500) });
    const err = await label.label(article).catch((e: unknown) => e);
    expect(err).toBe(e500);
    expect(err).not.toBeInstanceOf(RateLimitError);
  });

  it.each([401, 403, 404])('maps a %i to FatalLabelerError with the original cause', async (status) => {
    const e = api(status);
    const label = createGeminiLabeler({ model: 'm', taxonomy, maxRetries: 0, languageModel: failingModel(e) });
    const err = await label.label(article).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(FatalLabelerError);
    expect(err).not.toBeInstanceOf(RateLimitError);
    expect((err as FatalLabelerError).message).toContain(String(status));
    expect((err as FatalLabelerError).cause).toBe(e);
  });

  it('maps a missing API key to FatalLabelerError', async () => {
    const e = new LoadAPIKeyError({ message: 'API key is missing' });
    const label = createGeminiLabeler({ model: 'm', taxonomy, maxRetries: 0, languageModel: failingModel(e) });
    const err = await label.label(article).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(FatalLabelerError);
    expect((err as FatalLabelerError).message).toContain('missing API key');
  });

  it('maps a fatal error wrapped in a RetryError', async () => {
    const e = api(401);
    const wrapped = new RetryError({ message: 'm', reason: 'maxRetriesExceeded', errors: [e] });
    const label = createGeminiLabeler({ model: 'm', taxonomy, maxRetries: 0, languageModel: failingModel(wrapped) });
    expect(await label.label(article).catch((x: unknown) => x)).toBeInstanceOf(FatalLabelerError);
  });

  it('maps a 503 overload, also inside a RetryError, to OverloadedError with the original cause', async () => {
    const e = api(503);
    for (const thrown of [e, new RetryError({ message: 'm', reason: 'maxRetriesExceeded', errors: [e] })]) {
      const label = createGeminiLabeler({ model: 'm', taxonomy, maxRetries: 0, languageModel: failingModel(thrown) });
      const err = await label.label(article).catch((x: unknown) => x);
      expect(err).toBeInstanceOf(OverloadedError);
      expect(err).not.toBeInstanceOf(RateLimitError);
      expect((err as OverloadedError).cause).toBe(thrown);
    }
  });

  it('adds up token usage across calls', async () => {
    const label = createGeminiLabeler({ model: 'm', taxonomy, languageModel: okModel(valid) });
    expect(label.usage?.()).toEqual({ inputTokens: 0, outputTokens: 0 });
    await label.label(article);
    await label.label(article);
    expect(label.usage?.()).toEqual({ inputTokens: 2, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  it('exposes the model id', () => {
    expect(createGeminiLabeler({ model: 'gemini-x', taxonomy, languageModel: okModel(valid) }).model).toBe('gemini-x');
  });

  it('constructs with an api key and no network', () => {
    const l = createGeminiLabeler({ model: 'gemini-3.6-flash', taxonomy, apiKey: 'dummy' });
    expect(l.model).toBe('gemini-3.6-flash');
  });
});

describe('isRateLimitError', () => {
  it('detects 429 directly and inside RetryError', () => {
    const e429 = api(429);
    expect(isRateLimitError(e429)).toBe(true);
    expect(isRateLimitError(new RetryError({ message: 'm', reason: 'maxRetriesExceeded', errors: [e429] }))).toBe(true);
  });
  it('rejects other errors', () => {
    expect(isRateLimitError(new Error('429'))).toBe(false);
    expect(isRateLimitError(api(500))).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
  });
});

const overloadText = (statusCode: number | undefined, message: string) =>
  new APICallError({ message, url: 'u', requestBodyValues: {}, statusCode, isRetryable: true });

describe('isOverloadedError', () => {
  it('detects 503 and 529 by status, and the provider overload text second', () => {
    expect(isOverloadedError(api(503))).toBe(true);
    expect(isOverloadedError(api(529))).toBe(true);
    expect(isOverloadedError(overloadText(500, 'This model is currently experiencing high demand.'))).toBe(true);
    expect(isOverloadedError(overloadText(undefined, 'The model is overloaded. Please try again later.'))).toBe(true);
    expect(isOverloadedError(new RetryError({ message: 'm', reason: 'maxRetriesExceeded', errors: [api(503)] }))).toBe(true);
  });
  it('rejects 429 quota, fatal and other errors', () => {
    expect(isOverloadedError(api(429))).toBe(false);
    expect(isOverloadedError(overloadText(429, 'high demand'))).toBe(false);
    expect(isOverloadedError(api(500))).toBe(false);
    expect(isOverloadedError(api(401))).toBe(false);
    expect(isOverloadedError(new Error('503 overloaded'))).toBe(false);
    expect(isOverloadedError(undefined)).toBe(false);
  });
});

describe('isFatalProviderError', () => {
  it('detects 401/403/404, a missing key, and the same inside RetryError', () => {
    for (const status of [401, 403, 404]) {
      expect(isFatalProviderError(api(status))).toBe(true);
      expect(
        isFatalProviderError(new RetryError({ message: 'm', reason: 'maxRetriesExceeded', errors: [api(status)] })),
      ).toBe(true);
    }
    expect(isFatalProviderError(new LoadAPIKeyError({ message: 'x' }))).toBe(true);
  });
  it('rejects other errors', () => {
    expect(isFatalProviderError(api(429))).toBe(false);
    expect(isFatalProviderError(api(500))).toBe(false);
    expect(isFatalProviderError(new Error('401'))).toBe(false);
    expect(isFatalProviderError(undefined)).toBe(false);
  });
});
