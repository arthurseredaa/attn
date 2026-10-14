import { Global, Module } from '@nestjs/common';
import { loadConfig, loadSources, loadTaxonomy } from '@attn/core';
import { APP_CONFIG, ENV, SOURCES, TAXONOMY } from '../tokens';
import { loadEnv } from './env';

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    { provide: TAXONOMY, useFactory: () => loadTaxonomy() },
    { provide: SOURCES, useFactory: () => loadSources() },
  ],
  exports: [ENV, APP_CONFIG, TAXONOMY, SOURCES],
})
export class AppConfigModule {}
