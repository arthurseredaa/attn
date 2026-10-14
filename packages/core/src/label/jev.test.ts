import { describe, it, expect } from 'vitest';
import { APICallError, RetryError } from 'ai';
import { Experimental_DecisionMockModelV4 as DecisionMockModel } from 'ai/test';
import {
  GatewayAuthenticationError,
  GatewayForbiddenError,
  GatewayInternalServerError,
  GatewayInvalidRequestError,
  GatewayModelNotFoundError,
  GatewayRateLimitError,
} from '@ai-sdk/gateway';
import { articleTypeSchema, taxonomySkillIds } from '@attn/shared';
import { loadTaxonomy } from '../data';
import { DIFFICULTY_RUBRIC, QUALITY_RUBRIC, TYPE_RUBRIC } from './prompt';
import { FatalLabelerError, OverloadedError, RateLimitError } from './errors';
import { InvalidJevOutputError, buildJevQuestions, createJevLabeler, mapJevAnswers } from './jev';
import { makePublicArticle } from './types';

const taxonomy = loadTaxonomy();
const skillIds = taxonomySkillIds(taxonomy);
const article = makePublicArticle({ title: 'Hooks deep dive', url: 'https://e.com/hooks', text: 'Body about hooks.' });

type DecisionResult = Awaited<ReturnType<DecisionMockModel['doDecide']>>;
type Answers = DecisionResult['answers'];

/** Answers for the four choice questions plus a probability per skill (default 0.01). */
function answers(
  over: { primary?: string; probs?: Record<string, number>; difficulty?: string; quality?: string; type?: string } = {},
): Answers {
  const a: Answers = {
    primary_skill: { type: 'choice', choice: over.primary ?? 'cc-hooks' },
    type: { type: 'choice', choice: over.type ?? 'deep_dive' },
    difficulty: { type: 'choice', choice: over.difficulty ?? '3' },
    quality: { type: 'choice', choice: over.quality ?? '4' },
  };
  for (const id of skillIds) a[`secondary:${id}`] = { type: 'boolean', probability: over.probs?.[id] ?? 0.01 };
  return a;
}

function mockModel(respond: (call: number) => DecisionResult | Promise<DecisionResult>) {
  let calls = 0;
  return new DecisionMockModel({
    supportedQuestionTypes: ['choice', 'boolean', 'score'],
    doDecide: async () => respond(calls++),
  });
}

const ok = (a: Answers, usage: DecisionResult['usage'] = { inputTokens: 100, outputTokens: 7 }): DecisionResult => ({
  answers: a,
  usage,
  warnings: [],
});

function labeler(respond: (call: number) => DecisionResult | Promise<DecisionResult>, threshold?: number) {
  return createJevLabeler({
    model: 'typesafe-ai/jev',
    taxonomy,
    decisionModel: mockModel(respond),
    maxRetries: 0,
    ...(threshold !== undefined ? { secondaryThreshold: threshold } : {}),
  });
}

describe('buildJevQuestions', () => {
  const questions = buildJevQuestions(taxonomy);

  it('has one boolean question per taxonomy skill and the four choice questions', () => {
    expect(Object.keys(questions)).toHaveLength(4 + skillIds.length);
    for (const id of skillIds) expect(questions[`secondary:${id}`]?.type).toBe('boolean');
    for (const id of ['primary_skill', 'type', 'difficulty', 'quality']) expect(questions[id]?.type).toBe('choice');
  });

  it('offers every skill id as a primary choice, with its description', () => {
    const q = questions.primary_skill!;
    if (q.type !== 'choice') throw new Error('not a choice');
    expect(Object.keys(q.criteria).sort()).toEqual([...skillIds].sort());
    for (const s of taxonomy.domains.flatMap((d) => d.skills)) {
      expect(JSON.stringify(q.criteria[s.id])).toContain(s.description);
      expect(JSON.stringify(questions[`secondary:${s.id}`]!.instructions)).toContain(s.description);
    }
  });

  it('uses the prompt.ts rubrics as instructions and the 0-4 scale for difficulty and quality', () => {
    expect(JSON.stringify(questions.type!.instructions)).toContain(TYPE_RUBRIC);
    expect(JSON.stringify(questions.difficulty!.instructions)).toContain(DIFFICULTY_RUBRIC);
    expect(JSON.stringify(questions.quality!.instructions)).toContain(QUALITY_RUBRIC);
    for (const id of ['difficulty', 'quality']) {
      const q = questions[id]!;
      if (q.type !== 'choice') throw new Error('not a choice');
      expect(Object.keys(q.criteria)).toEqual(['0', '1', '2', '3', '4']);
    }
    const t = questions.type!;
    if (t.type !== 'choice') throw new Error('not a choice');
    expect(Object.keys(t.criteria)).toEqual([...articleTypeSchema.options]);
  });
});

