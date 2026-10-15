import { Controller, Get, Inject, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { feedQuerySchema, type FeedPage } from '@attn/shared';
import { CurrentUser } from '../auth/current-user';
import type { AuthUser } from '../auth/session';
import { SessionGuard } from '../auth/session.guard';
import { parseWith } from '../common/zod';
import { FeedService } from './feed.service';

@Controller('feed')
export class FeedController {
  constructor(@Inject(FeedService) private readonly feed: FeedService) {}

  @Get()
  @UseGuards(SessionGuard)
  get(
    @CurrentUser() user: AuthUser,
    @Query() raw: Record<string, unknown>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FeedPage> {
    res.setHeader('Cache-Control', 'no-store');
    return this.feed.get(user, parseWith(feedQuerySchema, raw, 'query'));
  }
}
