import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProfileModule } from '../profile/profile.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

@Module({
  imports: [AuthModule, ProfileModule],
  controllers: [OnboardingController],
  providers: [OnboardingService],
})
export class OnboardingModule {}