describe('mapJevAnswers', () => {
  const map = (a: Answers, threshold = 0.5) =>
    mapJevAnswers(a as Parameters<typeof mapJevAnswers>[0], taxonomy, threshold);

  it('maps the choices to the label, with numeric difficulty and quality', () => {
    expect(map(answers({ primary: 'cc-hooks', difficulty: '2', quality: '1', type: 'news' }))).toEqual({
      primary_skill: 'cc-hooks',
      secondary_skills: [],
      difficulty: 2,
      type: 'news',
      quality: 1,
    });
  });

  it('takes skills at or above the threshold, highest probability first', () => {
    const a = answers({
      probs: { 'cc-plugins': 0.5, 'cc-subagents': 0.9, 'context-engineering': 0.7, 'cc-skills-commands': 0.49 },
    });
    expect(map(a).secondary_skills).toEqual(['cc-subagents', 'context-engineering', 'cc-plugins']);
  });

  it('never repeats the primary skill, even at probability 1', () => {
    const a = answers({ primary: 'cc-hooks', probs: { 'cc-hooks': 1, 'cc-plugins': 0.6 } });
    expect(map(a).secondary_skills).toEqual(['cc-plugins']);
  });

  it('keeps at most 3, the three most probable', () => {
    const a = answers({
      probs: { 'cc-plugins': 0.6, 'cc-subagents': 0.9, 'context-engineering': 0.8, 'cc-skills-commands': 0.7 },
    });
    expect(map(a).secondary_skills).toEqual(['cc-subagents', 'context-engineering', 'cc-skills-commands']);
  });

  it('breaks probability ties in taxonomy order and honors a custom threshold', () => {
    const a = answers({ probs: { 'cc-subagents': 0.8, 'cc-plugins': 0.8, 'cc-skills-commands': 0.3 } });
    const tied = skillIds.filter((id) => id === 'cc-subagents' || id === 'cc-plugins');
    expect(map(a).secondary_skills).toEqual(tied);
    expect(map(a, 0.25).secondary_skills).toHaveLength(3);
    expect(map(a, 0.95).secondary_skills).toEqual([]);
  });

  it('defensively treats a refused or missing secondary answer as not covered (decide never passes one on)', () => {
    const a = answers({ probs: { 'cc-plugins': 0.9 } });
    a['secondary:cc-plugins'] = { type: 'refusal' };
    delete a['secondary:cc-subagents'];
    expect(map(a).secondary_skills).toEqual([]);
  });

  it('defensively rejects a refused or missing core answer, and a choice outside the schema', () => {
    for (const id of ['primary_skill', 'type', 'difficulty', 'quality']) {
      const refused = answers();
      refused[id] = { type: 'refusal' };
      expect(() => map(refused)).toThrow(InvalidJevOutputError);
      const missing = answers();
      delete missing[id];
      expect(() => map(missing)).toThrow(InvalidJevOutputError);
    }
    expect(() => map(answers({ primary: 'not-a-skill' }))).toThrow(/invalid label/);
    expect(() => map(answers({ difficulty: '9' }))).toThrow(InvalidJevOutputError);
    expect(() => map(answers({ type: 'podcast' }))).toThrow(InvalidJevOutputError);
  });
});

