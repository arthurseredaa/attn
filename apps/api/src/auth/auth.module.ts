import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { GithubClient } from './github.client';
import { MeController } from './me.controller';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';
import { UsersService } from './users.service';

@Module({
  controllers: [AuthController, MeController],
  providers: [SessionService, SessionGuard, GithubClient, UsersService],
  exports: [SessionService, SessionGuard],
})
export class AuthModule {}
