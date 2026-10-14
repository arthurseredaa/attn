import type { Taxonomy } from '@attn/shared';
import { createAnthropicLabeler } from './anthropic';
import { FatalLabelerError } from './errors';
import { createGeminiLabeler } from './gemini';
import type { Labeler } from './types';

export type LabelProvider = 'anthropic' | 'google';
export type LabelApiKeyVar = 'ANTHROPIC_API_KEY' | 'GOOGLE_GENERATIVE_AI_API_KEY';

export interface LabelProviderInfo {
  provider: LabelProvider;
  /** The env variable holding this provider's key (the AI SDK default name). */
  apiKeyVar: LabelApiKeyVar;
}

const PROVIDERS: readonly (LabelProviderInfo & { prefix: string })[] = [
  { prefix: 'claude-', provider: 'anthropic', apiKeyVar: 'ANTHROPIC_API_KEY' },
  { prefix: 'gemini-', provider: 'google', apiKeyVar: 'GOOGLE_GENERATIVE_AI_API_KEY' },
];

export type LabelerEnv = Readonly<Partial<Record<string, string | undefined>>>;

/** The provider is chosen by the model id prefix: `claude-*` is Anthropic, `gemini-*` is Google. Anything else throws. */
export function labelProviderFor(model: string): LabelProviderInfo {
  const hit = PROVIDERS.find((p) => model.startsWith(p.prefix));
  if (!hit) {
    throw new FatalLabelerError(
      `unknown LABEL_MODEL provider for "${model}": use a claude-* (Anthropic) or gemini-* (Google) model id`,
    );
  }
  return { provider: hit.provider, apiKeyVar: hit.apiKeyVar };
}

/** Why a labeler for `model` cannot be built from `env` (unknown provider, or its key unset or empty), or undefined. */
export function labelerConfigError(model: string, env: LabelerEnv): string | undefined {
  let info: LabelProviderInfo;
  try {
    info = labelProviderFor(model);
  } catch (e) {
    return (e as Error).message;
  }
  return env[info.apiKeyVar] ? undefined : `${info.apiKeyVar} is not set (needed for ${model})`;
}

export interface CreateLabelerOptions {
  model: string;
  taxonomy: Taxonomy;
  env: LabelerEnv;
  maxRetries?: number;
}

/** Builds the labeler for the provider named by the model prefix, or throws FatalLabelerError on a config error. */
export function createLabeler(opts: CreateLabelerOptions): Labeler {
  const problem = labelerConfigError(opts.model, opts.env);
  if (problem !== undefined) throw new FatalLabelerError(problem);
  const { provider, apiKeyVar } = labelProviderFor(opts.model);
  const common = {
    model: opts.model,
    taxonomy: opts.taxonomy,
    apiKey: opts.env[apiKeyVar],
    ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
  };
  return provider === 'anthropic' ? createAnthropicLabeler(common) : createGeminiLabeler(common);
}
