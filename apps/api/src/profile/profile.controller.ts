import { Controller, Get, Inject, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { Profile } from '@attn/shared';
import { CurrentUser } from '../auth/current-user';
import type { AuthUser } from '../auth/session';
import { SessionGuard } from '../auth/session.guard';
import { ProfileService } from './profile.service';

@Controller('profile')
export class ProfileController {
  constructor(@Inject(ProfileService) private readonly profiles: ProfileService) {}

  @Get()
  @UseGuards(SessionGuard)
  get(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<Profile> {
    res.setHeader('Cache-Control', 'no-store');
    return this.profiles.get(user);
  }
}
