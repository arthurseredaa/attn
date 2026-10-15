import { describe, it, expect, vi } from 'vitest';
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { loadTaxonomy } from '../data';
import { createGeminiLabeler } from './gemini';
import { createComboLabeler, mergeSecondarySkills, parseLabelModel } from './combo';
import { createLabeler, labelProvidersFor, labelerConfigError } from './factory';
import { FatalLabelerError, OverloadedError, RateLimitError } from './errors';
import { makePublicArticle } from './types';

const taxonomy = loadTaxonomy();
const article = makePublicArticle({ title: 'Hooks', url: 'https://e.com/h', text: 'Body.' });

const mainOut = { primary_skill: 'cc-hooks', secondary_skills: ['cc-plugins'], difficulty: 3, type: 'deep_dive', quality: 4 };
const secOut = {
  primary_skill: 'context-engineering',
  secondary_skills: ['cc-hooks', 'cc-mcp-usage', 'cc-plugins'],
  difficulty: 1,
  type: 'news',
  quality: 1,
};

function okModel(obj: unknown, tokens = 1) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text' as const, text: JSON.stringify(obj) }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: { total: tokens, noCache: tokens, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: tokens, text: tokens, reasoning: 0 },
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
  new APICallError({ message: 'boom', url: 'u', requestBodyValues: {}, statusCode, isRetryable: false });

function combo(main: MockLanguageModelV4, secondary: MockLanguageModelV4) {
  const onFallback = vi.fn();
  const labeler = createComboLabeler({
    model: 'main-m+sec-m',
    main: createGeminiLabeler({ model: 'main-m', taxonomy, languageModel: main, maxRetries: 0 }),
    secondary: createGeminiLabeler({ model: 'sec-m', taxonomy, languageModel: secondary, maxRetries: 0 }),
    onSecondaryFallback: onFallback,
  });
  return { labeler, onFallback };
}

describe('parseLabelModel', () => {
  it('returns a plain model as main only', () => {
    expect(parseLabelModel('claude-haiku-5-5')).toEqual({ main: 'claude-haiku-5-5' });
  });
  it('splits main+secondary', () => {
    expect(parseLabelModel('claude-haiku-5-5+gemini-3.5-flash-lite')).toEqual({
      main: 'claude-haiku-5-5',
      secondary: 'gemini-3.5-flash-lite',
    });
  });
  it('fails fast on empty parts and nested +', () => {
    for (const bad of ['+gemini-3.5-flash-lite', 'claude-haiku-5-5+', '+', 'a+b+c', 'a++b']) {
      expect(() => parseLabelModel(bad), bad).toThrow(FatalLabelerError);
    }
  });
});

describe('factory with a combo', () => {
  const both = { ANTHROPIC_API_KEY: 'k', GOOGLE_GENERATIVE_AI_API_KEY: 'k' };
  const id = 'claude-haiku-5-5+gemini-3.5-flash-lite';

  it('is valid when both keys are set and names the missing one otherwise', () => {
    expect(labelerConfigError(id, both)).toBeUndefined();
    expect(labelerConfigError(id, { ANTHROPIC_API_KEY: 'k' })).toContain('GOOGLE_GENERATIVE_AI_API_KEY is not set');
    expect(labelerConfigError(id, { GOOGLE_GENERATIVE_AI_API_KEY: 'k' })).toContain('ANTHROPIC_API_KEY is not set');
  });
  it('reports an unknown provider in either part and malformed combos', () => {
    expect(labelerConfigError('claude-haiku-5-5+gpt-5', both)).toContain('unknown LABEL_MODEL provider');
    expect(labelerConfigError('gpt-5+claude-haiku-5-5', both)).toContain('unknown LABEL_MODEL provider');
    expect(labelerConfigError('claude-haiku-5-5+', both)).toContain('invalid LABEL_MODEL');
    expect(labelerConfigError('a+b+c', both)).toContain('invalid LABEL_MODEL');
    expect(() => createLabeler({ model: 'claude-haiku-5-5+', taxonomy, env: both })).toThrow(FatalLabelerError);
  });
  it('builds a labeler stored under the full combo string, without network', () => {
    const l = createLabeler({ model: id, taxonomy, env: both });
    expect(l.model).toBe(id);
    expect(Object.keys(l.usageByModel?.() ?? {})).toEqual(['claude-haiku-5-5', 'gemini-3.5-flash-lite']);
  });
  it('labelProvidersFor lists each part', () => {
    expect(labelProvidersFor(id).map((p) => p.provider)).toEqual(['anthropic', 'google']);
    expect(labelProvidersFor('claude-haiku-5-5').map((p) => p.provider)).toEqual(['anthropic']);
  });
});

