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
      // brand-assets.ts in the design lib reads `displayTrade` from utils rather
      // than keeping a second copy of the trade labels — see the note there.
      '@greenput/shared/utils': resolve(
        __dirname,
        '../../libs/shared/utils/src/index.ts',
      ),
      '@greenput/shared/notifications': resolve(
        __dirname,
        '../../libs/shared/notifications/src/index.ts',
      ),
      '@greenput/shared/testing': resolve(
        __dirname,
        '../../libs/shared/testing/src/index.ts',
      ),
      '@greenput/shared/scheduling': resolve(
        __dirname,
        '../../libs/shared/scheduling/src/index.ts',
      ),
    },
  },
});
