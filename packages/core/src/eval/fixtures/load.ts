import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function readEvalFixture(name: string, base: string): string {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), name);
  return fs.readFileSync(file, 'utf8').replaceAll('{{BASE}}', base);
}
