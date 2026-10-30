import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve('src/renderer'),
      '@shared': resolve('src/shared'),
      '@main': resolve('src/main'),
    },
  },
  test: {
    // A cached transform keeps the old import.meta.glob result, so a new migration wouldn't reach the tests.
    fsModuleCache: false,
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/main/**/*.test.ts', 'src/shared/**/*.test.ts', 'scripts/**/*.test.mjs'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['src/renderer/**/*.test.{ts,tsx}'],
          setupFiles: ['src/renderer/testSetup.ts'],
        },
      },
    ],
  },
});
