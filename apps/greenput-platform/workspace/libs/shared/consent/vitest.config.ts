import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: import.meta.dirname,
    include: ['src/**/*.spec.ts'],
    alias: {
      '@greenput/shared/testing': resolve(
        import.meta.dirname,
        '../testing/src/index.ts',
      ),
    },
  },
});
