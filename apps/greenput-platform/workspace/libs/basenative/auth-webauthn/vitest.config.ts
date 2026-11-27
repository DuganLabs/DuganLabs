import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..', '..');

export default defineConfig({
  resolve: {
    alias: {
      '@basenative/fetch': resolve(
        repoRoot,
        'libs/basenative/fetch/src/index.ts',
      ),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    root: __dirname,
    include: ['src/**/*.spec.ts'],
  },
});
