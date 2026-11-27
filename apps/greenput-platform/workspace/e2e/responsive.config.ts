/**
 * Playwright config for the responsive contract (e2e/responsive/).
 *
 * Deliberately separate from e2e/playwright.config.ts: that one boots
 * apps/platform and runs the product journeys, while these tests stand their
 * own worker up in process and need no server, no database and no deploy — so
 * they can run on a pull request against the PR's own commit. Named
 * `responsive.config.ts` rather than `playwright.config.ts` so
 * @nx/playwright/plugin does not infer a second `e2e` target from it; the
 * target is declared explicitly in e2e/project.json.
 */
import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env['CI'];

export default defineConfig({
  testDir: './responsive',
  // Each spec sweeps ~32 widths across 9 routes, so give it room on a cold
  // CI runner; the work is layout, not network.
  timeout: isCI ? 180_000 : 120_000,
  expect: { timeout: 10_000 },
  // Keep Playwright's failure artefacts out of the repo root; `dist` is
  // already gitignored. (e2e/playwright.config.ts leaves this at its default
  // `test-results/`, which is why that path is now in .gitignore too.)
  outputDir: '../dist/.playwright/responsive/test-results',
  fullyParallel: true,
  workers: isCI ? 2 : undefined,
  retries: 0,
  forbidOnly: isCI,
  reporter: isCI
    ? [
        ['list'],
        [
          'html',
          {
            outputFolder: '../dist/.playwright/responsive/playwright-report',
            open: 'never',
          },
        ],
      ]
    : [['list']],
  use: {
    // No baseURL: every spec serves its own worker on an ephemeral port.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Same rasteriser on this machine and on the GitHub runner.
        // Hinting and subpixel offsets were the whole 320px snapshot gap.
        launchOptions: {
          args: [
            '--font-render-hinting=none',
            '--disable-font-subpixel-positioning',
          ],
        },
      },
    },
  ],
});
