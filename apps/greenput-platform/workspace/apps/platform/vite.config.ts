import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');

export default defineConfig({
  root: __dirname,
  publicDir: resolve(__dirname, 'public'),
  resolve: {
    alias: {
      '@greenput/shared/design': resolve(
        repoRoot,
        'libs/shared/design/src/index.ts',
      ),
      '@greenput/shared/models': resolve(
        repoRoot,
        'libs/shared/models/src/index.ts',
      ),
      '@greenput/shared/validators': resolve(
        repoRoot,
        'libs/shared/validators/src/index.ts',
      ),
      // Recovery normalises the phone number client-side before it is sent,
      // so the field can reject a typo without spending one of the five
      // requests a minute authRateLimit allows. Same helper the Worker uses.
      '@greenput/shared/utils': resolve(
        repoRoot,
        'libs/shared/utils/src/index.ts',
      ),
      '@greenput/shared/testing': resolve(
        repoRoot,
        'libs/shared/testing/src/index.ts',
      ),
      '@greenput/shared/notifications': resolve(
        repoRoot,
        'libs/shared/notifications/src/index.ts',
      ),
      '@greenput/shared/pricing': resolve(
        repoRoot,
        'libs/shared/pricing/src/index.ts',
      ),
      '@greenput/shared/scheduling': resolve(
        repoRoot,
        'libs/shared/scheduling/src/index.ts',
      ),
      '@greenput/shared/consent': resolve(
        repoRoot,
        'libs/shared/consent/src/index.ts',
      ),
      '@greenput/shared/documents': resolve(
        repoRoot,
        'libs/shared/documents/src/index.ts',
      ),
      '@basenative/fetch': resolve(
        repoRoot,
        'libs/basenative/fetch/src/index.ts',
      ),
      '@basenative/auth-webauthn': resolve(
        repoRoot,
        'libs/basenative/auth-webauthn/src/index.ts',
      ),
    },
  },
  server: {
    port: 4200,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: resolve(repoRoot, 'dist/apps/platform'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
});
