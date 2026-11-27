import { describe, expect, it } from 'vitest';

import {
  GP_GENERIC_SHARE_IMAGE,
  GP_MARK_ASSET_SIZE,
  GP_SHARE_CARD_SIZE,
  SHARE_CARD_FACT_KEYS,
  brandAssetUrls,
  brandAssetVersion,
  normaliseBrandOrigin,
  shareCardFactsFor,
  tenantHostFor,
  type GpBrandAssetSource,
} from './brand-assets.js';
import { BRAND_ASSET_CASES } from './brand-assets.fixtures.js';

const REED: GpBrandAssetSource = {
  name: 'Reed HVAC',
  slug: 'reed-hvac',
  trade: 'hvac',
  city: 'Austin',
  state: 'TX',
  logo_url: null,
  custom_hostname: null,
  custom_domain_status: null,
};

describe('ShareCardFacts is a closed set', () => {
  it('has exactly the declared keys — and no phone among them', () => {
    // The card scene takes ShareCardFacts and nothing else, and the URL version
    // hashes every key listed here. So this assertion is what makes "the phone
    // number cannot reach the share card" a structural fact rather than a
    // convention: a phone field could not be drawn without appearing here, and
    // could not appear here without failing this test.
    const facts = shareCardFactsFor({ ...REED, logo_url: null });
    expect(Object.keys(facts).sort()).toEqual([...SHARE_CARD_FACT_KEYS]);
    expect(SHARE_CARD_FACT_KEYS).not.toContain('phone');
  });

  it('carries no phone number even when the workspace has one', () => {
    const facts = shareCardFactsFor({
      ...REED,
      // Not part of GpBrandAssetSource; passed anyway, the way a real D1 row
      // arrives — `SELECT *` style. It must be dropped, not carried.
      ...({ phone: '+15125550142' } as Record<string, unknown>),
    } as GpBrandAssetSource);
    expect(JSON.stringify(facts)).not.toContain('5125550142');
  });
});

describe('shareCardFactsFor', () => {
  it('reads the trade label through the one shared definition', () => {
    expect(shareCardFactsFor({ ...REED, trade: 'hvac' }).trade).toBe('HVAC');
    expect(shareCardFactsFor({ ...REED, trade: 'pest_control' }).trade).toBe(
      'Pest Control',
    );
  });

  it('joins city and state, and degrades rather than printing a comma', () => {
    expect(shareCardFactsFor(REED).area).toBe('Austin, TX');
    expect(shareCardFactsFor({ ...REED, state: '' }).area).toBe('Austin');
    expect(shareCardFactsFor({ ...REED, city: '', state: 'TX' }).area).toBe('');
    expect(shareCardFactsFor({ ...REED, city: null, state: null }).area).toBe(
      '',
    );
  });

  it('carries the uploaded logo through verbatim, or as an empty string', () => {
    expect(shareCardFactsFor(REED).logoUrl).toBe('');
    expect(
      shareCardFactsFor({ ...REED, logo_url: ' https://cdn.example/a.png ' })
        .logoUrl,
    ).toBe('https://cdn.example/a.png');
  });
});

describe('tenantHostFor', () => {
  it('prefers a live custom domain over the Greenput subdomain', () => {
    expect(tenantHostFor(REED)).toBe('reed-hvac.greenput.com');
    expect(
      tenantHostFor({
        ...REED,
        custom_hostname: 'reedhvac.com',
        custom_domain_status: 'active',
      }),
    ).toBe('reedhvac.com');
  });

  it('ignores a custom domain that is not active yet', () => {
    expect(
      tenantHostFor({
        ...REED,
        custom_hostname: 'reedhvac.com',
        custom_domain_status: 'pending',
      }),
    ).toBe('reed-hvac.greenput.com');
  });
});