describe('createJevLabeler', () => {
  it('makes one decide call per article, with the article as state and all questions', async () => {
    let seen: Parameters<DecisionMockModel['doDecide']>[0] | undefined;
    let calls = 0;
    const model = new DecisionMockModel({
      supportedQuestionTypes: ['choice', 'boolean', 'score'],
      doDecide: async (o) => {
        calls++;
        seen = o;
        return ok(answers({ probs: { 'cc-plugins': 0.8 } }));
      },
    });
    const l = createJevLabeler({ model: 'typesafe-ai/jev', taxonomy, decisionModel: model });
    expect(l.model).toBe('typesafe-ai/jev');
    expect(await l.label(article)).toEqual({
      primary_skill: 'cc-hooks',
      secondary_skills: ['cc-plugins'],
      difficulty: 3,
      type: 'deep_dive',
      quality: 4,
    });
    expect(calls).toBe(1);
    expect(Object.keys(seen!.questions)).toHaveLength(4 + skillIds.length);
    const state = JSON.stringify(seen!.state);
    expect(state).toContain('Hooks deep dive');
    expect(state).toContain('https://e.com/hooks');
    expect(state).toContain('Body about hooks.');
  });

  it('uses the default threshold 0.5 unless one is given', async () => {
    const a = answers({ probs: { 'cc-plugins': 0.5, 'cc-subagents': 0.4 } });
    expect((await labeler(() => ok(a)).label(article)).secondary_skills).toEqual(['cc-plugins']);
    expect((await labeler(() => ok(a), 0.3).label(article)).secondary_skills).toEqual(['cc-plugins', 'cc-subagents']);
  });

  it('adds up input and output tokens across calls', async () => {
    const l = labeler((i) =>
      ok(answers(), i === 0 ? { inputTokens: 100, outputTokens: 7 } : { inputTokens: 50, outputTokens: undefined }),
    );
    expect(l.usage?.()).toEqual({ inputTokens: 0, outputTokens: 0 });
    await l.label(article);
    await l.label(article);
    expect(l.usage?.()).toEqual({ inputTokens: 150, outputTokens: 7 });
  });

  it('fails an article whose answers decide itself rejects (a choice outside the options), not as a provider error', async () => {
    const l = labeler(() => ok(answers({ primary: 'not-a-skill' })));
    const err = await l.label(article).catch((e: unknown) => e);
    expect((err as Error).name).toBe('AI_InvalidResponseDataError');
    expect(err).not.toBeInstanceOf(FatalLabelerError);
    expect(err).not.toBeInstanceOf(RateLimitError);
    expect(err).not.toBeInstanceOf(OverloadedError);
  });

  it('turns a refused secondary question into probability 0 and still labels the article', async () => {
    const a = answers({ probs: { 'cc-plugins': 0.9, 'cc-subagents': 0.8 } });
    a['secondary:cc-plugins'] = { type: 'refusal' };
    expect((await labeler(() => ok(a)).label(article)).secondary_skills).toEqual(['cc-subagents']);
  });

  it.each(['primary_skill', 'type', 'difficulty', 'quality'])(
    'fails the article, as a plain failure, when %s is refused, and still counts the billed tokens',
    async (id) => {
      const a = answers();
      a[id] = { type: 'refusal' };
      const l = labeler(() => ok(a, { inputTokens: 40, outputTokens: 3 }));
      const err = await l.label(article).catch((e: unknown) => e);
      expect((err as Error).name).toBe('AI_DecisionRefusalError');
      expect(err).not.toBeInstanceOf(FatalLabelerError);
      expect(err).not.toBeInstanceOf(RateLimitError);
      expect(err).not.toBeInstanceOf(OverloadedError);
      expect(l.usage?.()).toEqual({ inputTokens: 40, outputTokens: 3 });
    },
  );

  it('counts the tokens of a billed call whose answers fail decide validation', async () => {
    const l = labeler(() => ok(answers({ primary: 'not-a-skill' }), { inputTokens: 55, outputTokens: 2 }));
    await l.label(article).catch(() => undefined);
    expect(l.usage?.()).toEqual({ inputTokens: 55, outputTokens: 2 });
  });

  it('counts nothing for a call that failed with an HTTP error', async () => {
    const l = labeler(() => Promise.reject(new GatewayInternalServerError({ statusCode: 500 })));
    await l.label(article).catch(() => undefined);
    expect(l.usage?.()).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it('maps a decision model that does not support a question type to FatalLabelerError', async () => {
    const model = new DecisionMockModel({ supportedQuestionTypes: ['choice'], doDecide: async () => ok(answers()) });
    const l = createJevLabeler({ model: 'typesafe-ai/jev', taxonomy, decisionModel: model, maxRetries: 0 });
    expect(await l.label(article).catch((e: unknown) => e)).toBeInstanceOf(FatalLabelerError);
  });

  it('constructs with an api key and no network', () => {
    expect(createJevLabeler({ model: 'typesafe-ai/jev', taxonomy, apiKey: 'vck_dummy' }).model).toBe('typesafe-ai/jev');
  });

  it('sends the explicit key to the gateway and maps its 401 to FatalLabelerError', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      seen.push({ url: String(input), auth: new Headers(init?.headers).get('authorization') });
      return new Response(JSON.stringify({ error: { message: 'Invalid API key', type: 'authentication_error' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      });
    };
    const l = createJevLabeler({ model: 'typesafe-ai/jev', taxonomy, apiKey: 'vck_test', maxRetries: 0, fetch });
    const err = await l.label(article).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FatalLabelerError);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.auth).toBe('Bearer vck_test');
  });
});

