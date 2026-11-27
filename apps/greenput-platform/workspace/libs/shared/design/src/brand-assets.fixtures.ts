/**
 * The one table of brand-asset cases, imported by every side of this feature.
 *
 * `apps/tenant-site` PRODUCES the `og:image` URL; `apps/brand-assets` CONSUMES it. Each
 * has its own test suite, and each would be perfectly green against its own
 * private idea of what the URL looks like — which is how a repo ships a
 * producer and a consumer that never meet. So neither owns the cases:
 *
 *   - `libs/shared/design/src/brand-assets.spec.ts` pins every `version` to a
 *     literal, so the token cannot drift without a deliberate edit.
 *   - `apps/tenant-site/src/render.spec.ts` renders each workspace and asserts
 *     the `og:image` it emits is exactly the URL built from this table.
 *   - `apps/brand-assets/src/routes/brand.spec.ts` takes that same URL, routes it
 *     through the real router against a real workspace row, and asserts the
 *     response.
 *
 * Not shipped to either Worker: only `*.spec.ts` imports it, so it is
 * tree-shaken out of both bundles.
 */

import type { GpBrandAssetSource } from './brand-assets.js';

export interface BrandAssetCase {
  /** Stable label — appears in the pinned-version snapshot. */
  readonly label: string;
  readonly workspace: GpBrandAssetSource & { readonly name: string };
  /** `false` when there is nothing to address (no slug). */
  readonly addressable: boolean;
  /** The expected version token. `''` when not addressable. */
  readonly version: string;
}

const BASE = {
  trade: 'hvac',
  city: 'Austin',
  state: 'TX',
  logo_url: null,
  custom_hostname: null,
  custom_domain_status: null,
} as const;

export const BRAND_ASSET_CASES: readonly BrandAssetCase[] = [
  {
    label: 'plain tenant',
    workspace: { ...BASE, name: 'Reed HVAC', slug: 'reed-hvac' },
    addressable: true,
    version: '89f477a2',
  },
  {
    label: 'renamed tenant',
    // Same slug, new name: the card URL must move, the colourway must not.
    workspace: { ...BASE, name: 'Reed Heating & Air', slug: 'reed-hvac' },
    addressable: true,
    version: '223f0ff5',
  },
  {
    label: 'uploaded logo',
    workspace: {
      ...BASE,
      name: 'Reed HVAC',
      slug: 'reed-hvac',
      logo_url: 'https://cdn.example/reed-hvac/logo.png',
    },
    addressable: true,
    version: '89947986',
  },
  {
    label: 'live custom domain',
    workspace: {
      ...BASE,
      name: 'Reed HVAC',
      slug: 'reed-hvac',
      custom_hostname: 'reedhvac.com',
      custom_domain_status: 'active',
    },
    addressable: true,
    version: 'b0631dec',
  },
  {
    label: 'emoji name',
    workspace: { ...BASE, name: '🌿', slug: 'site-a1b2c3' },
    addressable: true,
    version: 'd64baffd',
  },
  {
    label: 'very long name',
    workspace: {
      ...BASE,
      name: `${'Ridgeline Mechanical Systems of Greater '.repeat(5)}Austin`,
      slug: 'ridgeline-mechanical',
    },
    addressable: true,
    version: '7f2c046f',
  },
  {
    label: 'rtl name',
    workspace: { ...BASE, name: 'שרברב טוב', slug: 'site-9a8b7c' },
    addressable: true,
    version: '6d154864',
  },
  {
    label: 'html metacharacters',
    workspace: {
      ...BASE,
      name: '"><script>alert(1)</script> & Co',
      slug: 'script-alert-1-co',
    },
    addressable: true,
    version: '7f343946',
  },
  {
    label: 'no city or state',
    workspace: {
      ...BASE,
      name: 'Voltage',
      slug: 'voltage',
      city: '',
      state: '',
    },
    addressable: true,
    version: '6a73af18',
  },
  {
    label: 'no slug',
    workspace: { ...BASE, name: 'Legacy Workspace', slug: null },
    addressable: false,
    version: '',
  },
];
