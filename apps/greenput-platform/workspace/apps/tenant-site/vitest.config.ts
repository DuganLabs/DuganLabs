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
      '@greenput/shared/models': resolve(
        __dirname,
        '../../libs/shared/models/src/index.ts',
      ),
      '@greenput/shared/utils': resolve(
        __dirname,
        '../../libs/shared/utils/src/index.ts',
      ),
      '@greenput/shared/testing': resolve(
        __dirname,
        '../../libs/shared/testing/src/index.ts',
      ),
      '@greenput/shared/scheduling': resolve(
        __dirname,
        '../../libs/shared/scheduling/src/index.ts',
      ),
      '@greenput/shared/pricing': resolve(
        __dirname,
        '../../libs/shared/pricing/src/index.ts',
      ),
      '@greenput/shared/documents': resolve(
        __dirname,
        '../../libs/shared/documents/src/index.ts',
      ),
      '@greenput/shared/consent': resolve(
        __dirname,
        '../../libs/shared/consent/src/index.ts',
      ),
    },
  },
});
