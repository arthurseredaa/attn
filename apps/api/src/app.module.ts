import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { HealthModule } from './health/health.module';

@Module({ imports: [AppConfigModule, DbModule, HealthModule] })
export class AppModule {}
