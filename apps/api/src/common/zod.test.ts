import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseWith } from './zod';

const schema = z.object({ n: z.coerce.number().int().min(1), nested: z.object({ a: z.string() }).optional() });

describe('parseWith', () => {
  it('returns parsed data', () => {
    expect(parseWith(schema, { n: '3' }, 'query')).toEqual({ n: 3 });
  });

  it('throws BadRequestException naming the field', () => {
    expect(() => parseWith(schema, { n: '0' }, 'query')).toThrow(BadRequestException);
    expect(() => parseWith(schema, { n: '0' }, 'query')).toThrow(/^n: /);
    expect(() => parseWith(schema, { n: 1, nested: {} }, 'body')).toThrow(/^nested\.a: /);
  });

  it('labels root-level issues with where the input came from', () => {
    expect(() => parseWith(schema, [], 'body')).toThrow(/^body: /);
    expect(() => parseWith(schema, 'x', 'body')).toThrow(/^body: /);
    expect(() => parseWith(schema, null, 'query')).toThrow(/^query: /);
  });
});
