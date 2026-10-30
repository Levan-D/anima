import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: '.dev/playwright',
  workers: 1,
  timeout: 120_000,
  reporter: 'list',
});
