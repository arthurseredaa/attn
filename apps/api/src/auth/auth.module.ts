import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { MeController } from './me.controller';
import { SessionGuard } from './session.guard';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController, MeController],
  providers: [SessionService, SessionGuard],
  exports: [SessionService, SessionGuard],
})
export class AuthModule {}
