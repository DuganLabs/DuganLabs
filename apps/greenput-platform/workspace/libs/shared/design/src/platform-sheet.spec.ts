import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GP_BRAND_LEAF } from './tokens.js';
import { GP_PLATFORM_ACCENT_CSS } from './platform.js';
import {
  PLATFORM_COMPONENTS_CSS,
  PLATFORM_TOKENS_CSS,
} from './platform-sheet.js';

const require = createRequire(import.meta.url);

describe('embedded platform sheet', () => {
  it('matches the installed @basenative/platform stylesheets', () => {
    expect(PLATFORM_TOKENS_CSS).toBe(
      readFileSync(require.resolve('@basenative/platform/tokens.css'), 'utf8'),
    );
    expect(PLATFORM_COMPONENTS_CSS).toBe(
      readFileSync(
        require.resolve('@basenative/platform/components.css'),
        'utf8',
      ),
    );
  });

  it('writes the GreenPut leaf onto the accent token', () => {
    expect(GP_PLATFORM_ACCENT_CSS).toContain(
      `--bn-plat-color-accent: ${GP_BRAND_LEAF} !important;`,
    );
    expect(GP_PLATFORM_ACCENT_CSS).toContain('prefers-color-scheme: dark');
    expect(GP_PLATFORM_ACCENT_CSS).toContain('prefers-contrast: more');
    expect(GP_PLATFORM_ACCENT_CSS).toContain(
      'background: var(--gp-button-fill)',
    );
    expect(GP_PLATFORM_ACCENT_CSS).toContain('color: var(--gp-button-fg)');
    expect(GP_PLATFORM_ACCENT_CSS).toContain(
      'background: var(--gp-button-fill-hover)',
    );
  });
});