describe('brandAssetVersion', () => {
  it('is eight lowercase hex characters', () => {
    expect(brandAssetVersion(shareCardFactsFor(REED))).toMatch(/^[0-9a-f]{8}$/);
  });

  it('moves when any drawn field moves', () => {
    const base = brandAssetVersion(shareCardFactsFor(REED));
    const variants: GpBrandAssetSource[] = [
      { ...REED, name: 'Reed Heating & Air' },
      { ...REED, trade: 'plumbing' },
      { ...REED, city: 'Dallas' },
      { ...REED, state: 'CA' },
      { ...REED, logo_url: 'https://cdn.example/logo.png' },
      {
        ...REED,
        custom_hostname: 'reedhvac.com',
        custom_domain_status: 'active',
      },
      // A different slug changes both the host line and the colourway.
      { ...REED, slug: 'reed-hvac-2' },
    ];
    for (const source of variants) {
      expect(
        brandAssetVersion(shareCardFactsFor(source)),
        JSON.stringify(source),
      ).not.toBe(base);
    }
  });

  it('does not move for a field the card never draws', () => {
    const base = brandAssetVersion(shareCardFactsFor(REED));
    expect(
      brandAssetVersion(
        shareCardFactsFor({
          ...REED,
          ...({ phone: '+15125550142', email: 'a@b.c', zip: '78701' } as Record<
            string,
            unknown
          >),
        } as GpBrandAssetSource),
      ),
    ).toBe(base);
  });

  it('is insensitive to key order and cannot be confused by field boundaries', () => {
    const a = shareCardFactsFor({ ...REED, name: 'ab', trade: 'c' });
    const b = shareCardFactsFor({ ...REED, name: 'a', trade: 'bc' });
    expect(brandAssetVersion(a)).not.toBe(brandAssetVersion(b));

    const facts = shareCardFactsFor(REED);
    const shuffled = Object.fromEntries(
      Object.entries(facts).reverse(),
    ) as typeof facts;
    expect(brandAssetVersion(shuffled)).toBe(brandAssetVersion(facts));
  });
});

describe('normaliseBrandOrigin', () => {
  it.each([
    ['https://brand.greenput.com', 'https://brand.greenput.com'],
    ['https://brand.greenput.com/', 'https://brand.greenput.com'],
    ['https://brand.greenput.com/anything', 'https://brand.greenput.com'],
    ['  https://brand.greenput.com  ', 'https://brand.greenput.com'],
    ['http://localhost:8787', 'http://localhost:8787'],
    ['', ''],
    ['   ', ''],
    ['api.greenput.com', ''],
    ['//api.greenput.com', ''],
    ['javascript:alert(1)', ''],
    ['data:text/html,x', ''],
  ])('%j → %j', (input, expected) => {
    expect(normaliseBrandOrigin(input)).toBe(expected);
  });

  it('treats null and undefined as unset', () => {
    expect(normaliseBrandOrigin(null)).toBe('');
    expect(normaliseBrandOrigin(undefined)).toBe('');
  });
});

