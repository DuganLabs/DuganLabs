import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: __dirname,
    include: ['src/**/*.spec.ts'],
    alias: {
      // brand-assets.ts reads `displayTrade` from utils rather than keeping a
      // second copy of the trade labels — see the note in that file.
      '@greenput/shared/utils': resolve(__dirname, '../utils/src/index.ts'),
    },
  },
});
