import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

const baseURL = process.env['BASE_URL'] || 'http://localhost:4200';
const isCI = !!process.env['CI'];
const isRemote = !!process.env['BASE_URL'];
const useStaticServe = !!process.env['SERVE_STATIC'];

/**
 * The tenant micro-site, served locally by `wrangler dev`.
 *
 * The quote form is server-rendered POST-redirect-GET on the contractor's own
 * origin, so the only honest test of it is a browser against a real Worker
 * against a real D1 — a mocked fetch would test nothing that ships. The Worker
 * resolves a workspace from the SUBDOMAIN, so the browser has to arrive as
 * `demo.greenput.site`; Chromium's `--host-resolver-rules` points that name at
 * loopback for this run only, which needs neither /etc/hosts nor root.
 */
const TENANT_PORT = Number(process.env['TENANT_PORT'] ?? 8799);
const TENANT_HOST = 'demo.greenput.site';
const tenantURL = `https://${TENANT_HOST}:${TENANT_PORT}`;
const TENANT_SPEC = '**/quote-form.spec.ts';

export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),
  timeout: isCI ? 60000 : 30000,
  // Override reporter in CI for better console output
  ...(isCI
    ? {
        reporter: [
          ['list'],
          [
            'html',
            { outputFolder: '../dist/.playwright/e2e/playwright-report' },
          ],
        ],
      }
    : {}),
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    actionTimeout: isCI ? 15000 : 10000,
    // Bypass CSP on remote preview deployments so route mocking works
    bypassCSP: isRemote,
  },
  retries: isCI ? 2 : 1,
  // Remote deployments: no webServer (already running)
  // CI with build artifact: serve the static production build
  // Local dev: start the Angular dev server
  ...(isRemote
    ? {}
    : {
        webServer: [
          {
            command: useStaticServe
              ? 'node scripts/serve-static.mjs dist/apps/platform 4200'
              : 'pnpm exec nx run platform:serve',
            url: 'http://localhost:4200',
            reuseExistingServer: true,
            timeout: 60000,
            cwd: workspaceRoot,
          },
          {
            command: `bash scripts/e2e/tenant-dev.sh ${TENANT_PORT}`,
            // `port`, not `url`: the Worker answers 404 to any host it does
            // not own, and Playwright's `url` check will not accept a 404.
            // Waiting on the socket is the right readiness signal anyway.
            port: TENANT_PORT,
            reuseExistingServer: true,
            // Applying the schema and seeding five pricing machines takes a
            // few seconds longer than a static file server.
            timeout: 180000,
            cwd: workspaceRoot,
          },
        ],
      }),
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: TENANT_SPEC,
    },
    // Only when there is a local Worker to talk to: a remote BASE_URL run
    // points at a deployed platform, not at this.
    ...(isRemote
      ? []
      : [
          {
            name: 'tenant-site',
            testMatch: TENANT_SPEC,
            use: {
              ...devices['Desktop Chrome'],
              baseURL: tenantURL,
              // wrangler dev signs its own certificate; nothing else here
              // relaxes TLS.
              ignoreHTTPSErrors: true,
              launchOptions: {
                args: [`--host-resolver-rules=MAP ${TENANT_HOST} 127.0.0.1`],
              },
            },
          },
        ]),
  ],
});
