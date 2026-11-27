import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // ESM directory (`package.json` declares `type: module`), so no `__dirname`.
    root: import.meta.dirname,
    include: ['src/**/*.spec.ts'],
    alias: {
      // "Open on this date" has exactly one definition, in utils — the slot
      // generator reads it rather than re-deriving weekday-vs-exception here.
      '@greenput/shared/utils': resolve(
        import.meta.dirname,
        '../utils/src/index.ts',
      ),
      // The double-booking guard is tested over the real schema.
      '@greenput/shared/testing': resolve(
        import.meta.dirname,
        '../testing/src/index.ts',
      ),
    },
  },
});