describe('brandAssetUrls', () => {
  it('builds both absolute URLs under one version', () => {
    const urls = brandAssetUrls('https://brand.greenput.com', REED);
    expect(urls).not.toBeNull();
    const version = brandAssetVersion(shareCardFactsFor(REED));
    expect(urls?.version).toBe(version);
    expect(urls?.cardUrl).toBe(
      `https://brand.greenput.com/reed-hvac/${version}/card.png`,
    );
    expect(urls?.markUrl).toBe(
      `https://brand.greenput.com/reed-hvac/${version}/mark.png`,
    );
  });

  it('answers null when there is nothing addressable', () => {
    expect(brandAssetUrls('', REED)).toBeNull();
    expect(brandAssetUrls(undefined, REED)).toBeNull();
    expect(brandAssetUrls('not a url', REED)).toBeNull();
    // Five rows in `greenput` carry slug NULL; they have no route to key on.
    expect(
      brandAssetUrls('https://brand.greenput.com', { ...REED, slug: null }),
    ).toBeNull();
    expect(
      brandAssetUrls('https://brand.greenput.com', { ...REED, slug: '' }),
    ).toBeNull();
  });

  it('percent-encodes the slug even though allocation cannot produce one that needs it', () => {
    const urls = brandAssetUrls('https://brand.greenput.com', {
      ...REED,
      slug: '../../etc/passwd',
    });
    expect(urls?.cardUrl).toContain('%2F');
    expect(urls?.cardUrl).not.toContain('/../');
    expect(new URL(urls?.cardUrl ?? '').pathname).toBe(
      `/..%2F..%2Fetc%2Fpasswd/${brandAssetVersion(
        shareCardFactsFor({ ...REED, slug: '../../etc/passwd' }),
      )}/card.png`,
    );
  });

  it('changes URL on a rename and keeps it on an unrelated edit', () => {
    const before = brandAssetUrls('https://brand.greenput.com', REED);
    const renamed = brandAssetUrls('https://brand.greenput.com', {
      ...REED,
      name: 'Reed Heating & Air',
    });
    expect(renamed?.cardUrl).not.toBe(before?.cardUrl);

    const samePhone = brandAssetUrls('https://brand.greenput.com', {
      ...REED,
      ...({ phone: '+15125550142' } as Record<string, unknown>),
    } as GpBrandAssetSource);
    expect(samePhone?.cardUrl).toBe(before?.cardUrl);
  });
});

describe('sizes and the last-resort image', () => {
  it('is 1200x630 for the card and 512 square for the mark', () => {
    expect(GP_SHARE_CARD_SIZE).toEqual({ width: 1200, height: 630 });
    expect(GP_MARK_ASSET_SIZE).toEqual({ width: 512, height: 512 });
    // 1.91:1 — what Facebook documents and what X needs for
    // summary_large_image.
    const ratio = GP_SHARE_CARD_SIZE.width / GP_SHARE_CARD_SIZE.height;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2);
  });

  it('keeps the generic Greenput card as the last resort', () => {
    expect(GP_GENERIC_SHARE_IMAGE).toBe(
      'https://app.greenput.com/og-image.png',
    );
  });
});

describe('the shared fixture table', () => {
  it('is what both the micro-site and the API are driven from', () => {
    // BRAND_ASSET_CASES is imported by apps/tenant-site/src/render.spec.ts (the
    // producer of the og:image URL) and apps/brand-assets/src/routes/brand.spec.ts (the
    // consumer that answers it). Neither owns the table, so neither can be
    // green against a shape the other does not produce.
    expect(BRAND_ASSET_CASES.length).toBeGreaterThanOrEqual(6);
    for (const testCase of BRAND_ASSET_CASES) {
      const urls = brandAssetUrls(
        'https://brand.greenput.com',
        testCase.workspace,
      );
      if (testCase.addressable) {
        expect(urls, testCase.label).not.toBeNull();
        expect(urls?.version).toBe(testCase.version);
      } else {
        expect(urls, testCase.label).toBeNull();
      }
    }
  });

  it('pins each case to a literal version token', () => {
    // Written out, not computed: if the hash or the facts change shape, every
    // already-crawled card URL in the wild changes with it, and that has to be
    // a deliberate edit to this list rather than a silently passing test.
    const pinned = BRAND_ASSET_CASES.filter((c) => c.addressable).map(
      (c) => `${c.label}=${c.version}`,
    );
    expect(pinned).toMatchInlineSnapshot(`
      [
        "plain tenant=89f477a2",
        "renamed tenant=223f0ff5",
        "uploaded logo=89947986",
        "live custom domain=b0631dec",
        "emoji name=d64baffd",
        "very long name=7f2c046f",
        "rtl name=6d154864",
        "html metacharacters=7f343946",
        "no city or state=6a73af18",
      ]
    `);
  });
});
