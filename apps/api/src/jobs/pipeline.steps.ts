import {
  collectAll,
  labelPending,
  type Db,
  type FetchFn,
  type LabelReport,
  type Labeler,
  type SourceReport,
} from '@attn/core';
import type { Config, Source, Taxonomy } from '@attn/shared';

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
  const { db, sources, config, taxonomy, labeler, fetchFn, sleep } = deps;
  return {
    collect: () => collectAll({ db, sources, config, fetchFn }),
    async label() {
      if (!labeler) {
        return {
          status: 'skipped',
          reason: 'LABEL_MODEL or GOOGLE_GENERATIVE_AI_API_KEY is not set',
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
        })),
      };
    },
  };
}
