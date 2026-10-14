import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseWith } from './zod';

const schema = z.object({ n: z.coerce.number().int().min(1), nested: z.object({ a: z.string() }).optional() });

describe('parseWith', () => {
  it('returns parsed data', () => {
    expect(parseWith(schema, { n: '3' })).toEqual({ n: 3 });
  });

  it('throws BadRequestException naming the field', () => {
    expect(() => parseWith(schema, { n: '0' })).toThrow(BadRequestException);
    expect(() => parseWith(schema, { n: '0' })).toThrow(/^n: /);
    expect(() => parseWith(schema, { n: 1, nested: {} })).toThrow(/nested\.a/);
  });
});
