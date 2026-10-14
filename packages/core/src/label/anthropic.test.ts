import { describe, it, expect } from 'vitest';
import { loadTaxonomy } from '../data';
import { createAnthropicLabeler } from './anthropic';
import { buildSystemPrompt } from './prompt';
import { FatalLabelerError, OverloadedError, RateLimitError } from './errors';
import { makePublicArticle } from './types';

const taxonomy = loadTaxonomy();
const article = makePublicArticle({ title: 'Hooks deep dive', url: 'https://e.com/hooks', text: 'Body about hooks.' });
const valid = { primary_skill: 'cc-hooks', secondary_skills: ['cc-plugins'], difficulty: 3, type: 'deep_dive', quality: 4 };

interface Sent {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

/** A fetch that records each request and answers like the Anthropic Messages API, never touching the network. */
function fakeFetch(respond: (callIndex: number) => { status: number; body: unknown }) {
  const sent: Sent[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const { status, body } = respond(sent.length - 1);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch: fetch as typeof globalThis.fetch, sent };
}

const message = (text: string, usage: Record<string, number>) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-5-5',
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage,
});

const ok = (usage: Record<string, number> = { input_tokens: 10, output_tokens: 5 }) => ({
  status: 200,
  body: message(JSON.stringify(valid), usage),
});

const apiError = (status: number, type: string, msg: string) => ({
  status,
  body: { type: 'error', error: { type, message: msg } },
});

function labeler(respond: Parameters<typeof fakeFetch>[0], model = 'claude-haiku-5-5') {
  const f = fakeFetch(respond);
  return { l: createAnthropicLabeler({ model, taxonomy, apiKey: 'test-key', maxRetries: 0, fetch: f.fetch }), sent: f.sent };
}

