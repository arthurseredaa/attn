import type { LabelOutput } from '@attn/shared';
import { articleHtml } from '../../extract/fixtures/html';
import { createFakeLabeler, type FakeLabeler } from '../../label';
import type { TestServer } from '../../test/server';

const ANSWERS: Record<string, LabelOutput> = {
  '/g1': {
    primary_skill: 'context-engineering',
    secondary_skills: ['cc-hooks', 'cc-plugins'],
    difficulty: 3,
    type: 'tutorial',
    quality: 3,
  },
  '/g2': { primary_skill: 'cc-subagents', secondary_skills: [], difficulty: 3, type: 'news', quality: 2 },
  '/g3': {
    primary_skill: 'cc-mcp-usage',
    secondary_skills: ['cc-hooks', 'cc-plugins'],
    difficulty: 1,
    type: 'release',
    quality: 3,
  },
};

/** /g1../g3 serve 400-word articles; /g4 is deliberately unrouted (404). */
export function registerScenarioRoutes(server: TestServer): void {
  for (const n of [1, 2, 3]) {
    server.setRoute(`/g${n}`, {
      headers: { 'Content-Type': 'text/html' },
      body: articleHtml(`Article ${n}`, 400),
    });
  }
}

/** Fake labeler answering by the URL path of the article it receives. */
export function scenarioLabeler(model = 'fake-model'): FakeLabeler {
  return createFakeLabeler((article) => {
    const answer = ANSWERS[new URL(article.url).pathname];
    if (!answer) throw new Error(`scenarioLabeler: no answer for ${article.url}`);
    return answer;
  }, model);
}
