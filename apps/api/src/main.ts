import 'reflect-metadata';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { describeInsecureCookies, loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const envFile = path.resolve(import.meta.dirname, '../../../.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const env = loadEnv();
  const warning = describeInsecureCookies(env);
  if (warning) new Logger('Bootstrap').warn(warning);
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(env.port);
}

void bootstrap();
