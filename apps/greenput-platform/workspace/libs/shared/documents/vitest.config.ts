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
      // The invoice prints the workspace's generated mark when it has no
      // uploaded logo — the same SVG its micro-site nav and share card draw.
      '@greenput/shared/design': resolve(
        import.meta.dirname,
        '../design/src/index.ts',
      ),
      // design reaches utils for displayTrade; resolved the same way.
      '@greenput/shared/utils': resolve(
        import.meta.dirname,
        '../utils/src/index.ts',
      ),
    },
  },
});
