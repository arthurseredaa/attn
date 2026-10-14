import { Body, Controller, HttpCode, Inject, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { articleIdParamSchema, eventBodySchema, type EventResponse } from '@attn/shared';
import { CurrentUser } from '../auth/current-user';
import type { AuthUser } from '../auth/session';
import { SessionGuard } from '../auth/session.guard';
import { parseWith } from '../common/zod';
import { EventsService } from './events.service';

@Controller('articles')
export class EventsController {
  constructor(@Inject(EventsService) private readonly events: EventsService) {}

  @Post(':id/events')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  record(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EventResponse> {
    res.setHeader('Cache-Control', 'no-store');
    const articleId = parseWith(articleIdParamSchema, id, 'query');
    const { kind } = parseWith(eventBodySchema, body, 'body');
    return this.events.record(user, articleId, kind);
  }
}
