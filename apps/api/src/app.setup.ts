import type { INestApplication } from '@nestjs/common';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

export const API_PREFIX = 'api';

export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new AllExceptionsFilter());
}
