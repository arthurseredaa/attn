import { Controller, Get, Inject, Query } from '@nestjs/common';
import { articlesQuerySchema, type ArticlesPage } from '@attn/shared';
import { AppValidationError, parseWith } from '../common/zod';
import { InvalidCursorError } from './cursor';
import { ArticlesService } from './articles.service';

@Controller('articles')
export class ArticlesController {
  constructor(@Inject(ArticlesService) private readonly articles: ArticlesService) {}

  @Get()
  async list(@Query() raw: Record<string, unknown>): Promise<ArticlesPage> {
    const query = parseWith(articlesQuerySchema, raw, 'query');
    try {
      return await this.articles.list(query);
    } catch (e) {
      if (e instanceof InvalidCursorError) throw new AppValidationError('cursor: invalid cursor');
      throw e;
    }
  }
}
