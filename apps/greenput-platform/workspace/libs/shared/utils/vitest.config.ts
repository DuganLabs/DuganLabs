import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: __dirname,
    include: ['src/**/*.spec.ts'],
    alias: {
      // phone-recovery-key.spec.ts runs `toE164`'s output against the real
      // schema.sql, through the same D1 surface the Worker uses.
      '@greenput/shared/testing': resolve(__dirname, '../testing/src/index.ts'),
    },
  },
});
