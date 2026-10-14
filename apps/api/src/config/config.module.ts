import { Global, Module } from '@nestjs/common';
import { loadConfig, loadQuizBanks, loadSources, loadTaxonomy } from '@attn/core';
import { APP_CONFIG, ENV, QUIZ, SOURCES, TAXONOMY } from '../tokens';
import { loadEnv } from './env';

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    { provide: TAXONOMY, useFactory: () => loadTaxonomy() },
    { provide: SOURCES, useFactory: () => loadSources() },
    { provide: QUIZ, useFactory: () => loadQuizBanks() }, // role -> bank, validated at boot
  ],
  exports: [ENV, APP_CONFIG, TAXONOMY, SOURCES, QUIZ],
})
export class AppConfigModule {}
