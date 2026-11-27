#!/usr/bin/env node
/**
 * Runner for scripts/screenshots/capture.ts.
 *
 * The capture harness imports apps/api's and apps/tenant-site's Worker
 * sources and `@greenput/shared/testing` directly, so it needs TypeScript and
 * the workspace path aliases. Vite's SSR module runner supplies both (it is
 * what vitest uses under the hood), which keeps the harness itself a normal
 * typed file that lint and tsc can see — this wrapper is the only untyped
 * part, and it does nothing but resolve aliases.
 *
 * TZ is pinned to the seed workspace's zone (Rivertown, TX) BEFORE anything
 * else loads: the seed converts its wall-clock job times through SQLite's
 * 'localtime'/'utc' modifiers, which read the process TZ, and the browser
 * context pins the same zone so the 08:00 job is the 08:00 slot on the
 * calendar — a UTC capture put a 9 AM job at 2 AM.
 *
 * Usage:
 *   NODE_OPTIONS=--max-old-space-size=4096 \
 *     pnpm exec vite build --config apps/platform/vite.config.ts
 *   node scripts/screenshots/capture.mjs
 */
import { createServer } from 'vite';
import { resolve } from 'node:path';

process.env.TZ = 'America/Chicago';

const root = resolve(import.meta.dirname, '..', '..');
const lib = (name) => resolve(root, `libs/shared/${name}/src/index.ts`);

/** Every `@greenput/shared/*` path the root tsconfig.json declares. */
const SHARED = [
  'design',
  'models',
  'validators',
  'utils',
  'testing',
  'notifications',
  'pricing',
  'scheduling',
  'documents',
];

const vite = await createServer({
  configFile: false,
  root,
  appType: 'custom',
  logLevel: 'warn',
  server: { middlewareMode: true, hmr: false },
  resolve: {
    alias: Object.fromEntries(
      SHARED.map((name) => [`@greenput/shared/${name}`, lib(name)]),
    ),
  },
});

try {
  await vite.ssrLoadModule('/scripts/screenshots/capture.ts');
} finally {
  await vite.close();
}
