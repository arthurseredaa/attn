import { Module } from '@nestjs/common';
import { ArticlesModule } from './articles/articles.module';
import { AuthModule } from './auth/auth.module';
import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { MetaModule } from './meta/meta.module';
import { ProfileModule } from './profile/profile.module';

@Module({ imports: [AppConfigModule, DbModule, HealthModule, JobsModule, AuthModule, ArticlesModule, MetaModule, ProfileModule] })
export class AppModule {}
