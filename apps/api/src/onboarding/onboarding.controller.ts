import { Body, Controller, Get, HttpCode, Inject, Put, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { focusBodySchema, onboardingBodySchema, quizQuerySchema, type Profile, type QuizResponse } from '@attn/shared';
import { CurrentUser } from '../auth/current-user';
import type { AuthUser } from '../auth/session';
import { SessionGuard } from '../auth/session.guard';
import { parseWith } from '../common/zod';
import { OnboardingService } from './onboarding.service';

@Controller()
@UseGuards(SessionGuard)
export class OnboardingController {
  constructor(@Inject(OnboardingService) private readonly onboarding: OnboardingService) {}

  @Get('quiz')
  quiz(
    @CurrentUser() user: AuthUser,
    @Query() query: unknown,
    @Res({ passthrough: true }) res: Response,
  ): QuizResponse {
    const { skills } = parseWith(quizQuerySchema, query, 'query');
    res.setHeader('Cache-Control', 'no-store');
    return this.onboarding.quiz(user, skills);
  }

  @Post('onboarding')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<Profile> {
    return this.onboarding.submit(user, parseWith(onboardingBodySchema, body, 'body'));
  }

  @Put('focus')
  changeFocus(@CurrentUser() user: AuthUser, @Body() body: unknown): Promise<Profile> {
    return this.onboarding.changeFocus(user, parseWith(focusBodySchema, body, 'body'));
  }
}
