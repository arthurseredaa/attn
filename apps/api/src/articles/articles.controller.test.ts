import { describe, expect, it } from 'vitest';
import { AppValidationError } from '../common/zod';
import { ArticlesController } from './articles.controller';
import type { ArticlesService } from './articles.service';
import { InvalidCursorError } from './cursor';

const controller = (list: ArticlesService['list']) => new ArticlesController({ list } as ArticlesService);

describe('ArticlesController', () => {
  it('maps an invalid cursor to an app validation error (never relabelled as malformed JSON)', async () => {
    const c = controller(() => Promise.reject(new InvalidCursorError('bad')));
    await expect(c.list({ cursor: 'x' })).rejects.toBeInstanceOf(AppValidationError);
    await expect(c.list({ cursor: 'x' })).rejects.toThrow('cursor: invalid cursor');
  });

  it('passes other errors through', async () => {
    const boom = new Error('db down');
    await expect(controller(() => Promise.reject(boom)).list({})).rejects.toBe(boom);
  });
});