describe('createAnthropicLabeler', () => {
  it('returns a normalized label from the structured output', async () => {
    const { l } = labeler(() => ok());
    expect(await l.label(article)).toEqual(valid);
    expect(l.model).toBe('claude-haiku-5-5');
  });

  it('calls the Messages API with the key, the model and a json schema holding the skill ids', async () => {
    const { l, sent } = labeler(() => ok());
    await l.label(article);
    expect(sent).toHaveLength(1);
    const req = sent[0]!;
    expect(req.url).toBe('https://api.anthropic.com/v1/messages');
    expect(req.headers.get('x-api-key')).toBe('test-key');
    expect(req.body.model).toBe('claude-haiku-5-5');
    const schema = JSON.stringify(req.body.output_config ?? req.body.tools);
    expect(schema).toContain('cc-hooks');
    expect(schema).toContain('context-engineering');
    const user = JSON.stringify(req.body.messages);
    expect(user).toContain('Hooks deep dive');
    expect(user).toContain('https://e.com/hooks');
    expect(user).toContain('Body about hooks.');
  });

  it('sends the system prompt as one block marked for prompt caching', async () => {
    const { l, sent } = labeler(() => ok());
    await l.label(article);
    expect(sent[0]!.body.system).toEqual([
      { type: 'text', text: buildSystemPrompt(taxonomy), cache_control: { type: 'ephemeral' } },
    ]);
  });

  it('sends temperature 0 to a model that accepts sampling parameters', async () => {
    const { l, sent } = labeler(() => ok(), 'claude-haiku-4-5');
    await l.label(article);
    expect(sent[0]!.body.temperature).toBe(0);
  });

  it('asks Haiku 5.5 for no extended thinking', async () => {
    const { l, sent } = labeler(() => ok());
    await l.label(article);
    expect(sent[0]!.body.thinking).toEqual({ type: 'disabled' });
  });

  it('asks a model that cannot disable thinking for the lowest effort instead', async () => {
    const { l, sent } = labeler(() => ok(), 'claude-opus-5-5');
    await l.label(article);
    expect(sent[0]!.body.thinking).toBeUndefined();
    expect((sent[0]!.body.output_config as { effort?: string }).effort).toBe('low');
  });

  it('caps the output at 1024 tokens', async () => {
    const { l, sent } = labeler(() => ok());
    await l.label(article);
    expect(sent[0]!.body.max_tokens).toBe(1024);
  });

  it('counts the usage of a call that reached the model but returned an invalid label', async () => {
    const { l } = labeler(() => ({
      status: 200,
      body: message('{"primary_skill":"not-a-skill"}', { input_tokens: 40, output_tokens: 9, cache_read_input_tokens: 30 }),
    }));
    const err = await l.label(article).catch((e: unknown) => e);
    expect((err as Error).name).toBe('AI_NoObjectGeneratedError');
    expect(l.usage?.()).toEqual({ inputTokens: 70, outputTokens: 9, cacheReadTokens: 30, cacheWriteTokens: 0 });
  });

  it('counts nothing for an HTTP error response, which carries no usage', async () => {
    const { l } = labeler(() => apiError(500, 'api_error', 'Internal server error'));
    await l.label(article).catch(() => undefined);
    expect(l.usage?.()).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('adds up token usage across calls, including cache reads and writes', async () => {
    const { l } = labeler((i) =>
      ok(
        i === 0
          ? { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 900, cache_read_input_tokens: 0 }
          : { input_tokens: 12, output_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 900 },
      ),
    );
    expect(l.usage?.()).toEqual({ inputTokens: 0, outputTokens: 0 });
    await l.label(article);
    await l.label(article);
    expect(l.usage?.()).toEqual({ inputTokens: 1822, outputTokens: 12, cacheReadTokens: 900, cacheWriteTokens: 900 });
  });

  it.each([
    [401, 'authentication_error', 'invalid x-api-key'],
    [403, 'permission_error', 'Your API key does not have permission to use the specified resource.'],
    [404, 'not_found_error', 'model: claude-nope'],
    [402, 'billing_error', 'There is a billing issue with your account.'],
  ])('maps a %i (%s) to FatalLabelerError', async (status, type, msg) => {
    const { l } = labeler(() => apiError(status, type, msg));
    const err = await l.label(article).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FatalLabelerError);
    expect((err as Error).message).toContain(String(status));
  });

  it('maps a 429 rate_limit_error to RateLimitError', async () => {
    const { l } = labeler(() => apiError(429, 'rate_limit_error', 'Number of request tokens has exceeded your rate limit'));
    const err = await l.label(article).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err).not.toBeInstanceOf(OverloadedError);
  });

  it('keeps 429 ahead of overload even when the 429 text says overloaded', async () => {
    const { l } = labeler(() => apiError(429, 'rate_limit_error', 'Overloaded: too many requests'));
    expect(await l.label(article).catch((e: unknown) => e)).toBeInstanceOf(RateLimitError);
  });

  it.each([
    [529, 'overloaded_error', 'Overloaded'],
    [503, 'api_error', 'Service unavailable'],
  ])('maps a %i (%s) to OverloadedError for the bounded retry', async (status, type, msg) => {
    const { l } = labeler(() => apiError(status, type, msg));
    const err = await l.label(article).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OverloadedError);
    expect(err).not.toBeInstanceOf(RateLimitError);
    expect(err).not.toBeInstanceOf(FatalLabelerError);
  });

  it('maps a 400 whose body says the credit balance is too low to FatalLabelerError', async () => {
    const { l } = labeler(() =>
      apiError(
        400,
        'invalid_request_error',
        'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.',
      ),
    );
    const err = await l.label(article).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FatalLabelerError);
    expect((err as Error).message).toContain('credit balance is too low');
  });

  it('does not treat other 400s, or the credit text under another error type, as fatal', async () => {
    for (const body of [
      apiError(400, 'invalid_request_error', 'messages: field required'),
      apiError(400, 'api_error', 'Your credit balance is too low'),
    ]) {
      const { l } = labeler(() => body);
      const err = await l.label(article).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(FatalLabelerError);
      expect(err).not.toBeInstanceOf(RateLimitError);
      expect(err).not.toBeInstanceOf(OverloadedError);
    }
  });

  it('constructs with an api key and no network', () => {
    expect(createAnthropicLabeler({ model: 'claude-haiku-5-5', taxonomy, apiKey: 'dummy' }).model).toBe('claude-haiku-5-5');
  });
});
