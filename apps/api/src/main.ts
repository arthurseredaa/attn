import 'reflect-metadata';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const envFile = path.resolve(import.meta.dirname, '../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const env = loadEnv();
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(env.port);
}

void bootstrap();
