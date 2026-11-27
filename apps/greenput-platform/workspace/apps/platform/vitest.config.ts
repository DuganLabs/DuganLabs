import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

const repoRoot = resolve(__dirname, '..', '..');

export default defineConfig({
  resolve: {
    alias: {
      '@greenput/shared/design': resolve(
        repoRoot,
        'libs/shared/design/src/index.ts',
      ),
      // Recovery normalises the phone number client-side before it is sent,
      // so the field can reject a typo without spending one of the five
      // requests a minute authRateLimit allows. Same helper the Worker uses.
      '@greenput/shared/utils': resolve(
        repoRoot,
        'libs/shared/utils/src/index.ts',
      ),
      // src/contract/reads-the-real-api.spec.ts drives the real Worker routers
      // from apps/api over a real SQLite database, so the platform's own
      // renderers are asserted against the API's own bytes rather than against
      // a fixture written to match the reader.
      '@greenput/shared/models': resolve(
        repoRoot,
        'libs/shared/models/src/index.ts',
      ),
      '@greenput/shared/validators': resolve(
        repoRoot,
        'libs/shared/validators/src/index.ts',
      ),
      '@greenput/shared/testing': resolve(
        repoRoot,
        'libs/shared/testing/src/index.ts',
      ),
      '@greenput/shared/scheduling': resolve(
        repoRoot,
        'libs/shared/scheduling/src/index.ts',
      ),
      // reads-the-real-api.spec.ts mounts the real leads router, whose
      // withdraw route calls withdrawLead in libs/shared/pricing (GP-105).
      '@greenput/shared/pricing': resolve(
        repoRoot,
        'libs/shared/pricing/src/index.ts',
      ),
      // apps/api/src/routes/jobs.ts renders the invoice through it (GP-008).
      '@greenput/shared/documents': resolve(
        repoRoot,
        'libs/shared/documents/src/index.ts',
      ),
      // The API's SMS paths send through it: the GP-110 chat fallback
      // (apps/api/src/lib/sms-fallback.ts), the consent guard ahead of
      // consumer texts, and schedule-aware delivery's notifications.
      '@greenput/shared/notifications': resolve(
        repoRoot,
        'libs/shared/notifications/src/index.ts',
      ),
      // The API's consent guard (apps/api/src/lib/consent-guard.ts)
      // checks the persisted grant record through it (migration 036).
      '@greenput/shared/consent': resolve(
        repoRoot,
        'libs/shared/consent/src/index.ts',
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
  // src/contract/reads-the-real-api.spec.ts runs the real Worker routers over
  // node:sqlite inside the happy-dom environment. Vitest resolves that
  // environment as a *client* one, where Vite refuses to bundle a Node
  // built-in; `external` hands node:sqlite back to Node's own resolver
  // instead. Without this the spec cannot even load.
  test: {
    globals: true,
    environment: 'happy-dom',
    root: __dirname,
    include: ['src/**/*.spec.ts'],
  },
});