describe('jev error mapping', () => {
  const fail = async (e: unknown) =>
    labeler(() => Promise.reject(e))
      .label(article)
      .catch((x: unknown) => x);
  const api = (statusCode: number, message = 'boom') =>
    new APICallError({ message, url: 'u', requestBodyValues: {}, statusCode, isRetryable: false });
  const wrap = (lastError: unknown) =>
    new RetryError({ message: 'failed after retries', reason: 'maxRetriesExceeded', errors: [lastError] });

  it.each([
    ['authentication', new GatewayAuthenticationError({ statusCode: 401 }), '401'],
    ['forbidden', new GatewayForbiddenError({ statusCode: 403 }), '403'],
    ['model not found', new GatewayModelNotFoundError({ statusCode: 404 }), '404'],
    ['402 billing', new GatewayInvalidRequestError({ message: 'Insufficient credits', statusCode: 402 }), '402'],
    ['invalid request', new GatewayInvalidRequestError({ message: 'bad question', statusCode: 400 }), '400'],
    ['an APICallError 422', api(422, 'unprocessable'), '422'],
  ])('maps a gateway %s error to FatalLabelerError', async (_n, e, status) => {
    const err = await fail(e);
    expect(err).toBeInstanceOf(FatalLabelerError);
    expect((err as Error).message).toContain(status);
  });

  it('keeps the provider message of the free-tier 403 instead of a generic hint', async () => {
    const msg =
      'Free tier users do not have access to this model. Upgrade to paid credits at https://vercel.com/d?to=%2F%5Bteam%5D for unrestricted access.';
    const err = await fail(new GatewayInternalServerError({ message: msg, statusCode: 403 }));
    expect(err).toBeInstanceOf(FatalLabelerError);
    expect((err as Error).message).toBe(`provider rejected the request (403): ${msg}`);
  });

  it('keeps fatal messages on one line, at most ~300 characters, without key-shaped tokens', async () => {
    const long = `bad\nrequest vck_abcdefghijklmnop1234 ${'x'.repeat(500)}`;
    const err = await fail(new GatewayAuthenticationError({ message: long, statusCode: 401 }));
    const m = (err as Error).message;
    expect(m).not.toContain('\n');
    expect(m).not.toContain('vck_abcdefghijklmnop1234');
    expect(m.length).toBeLessThan(360);
  });

  it('maps a 409 to OverloadedError (retryable)', async () => {
    expect(await fail(api(409, 'conflict'))).toBeInstanceOf(OverloadedError);
  });

  it.each([
    ['413', api(413, 'Payload too large')],
    ['400 context length', new GatewayInvalidRequestError({ message: 'context length exceeded', statusCode: 400 })],
    ['422 input too long', api(422, 'input is too long for this model')],
  ])('leaves an article-caused %s as a plain per-article failure', async (_n, e) => {
    const err = await fail(e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(FatalLabelerError);
    expect(err).not.toBeInstanceOf(RateLimitError);
    expect(err).not.toBeInstanceOf(OverloadedError);
  });

  it('maps a 429 (gateway or API) to RateLimitError', async () => {
    expect(await fail(new GatewayRateLimitError({ statusCode: 429 }))).toBeInstanceOf(RateLimitError);
    expect(await fail(api(429, 'overloaded: slow down'))).toBeInstanceOf(RateLimitError);
  });

  it.each([
    ['gateway 500', new GatewayInternalServerError({ statusCode: 500 })],
    ['gateway 503', new GatewayInternalServerError({ message: 'unavailable', statusCode: 503 })],
    ['APICallError 502', api(502)],
    ['APICallError 529', api(529, 'Overloaded')],
    ['overloaded text', api(200, 'model is overloaded')],
  ])('maps %s to OverloadedError for the bounded retry', async (_n, e) => {
    const err = await fail(e);
    expect(err).toBeInstanceOf(OverloadedError);
    expect(err).not.toBeInstanceOf(FatalLabelerError);
  });

  it('maps through a RetryError that wraps the last failure', async () => {
    expect(await fail(wrap(new GatewayAuthenticationError({ statusCode: 401 })))).toBeInstanceOf(FatalLabelerError);
    expect(await fail(wrap(new GatewayRateLimitError({ statusCode: 429 })))).toBeInstanceOf(RateLimitError);
    expect(await fail(wrap(new GatewayInternalServerError({ statusCode: 500 })))).toBeInstanceOf(OverloadedError);
  });

  it('leaves a request timeout (408) and unknown errors as plain failures for that article', async () => {
    for (const e of [api(408, 'timeout'), new Error('socket hang up')]) {
      const err = await fail(e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(FatalLabelerError);
      expect(err).not.toBeInstanceOf(RateLimitError);
      expect(err).not.toBeInstanceOf(OverloadedError);
    }
  });
});
