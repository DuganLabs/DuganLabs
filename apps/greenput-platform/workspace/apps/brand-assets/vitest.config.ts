import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: __dirname,
    include: ['src/**/*.spec.ts'],
    alias: {
      '@greenput/shared/design': resolve(
        __dirname,
        '../../libs/shared/design/src/index.ts',
      ),
      '@greenput/shared/utils': resolve(
        __dirname,
        '../../libs/shared/utils/src/index.ts',
      ),
    },
  },
});
