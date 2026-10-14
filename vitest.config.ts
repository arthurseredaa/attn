import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globalSetup: ['packages/core/src/test/global-setup.ts'],
    include: ['packages/*/src/**/*.test.ts'],
    fileParallelism: false,
  },
});