describe('mergeSecondarySkills', () => {
  const main = { primary_skill: 'a', secondary_skills: ['z'], difficulty: 2, type: 'tutorial' as const, quality: 3 };
  it('excludes main primary, dedupes, caps at 3 and keeps order', () => {
    expect(mergeSecondarySkills(main, ['b', 'a', 'c', 'b', 'd', 'e']).secondary_skills).toEqual(['b', 'c', 'd']);
  });
  it('can yield an empty list and leaves other fields as main', () => {
    expect(mergeSecondarySkills(main, ['a'])).toEqual({ ...main, secondary_skills: [] });
  });
});

describe('createComboLabeler', () => {
  it('takes main fields and the secondary labeler secondary skills (minus main primary)', async () => {
    const { labeler, onFallback } = combo(okModel(mainOut), okModel(secOut));
    expect(await labeler.label(article)).toEqual({ ...mainOut, secondary_skills: ['cc-mcp-usage', 'cc-plugins'] });
    expect(onFallback).not.toHaveBeenCalled();
  });

  it.each([
    ['429', () => failingModel(api(429))],
    ['overload', () => failingModel(api(503))],
    ['invalid output', () => okModel({ nonsense: true })],
    ['fatal 401', () => failingModel(api(401))],
    ['network error', () => failingModel(new Error('socket hang up'))],
  ])('keeps main secondary skills when the secondary fails with %s', async (_name, bad) => {
    const { labeler, onFallback } = combo(okModel(mainOut), bad());
    expect(await labeler.label(article)).toEqual(mainOut);
    expect(onFallback).toHaveBeenCalledTimes(1);
    expect(onFallback.mock.calls[0]![0]).toEqual(expect.any(String));
  });

  it('still throws the main errors as the main labeler does', async () => {
    await expect(combo(failingModel(api(401)), okModel(secOut)).labeler.label(article)).rejects.toBeInstanceOf(FatalLabelerError);
    await expect(combo(failingModel(api(429)), okModel(secOut)).labeler.label(article)).rejects.toBeInstanceOf(RateLimitError);
    await expect(combo(failingModel(api(503)), okModel(secOut)).labeler.label(article)).rejects.toBeInstanceOf(OverloadedError);
  });

  it('does not warn when main fails too', async () => {
    const { labeler, onFallback } = combo(failingModel(api(401)), failingModel(api(401)));
    await expect(labeler.label(article)).rejects.toBeInstanceOf(FatalLabelerError);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('sums usage of both calls and breaks it down per model', async () => {
    const { labeler } = combo(okModel(mainOut, 10), okModel(secOut, 3));
    await labeler.label(article);
    await labeler.label(article);
    expect(labeler.usage?.()).toEqual({ inputTokens: 26, outputTokens: 26, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(labeler.usageByModel?.()).toEqual({
      'main-m': { inputTokens: 20, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
      'sec-m': { inputTokens: 6, outputTokens: 6, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });
  });

  it('counts the main usage even when the secondary falls back', async () => {
    const { labeler } = combo(okModel(mainOut, 10), failingModel(api(429)));
    await labeler.label(article);
    expect(labeler.usage?.()).toEqual({ inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });
});
