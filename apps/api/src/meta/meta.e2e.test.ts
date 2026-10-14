import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSources, loadTaxonomy } from '@attn/core';
import { sourcesResponseSchema, taxonomySchema } from '@attn/shared';
import { startTestApp, type TestApp } from '../test/app';

let ctx: TestApp;

beforeEach(async () => {
  ctx = await startTestApp();
});

afterEach(async () => {
  await ctx.close();
});

describe('GET /api/sources', () => {
  it('lists id and name of every source, sorted by name, without a cookie', async () => {
    const res = await fetch(`${ctx.base}/api/sources`);
    expect(res.status).toBe(200);
    const body = sourcesResponseSchema.parse(await res.json());
    expect(body).toHaveLength(loadSources().length);
    for (const s of body) expect(Object.keys(s).sort()).toEqual(['id', 'name']);
    const names = body.map((s) => s.name.toLowerCase());
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe('GET /api/taxonomy', () => {
  it('returns the whole taxonomy without a cookie', async () => {
    const res = await fetch(`${ctx.base}/api/taxonomy`);
    expect(res.status).toBe(200);
    const body = taxonomySchema.parse(await res.json());
    const expected = loadTaxonomy();
    expect(body.version).toBe(expected.version);
    const got = new Set(body.domains.flatMap((d) => d.skills.map((s) => s.id)));
    for (const d of expected.domains) for (const s of d.skills) expect(got.has(s.id)).toBe(true);
  });
});
