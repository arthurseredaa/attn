import { describe, it, expect } from 'vitest';
import { loadTaxonomy } from '../data';
import { createLabeler, labelerConfigError, labelProviderFor } from './factory';
import { FatalLabelerError } from './errors';

const taxonomy = loadTaxonomy();

describe('labelProviderFor', () => {
  it('picks Anthropic for claude-* and Google for gemini-*', () => {
    expect(labelProviderFor('claude-haiku-5-5')).toEqual({ provider: 'anthropic', apiKeyVar: 'ANTHROPIC_API_KEY' });
    expect(labelProviderFor('gemini-3.6-flash')).toEqual({ provider: 'google', apiKeyVar: 'GOOGLE_GENERATIVE_AI_API_KEY' });
  });

  it('throws a FatalLabelerError naming the model for an unknown prefix', () => {
    for (const model of ['gpt-5', 'fake-model', 'Claude-haiku-5-5', '']) {
      let err: unknown;
      try {
        labelProviderFor(model);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(FatalLabelerError);
      expect((err as Error).message).toContain('unknown LABEL_MODEL provider');
      expect((err as Error).message).toContain(`"${model}"`);
    }
  });
});

describe('labelerConfigError', () => {
  it('is undefined when the key for the chosen provider is set', () => {
    expect(labelerConfigError('claude-haiku-5-5', { ANTHROPIC_API_KEY: 'k' })).toBeUndefined();
    expect(labelerConfigError('gemini-3.6-flash', { GOOGLE_GENERATIVE_AI_API_KEY: 'k' })).toBeUndefined();
  });

  it('names ANTHROPIC_API_KEY for a Claude model, even when the Google key is set', () => {
    for (const env of [{}, { ANTHROPIC_API_KEY: '' }, { GOOGLE_GENERATIVE_AI_API_KEY: 'k' }]) {
      const msg = labelerConfigError('claude-haiku-5-5', env);
      expect(msg).toContain('ANTHROPIC_API_KEY is not set');
      expect(msg).not.toContain('GOOGLE');
    }
  });

  it('names GOOGLE_GENERATIVE_AI_API_KEY for a Gemini model, even when the Anthropic key is set', () => {
    const msg = labelerConfigError('gemini-3.6-flash', { ANTHROPIC_API_KEY: 'k' });
    expect(msg).toContain('GOOGLE_GENERATIVE_AI_API_KEY is not set');
    expect(msg).not.toContain('ANTHROPIC');
  });

  it('reports an unknown provider before any key', () => {
    expect(labelerConfigError('gpt-5', { ANTHROPIC_API_KEY: 'k', GOOGLE_GENERATIVE_AI_API_KEY: 'k' })).toContain(
      'unknown LABEL_MODEL provider',
    );
  });
});

describe('createLabeler', () => {
  it('builds a labeler for either provider with its own key and no network', () => {
    expect(createLabeler({ model: 'claude-haiku-5-5', taxonomy, env: { ANTHROPIC_API_KEY: 'dummy' } }).model).toBe(
      'claude-haiku-5-5',
    );
    expect(
      createLabeler({ model: 'gemini-3.6-flash', taxonomy, env: { GOOGLE_GENERATIVE_AI_API_KEY: 'dummy' } }).model,
    ).toBe('gemini-3.6-flash');
  });

  it('throws FatalLabelerError for an unknown provider or a missing key', () => {
    expect(() => createLabeler({ model: 'gpt-5', taxonomy, env: {} })).toThrow(FatalLabelerError);
    expect(() =>
      createLabeler({ model: 'claude-haiku-5-5', taxonomy, env: { GOOGLE_GENERATIVE_AI_API_KEY: 'k' } }),
    ).toThrow(/ANTHROPIC_API_KEY is not set/);
  });
});
