import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: __dirname,
    include: ['src/**/*.spec.ts'],
    alias: {
      // wire.spec.ts resolves the wire contract's columns against the real
      // schema.sql, through the same D1 surface the Workers use.
      '@greenput/shared/testing': resolve(__dirname, '../testing/src/index.ts'),
    },
  },
});
