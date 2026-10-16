import { BadRequestException } from '@nestjs/common';

/** Raised by the app itself for invalid input; the exceptions filter never relabels it as malformed JSON. */
export class AppValidationError extends BadRequestException {}

interface Parser<T> {
  safeParse(
    input: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } };
}

/** `where` names the input in messages about the input as a whole (no field path), e.g. a body that is `[]`. */
export function parseWith<T>(schema: Parser<T>, input: unknown, where: 'query' | 'body' | 'params'): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data;
  throw new AppValidationError(
    r.error.issues.map((i) => `${i.path.map(String).join('.') || where}: ${i.message}`).join('; '),
  );
}
