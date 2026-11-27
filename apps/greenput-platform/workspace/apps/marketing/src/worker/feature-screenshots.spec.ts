import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderMarketingPage } from './index.js';
import { featuresContext } from './page-data.js';

/**
 * /features shows real product screenshots, served as Workers static assets
 * from apps/marketing/assets/screens (wrangler.toml `[assets]`). Two ways
 * that goes wrong silently: a tile that points at a file the deploy does not
 * carry (a broken image on the marketing page), and a screenshot with no
 * alt. Both are pinned here; the pixels themselves come from
 * scripts/screenshots/capture.mjs.
 */
const ASSETS = resolve(__dirname, '..', '..', 'assets', 'screens');

/** The renderer's attribute escaping, so an apostrophe in an alt still matches. */
const escapeAttr = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const html = renderMarketingPage('features', 'testnonce');

describe('/features product screenshots', () => {
  it('renders one real image per feature, none of the old placeholder labels', () => {
    for (const feature of featuresContext.features) {
      expect(html).toContain(`src="/screens/${feature.id}.webp"`);
      expect(html).toContain(`alt="${escapeAttr(feature.screenshotAlt)}"`);
      expect(feature.screenshotAlt.length).toBeGreaterThan(20);
    }
    expect(html).not.toContain('screenshot-label');
    // The hero adds the customers and invoicing screens beside the one
    // image each feature row already carries.
    expect(html.match(/<img[^>]*\/screens\//g)).toHaveLength(
      featuresContext.features.length + 2,
    );
  });

  it('ships every screenshot it points at, as a real WebP of the tile’s 16:10 shape', () => {
    for (const feature of featuresContext.features) {
      const file = resolve(ASSETS, `${feature.id}.webp`);
      expect(statSync(file).size, feature.id).toBeGreaterThan(10_000);
      const head = readFileSync(file).subarray(0, 12).toString('latin1');
      expect(head.startsWith('RIFF'), feature.id).toBe(true);
      expect(head.slice(8, 12), feature.id).toBe('WEBP');
    }
    // The <img> declares 1600x1000 so the layout never shifts; the tile is
    // aspect-ratio 16 / 10, so a capture of any other shape would be cropped.
    expect(html).toContain('width="1600" height="1000"');
  });

  it('does not hide the pictures from assistive tech', () => {
    expect(html).not.toMatch(/data-bn="bn-figure"[^>]*aria-hidden/);
    expect(html).not.toMatch(/<img[^>]*\/screens\/[^>]*aria-hidden/);
  });
});
