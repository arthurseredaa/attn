import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { goldenSchema, taxonomySkillIds, type GoldenItem, type Taxonomy } from '@attn/shared';
import { normalizeUrl } from '../collect/normalize';
import { dataDir, loadTaxonomy } from '../data';

export type GoldenEntry = GoldenItem & { file: string };

export function loadGolden(dir: string = dataDir(), taxonomy: Taxonomy = loadTaxonomy(dir)): GoldenEntry[] {
  const goldenDir = path.join(dir, 'golden');
  if (!fs.existsSync(goldenDir)) return [];
  const files = fs
    .readdirSync(goldenDir)
    .filter((f) => f.endsWith('.yml'))
    .sort();
  const skillIds = new Set(taxonomySkillIds(taxonomy));
  const seen = new Map<string, string>();
  const entries: GoldenEntry[] = [];

  for (const file of files) {
    const full = path.join(goldenDir, file);
    let raw: unknown;
    try {
      raw = parse(fs.readFileSync(full, 'utf8'));
    } catch (e) {
      throw new Error(`${full}: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
    const result = goldenSchema.safeParse(raw ?? []);
    if (!result.success) throw new Error(`${full}: ${result.error.message}`);

    for (const item of result.data) {
      for (const id of [item.primary_skill, ...item.secondary_skills]) {
        if (!skillIds.has(id)) throw new Error(`${full}: ${item.url}: unknown skill id "${id}"`);
      }
      const key = normalizeUrl(item.url) ?? item.url;
      const first = seen.get(key);
      if (first !== undefined) {
        throw new Error(`${full}: duplicate golden URL ${item.url} (also in ${path.join(goldenDir, first)})`);
      }
      seen.set(key, file);
      entries.push({ ...item, file });
    }
  }
  return entries;
}
