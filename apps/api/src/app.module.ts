import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';

@Module({ imports: [AppConfigModule, DbModule, HealthModule, JobsModule] })
export class AppModule {}
