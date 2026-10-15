import type { Taxonomy } from '@attn/shared';
import { createAnthropicLabeler } from './anthropic';
import { createComboLabeler, parseLabelModel } from './combo';
import { FatalLabelerError } from './errors';
import { createGeminiLabeler } from './gemini';
import { createJevLabeler } from './jev';
import type { Labeler } from './types';

export type LabelProvider = 'anthropic' | 'google' | 'typesafe';
export type LabelApiKeyVar = 'ANTHROPIC_API_KEY' | 'GOOGLE_GENERATIVE_AI_API_KEY' | 'JEV_API_KEY';

export interface LabelProviderInfo {
  provider: LabelProvider;
  /** The env variable holding this provider's key (the AI SDK default name). */
  apiKeyVar: LabelApiKeyVar;
}

const PROVIDERS: readonly (LabelProviderInfo & { prefix: string })[] = [
  { prefix: 'claude-', provider: 'anthropic', apiKeyVar: 'ANTHROPIC_API_KEY' },
  { prefix: 'gemini-', provider: 'google', apiKeyVar: 'GOOGLE_GENERATIVE_AI_API_KEY' },
  { prefix: 'typesafe-ai/', provider: 'typesafe', apiKeyVar: 'JEV_API_KEY' },
];

export type LabelerEnv = Readonly<Partial<Record<string, string | undefined>>>;

/** The provider is chosen by the model id prefix: `claude-*` is Anthropic, `gemini-*` is Google, `typesafe-ai/*` is TypeSafe AI via the Vercel AI Gateway. Anything else throws. */
export function labelProviderFor(model: string): LabelProviderInfo {
  if (model.includes('+')) {
    throw new FatalLabelerError(`"${model}" is a combo; use labelProvidersFor to resolve its parts`);
  }
  const hit = PROVIDERS.find((p) => model.startsWith(p.prefix));
  if (!hit) {
    throw new FatalLabelerError(
      `unknown LABEL_MODEL provider for "${model}": use a claude-* (Anthropic), gemini-* (Google) or typesafe-ai/* (TypeSafe AI via Vercel AI Gateway) model id`,
    );
  }
  return { provider: hit.provider, apiKeyVar: hit.apiKeyVar };
}

/** The provider of each part of `model` (`<main>` or `<main>+<secondary>`); throws FatalLabelerError on a bad combo or an unknown provider. */
export function labelProvidersFor(model: string): LabelProviderInfo[] {
  const { main, secondary } = parseLabelModel(model);
  return [main, ...(secondary !== undefined ? [secondary] : [])].map(labelProviderFor);
}

/** Why a labeler for `model` cannot be built from `env` (bad combo, unknown provider, or a key unset or empty), or undefined. */
export function labelerConfigError(model: string, env: LabelerEnv): string | undefined {
  try {
    const { main, secondary } = parseLabelModel(model);
    for (const part of secondary !== undefined ? [main, secondary] : [main]) {
      const { apiKeyVar } = labelProviderFor(part);
      if (!env[apiKeyVar]) return `${apiKeyVar} is not set (needed for ${part})`;
    }
  } catch (e) {
    return (e as Error).message;
  }
  return undefined;
}

export interface CreateLabelerOptions {
  model: string;
  taxonomy: Taxonomy;
  env: LabelerEnv;
  maxRetries?: number;
  /** `jev_secondary_threshold` from data/config.yml; used only by the typesafe-ai/* labeler. */
  jevSecondaryThreshold?: number;
  /** Receives one line per combo fallback (the secondary labeler failed); defaults to console.warn. */
  warn?: (line: string) => void;
}

/** Builds the labeler for the provider named by the model prefix (or the combo of two), or throws FatalLabelerError on a config error. */
export function createLabeler(opts: CreateLabelerOptions): Labeler {
  const problem = labelerConfigError(opts.model, opts.env);
  if (problem !== undefined) throw new FatalLabelerError(problem);
  const { main, secondary } = parseLabelModel(opts.model);
  if (secondary === undefined) return createSingleLabeler(main, opts);
  const warn = opts.warn ?? ((line: string) => console.warn(line));
  const { provider } = labelProviderFor(secondary);
  return createComboLabeler({
    model: opts.model,
    main: createSingleLabeler(main, opts),
    secondary: createSingleLabeler(secondary, opts),
    onSecondaryFallback: (reason) =>
      warn(`warning: secondary labeler ${secondary} (${provider}) failed, kept main's secondary skills: ${reason}`),
  });
}

function createSingleLabeler(model: string, opts: CreateLabelerOptions): Labeler {
  const { provider, apiKeyVar } = labelProviderFor(model);
  const common = {
    model,
    taxonomy: opts.taxonomy,
    apiKey: opts.env[apiKeyVar],
    ...(opts.maxRetries !== undefined ? { maxRetries: opts.maxRetries } : {}),
  };
  if (provider === 'anthropic') return createAnthropicLabeler(common);
  if (provider === 'google') return createGeminiLabeler(common);
  return createJevLabeler({
    ...common,
    ...(opts.jevSecondaryThreshold !== undefined ? { secondaryThreshold: opts.jevSecondaryThreshold } : {}),
  });
}
