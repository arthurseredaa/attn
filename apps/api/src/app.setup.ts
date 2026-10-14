import type { INestApplication } from '@nestjs/common';

export const API_PREFIX = 'api';

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
}
