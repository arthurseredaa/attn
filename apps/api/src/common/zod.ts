import { BadRequestException } from '@nestjs/common';

interface Parser<T> {
  safeParse(input: unknown): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

export function parseWith<T>(schema: Parser<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  throw new BadRequestException(r.error.issues.map((i) => `${i.path.map(String).join('.') || 'query'}: ${i.message}`).join('; '));
}
