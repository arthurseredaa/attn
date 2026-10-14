import type { INestApplication } from '@nestjs/common';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

export const API_PREFIX = 'api';

export function configureApp(app: INestApplication): void {
  // Don't advertise the framework (only the express adapter has this setting).
  (app.getHttpAdapter().getInstance() as { disable?: (k: string) => void }).disable?.('x-powered-by');
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new AllExceptionsFilter());
}
