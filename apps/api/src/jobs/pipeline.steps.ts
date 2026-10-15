import {
  collectAll,
  createLabeler,
  labelPending,
  labelProvidersFor,
  type Db,
  type FetchFn,
  type LabelReport,
  type Labeler,
  type SourceReport,
} from '@attn/core';
import { Logger } from '@nestjs/common';
import type { Config, Source, Taxonomy } from '@attn/shared';
import type { Env } from '../config/env';

export type LabelStepResult = ({ status: 'done' } & LabelReport) | { status: 'skipped'; reason: string };

export interface PipelineSteps {
  collect(): Promise<SourceReport[]>;
  label(): Promise<LabelStepResult>;
}

export interface PipelineStepsDeps {
  db: Db;
  sources: Source[];
  config: Config;
  taxonomy: Taxonomy;
  labeler: Labeler | null;
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
}

export function createPipelineSteps(deps: PipelineStepsDeps): PipelineSteps {
  const logger = new Logger('label');
  const { db, sources, config, taxonomy, labeler, fetchFn, sleep } = deps;
  return {
    collect: () => collectAll({ db, sources, config, fetchFn }),
    async label() {
      if (!labeler) {
        return {
          status: 'skipped',
          reason: 'LABEL_MODEL or its provider key (ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY or JEV_API_KEY) is not set',
        };
      }
      return {
        status: 'done',
        ...(await labelPending({
          db,
          labeler,
          config,
          taxonomyVersion: taxonomy.version,
          fetchFn,
          sleep,
          log: (line) => logger.log(line),
        })),
      };
    },
  };
}

/**
 * The daily job's labeler: null (label step skipped) without LABEL_MODEL or without the key of the provider its
 * prefix names. An unknown prefix throws FatalLabelerError, so a mistyped LABEL_MODEL stops the API at startup.
 */
export function labelerFromEnv(
  env: Pick<Env, 'labelModel' | 'googleApiKey' | 'anthropicApiKey' | 'jevApiKey'>,
  taxonomy: Taxonomy,
  config?: Pick<Config, 'jev_secondary_threshold'>,
): Labeler | null {
  if (!env.labelModel) return null;
  const keys = {
    ANTHROPIC_API_KEY: env.anthropicApiKey,
    GOOGLE_GENERATIVE_AI_API_KEY: env.googleApiKey,
    JEV_API_KEY: env.jevApiKey,
  };
  if (labelProvidersFor(env.labelModel).some((p) => !keys[p.apiKeyVar])) return null;
  return createLabeler({
    model: env.labelModel,
    taxonomy,
    env: keys,
    ...(config ? { jevSecondaryThreshold: config.jev_secondary_threshold } : {}),
  });
}
