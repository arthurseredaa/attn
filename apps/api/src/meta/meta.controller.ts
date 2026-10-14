import { Controller, Get, Inject } from '@nestjs/common';
import type { Source, SourceSummary, Taxonomy } from '@attn/shared';
import { SOURCES, TAXONOMY } from '../tokens';

@Controller()
export class MetaController {
  constructor(
    @Inject(SOURCES) private readonly sources: Source[],
    @Inject(TAXONOMY) private readonly taxonomy: Taxonomy,
  ) {}

  @Get('sources')
  listSources(): SourceSummary[] {
    return this.sources
      .map((s) => ({ id: s.id, name: s.name }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }

  @Get('taxonomy')
  getTaxonomy(): Taxonomy {
    return this.taxonomy;
  }
}
