import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..');

export default defineConfig({
  resolve: {
    alias: {
      // mocks/data/*.fixtures.ts take their shapes from the canonical models
      // rather than re-declaring them, and some of them (notifications) need
      // the runtime value sets, not just the types.
      '@greenput/shared/models': resolve(
        repoRoot,
        'libs/shared/models/src/index.ts',
      ),
    },
  },
  test: {
    globals: true,
    include: ['contracts/consumer/**/*.spec.ts'],
  },
});
