import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { Me } from '@attn/shared';
import { CurrentUser } from './current-user';
import type { AuthUser } from './session';
import { SessionGuard } from './session.guard';

@Controller('me')
export class MeController {
  @Get()
  @UseGuards(SessionGuard)
  me(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Me {
    res.setHeader('Cache-Control', 'no-store');
    return user;
  }
}
