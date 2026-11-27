import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // This directory is ESM (`package.json` declares `type: module`, so Node
    // can load the engine's .ts files for scripts/seed/pricing-fsms.mjs), so
    // the config has no `__dirname`.
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
