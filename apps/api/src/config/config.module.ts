import { Global, Logger, Module } from '@nestjs/common';
import { loadConfig, loadQuizBanks, loadSources, loadTaxonomy } from '@attn/core';
import { APP_CONFIG, ENV, QUIZ, SOURCES, TAXONOMY } from '../tokens';
import { loadEnv } from './env';

function loadQuizBanksWithWarnings() {
  const banks = loadQuizBanks();
  const roles = new Set(loadTaxonomy().domains.flatMap((d) => d.skills.flatMap((s) => s.roles)));
  for (const role of roles) {
    if (!banks.has(role)) {
      new Logger('Onboarding').warn(`no quiz bank for role "${role}" (expected data/quiz/${role}.yml); its skills stay unassessed`);
    }
  }
  return banks;
}

@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    { provide: TAXONOMY, useFactory: () => loadTaxonomy() },
    { provide: SOURCES, useFactory: () => loadSources() },
    { provide: QUIZ, useFactory: () => loadQuizBanksWithWarnings() }, // role -> bank, validated at boot
  ],
  exports: [ENV, APP_CONFIG, TAXONOMY, SOURCES, QUIZ],
})
export class AppConfigModule {}
