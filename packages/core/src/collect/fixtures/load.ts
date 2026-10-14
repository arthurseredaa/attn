import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));

export function readFixture(name: string, base = 'http://fixture.test'): string {
  return readFileSync(join(dir, name), 'utf8').replaceAll('{{BASE}}', base);
}
