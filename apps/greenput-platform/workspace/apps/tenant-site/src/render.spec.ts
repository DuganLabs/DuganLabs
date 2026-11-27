import { describe, expect, it } from 'vitest';
import {
  renderTenantPage,
  renderTenantErrorPage,
  renderTenantErrorShell,
  renderTenantShell,
  escapeHtml,
  isKnownTenantPath,
  displayTrade,
  tenantOriginFor,
  leadFormOutcomeFrom,
  LEAD_FORM_ERRORS,
  LEAD_FORM_SENT_MESSAGE,
  tenantStyles,
  type WorkspaceData,
} from './render.js';
import { type WeekdayHours } from '@greenput/shared/utils';
import {
  brandAssetUrls,
  generatedIdentityFor,
  shareCardFactsFor,
} from '@greenput/shared/design';
import { BRAND_ASSET_CASES } from '../../../libs/shared/design/src/brand-assets.fixtures';

const BRAND_ORIGIN = 'https://brand.greenput.com';

const WORKSPACE: WorkspaceData = {
  id: 'w1',
  name: 'Reed HVAC',
  slug: 'reed-hvac',
  trade: 'HVAC',
  // Stored form is E.164 (migrations/012). A pre-formatted fixture would
  // format to itself and hide a missing formatter.
  phone: '+15125550142',
  email: 'hello@reed-hvac.example',
  logo_url: 'https://cdn.example/reed-hvac/logo.png',
  street: '123 Main St',
  city: 'Denver',
  state: 'CO',
  zip: '80202',
};

describe('phone display (GP-041)', () => {
  const E164 = '+15125550142';
  const DISPLAY = '(512) 555-0142';
  const PAGES = ['/', '/services', '/about', '/contact'] as const;

  it.each(PAGES)('%s shows the formatted number as text', (path) => {
    const html = renderTenantPage(WORKSPACE, path, [], [], {
      brandOrigin: BRAND_ORIGIN,
    });
    expect(html).toContain(DISPLAY);
    // The raw E.164 never appears as visible text on any page.
    expect(html).not.toContain(`>${E164}<`);
    expect(html).not.toContain(`Call ${E164}`);
  });

  it('formats the nav, footer, hero and CTA text', () => {
    const html = renderTenantPage(WORKSPACE, '/', [], [], {
      brandOrigin: BRAND_ORIGIN,
    });
    expect(html).toContain(`aria-label="Call Reed HVAC on ${DISPLAY}"`);
    expect(html).toContain(`<span>${DISPLAY}</span>`);
    expect(html).toContain(`data-bn="footer-contact">${DISPLAY}</a>`);
    expect(html).toContain(`>Call ${DISPLAY}</a>`);
  });

  it('formats the "rather talk?" line on the contact page', () => {
    const html = renderTenantPage(WORKSPACE, '/contact', [], [], {
      brandOrigin: BRAND_ORIGIN,
    });
    expect(html).toContain(`<strong>Rather talk?</strong>${DISPLAY}</span>`);
  });

  it.each(PAGES)('%s keeps every tel: href on the E.164 value', (path) => {
    const html = renderTenantPage(WORKSPACE, path, [], [], {
      brandOrigin: BRAND_ORIGIN,
    });
    const hrefs = html.match(/href="tel:[^"]*"/g) ?? [];
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toBe(`href="tel:${E164}"`);
    }
  });

  it('keeps the JSON-LD telephone on the E.164 value', () => {
    const html = renderTenantPage(WORKSPACE, '/', [], [], {
      brandOrigin: BRAND_ORIGIN,
    });
    expect(html).toContain(`"telephone":"${E164}"`);
    expect(html).not.toContain(`"telephone":"${DISPLAY}"`);
  });

  it('formats the number in the shell used by the quote and error pages', () => {
    const html = renderTenantShell(WORKSPACE, {
      content: '<p>x</p>',
      title: 't',
      description: 'd',
    });
    expect(html).toContain(DISPLAY);
    expect(html).toContain(`href="tel:${E164}"`);
    expect(html).not.toContain(`>${E164}<`);
  });

  it('renders no phone at all for a workspace without one', () => {
    const silent: WorkspaceData = { ...WORKSPACE, phone: '' };
    for (const path of PAGES) {
      const html = renderTenantPage(silent, path, [], [], {
        brandOrigin: BRAND_ORIGIN,
      });
      expect(html).not.toContain('tel:');
      expect(html).not.toContain(DISPLAY);
      expect(html).not.toContain('Rather talk?');
    }
    const shell = renderTenantShell(silent, {
      content: '<p>x</p>',
      title: 't',
      description: 'd',
    });
    expect(shell).not.toContain('tel:');
  });

  it('leaves a non-NANP number as stored rather than mangling it', () => {
    const uk: WorkspaceData = { ...WORKSPACE, phone: '+442079460958' };
    const html = renderTenantPage(uk, '/', [], [], {
      brandOrigin: BRAND_ORIGIN,
    });
    expect(html).toContain('href="tel:+442079460958"');
    expect(html).toContain('>Call +442079460958</a>');
  });
});

describe('renderTenantPage SEO surface', () => {
  it('emits the canonical URL pointing at the tenant subdomain', () => {
    const html = renderTenantPage(WORKSPACE, '/', []);
    expect(html).toContain(
      '<link rel="canonical" href="https://reed-hvac.greenput.com">',
    );
  });

  it('updates the canonical URL per route', () => {
    const html = renderTenantPage(WORKSPACE, '/services', []);
    expect(html).toContain(
      '<link rel="canonical" href="https://reed-hvac.greenput.com/services">',
    );
  });

  it('includes Open Graph and Twitter Card tags on the home page', () => {
    const html = renderTenantPage(WORKSPACE, '/', [], [], {
      brandOrigin: BRAND_ORIGIN,
    });
    expect(html).toMatch(/<meta property="og:site_name" content="Reed HVAC">/);
    expect(html).toMatch(/<meta property="og:type" content="website">/);
    expect(html).toMatch(
      /<meta property="og:title" content="Reed HVAC — HVAC Services">/,
    );
    expect(html).toMatch(
      /<meta property="og:url" content="https:\/\/reed-hvac\.greenput\.com">/,
    );
    // `summary_large_image`, not `summary`: what this page advertises is a
    // 1200x630 card, not a logo. See the share-image chain below.
    expect(html).toMatch(
      /<meta name="twitter:card" content="summary_large_image">/,
    );
  });

  it('emits the canonical URL pointing at an active custom domain instead of the subdomain', () => {
    const withCustomDomain: WorkspaceData = {
      ...WORKSPACE,
      custom_hostname: 'www.reedhvac.com',
      custom_domain_status: 'active',
    };
    const html = renderTenantPage(withCustomDomain, '/', []);
    expect(html).toContain(
      '<link rel="canonical" href="https://www.reedhvac.com">',
    );
  });

  it('still canonicalizes to the subdomain while the custom domain is pending/verifying/failed', () => {
    for (const status of ['pending', 'verifying', 'failed'] as const) {
      const workspace: WorkspaceData = {
        ...WORKSPACE,
        custom_hostname: 'www.reedhvac.com',
        custom_domain_status: status,
      };
      const html = renderTenantPage(workspace, '/', []);
      expect(html).toContain(
        '<link rel="canonical" href="https://reed-hvac.greenput.com">',
      );
    }
  });

  it("advertises this tenant's own card as og:image, logo or not", () => {
    // Two tests used to live here: "includes the logo as og:image" and "omits
    // og:image when workspace has no logo". The second encoded the defect —
    // most workspaces have no logo, so most micro-sites were unshareable — and
    // the first pointed a 1200x630 social slot at a square logo. Both are
    // replaced by the card, which is the right shape and carries the business
    // name whether or not a logo was ever uploaded.
    const withLogo = renderTenantPage(WORKSPACE, '/', [], [], {
      brandOrigin: BRAND_ORIGIN,
    });
    const noLogo = renderTenantPage(
      { ...WORKSPACE, logo_url: null },
      '/',
      [],
      [],
      {
        brandOrigin: BRAND_ORIGIN,
      },
    );
    for (const html of [withLogo, noLogo]) {
      expect(html).toMatch(
        /<meta property="og:image" content="https:\/\/brand\.greenput\.com\/reed-hvac\/[0-9a-f]{8}\/card\.png">/,
      );
      expect(html).toContain(
        '<meta property="og:image:type" content="image/png">',
      );
      expect(html).toContain('<meta property="og:image:width" content="1200">');
      expect(html).toContain('<meta property="og:image:height" content="630">');
      expect(html).toContain(
        '<meta name="twitter:card" content="summary_large_image">',
      );
    }
    // And the two are different cards: the URL is versioned by content, and an
    // uploaded logo is part of the content.
    expect(withLogo).not.toBe(noLogo);
  });

  it('falls back to the uploaded logo, then to the Greenput card, with no API origin', () => {
    // Staging and preview have no api. hostname, so there is no card URL to
    // advertise. Something still has to go in og:image.
    const withLogo = renderTenantPage(WORKSPACE, '/', []);
    expect(withLogo).toContain(
      '<meta property="og:image" content="https://cdn.example/reed-hvac/logo.png">',
    );
    // A logo is square-ish; a large card would stretch it.
    expect(withLogo).toContain('<meta name="twitter:card" content="summary">');
    expect(withLogo).not.toContain('property="og:image:width"');

    const noLogo = renderTenantPage({ ...WORKSPACE, logo_url: null }, '/', []);
    expect(noLogo).toContain(
      '<meta property="og:image" content="https://app.greenput.com/og-image.png">',
    );
    expect(noLogo).toContain(
      '<meta name="twitter:card" content="summary_large_image">',
    );
  });

  it('falls back to the Greenput card when the workspace has no logo', () => {
    // This used to assert og:image was OMITTED, which is what shipped: a
    // workspace without a logo got no image tag at all, so every share of its
    // micro-site was a bare text stub. Most workspaces have no logo, the demo
    // tenant included. A Greenput-branded card is better than nothing and it is
    // honest — the site is a Greenput site.
    const noLogo = { ...WORKSPACE, logo_url: null };
    const html = renderTenantPage(noLogo, '/', []);
    expect(html).toContain(
      '<meta property="og:image" content="https://app.greenput.com/og-image.png">',
    );
    // 1200x630 earns the large card; a contractor's own logo does not.
    expect(html).toContain(
      '<meta name="twitter:card" content="summary_large_image">',
    );
  });

  it('keeps the small card for a contractor logo, which is not 1200x630', () => {
    const html = renderTenantPage(WORKSPACE, '/', []);
    expect(html).toContain('<meta name="twitter:card" content="summary">');
  });

  it('never puts the phone number in a share tag', () => {
    const html = renderTenantPage(WORKSPACE, '/', [], [], {
      brandOrigin: BRAND_ORIGIN,
    });
    const shareTags = html.match(
      /<meta (?:property="og:|name="twitter:)[^>]*>/g,
    );
    expect(shareTags?.length).toBeGreaterThan(5);
    for (const tag of shareTags ?? []) {
      expect(tag).not.toContain('555');
      expect(tag).not.toContain('555-0142');
    }
  });

  it('renders the JSON-LD payload as parsed JSON, not a raw {{ placeholder }}', () => {
    const html = renderTenantPage(WORKSPACE, '/', [
      { name: 'AC repair', count: 3 },
      { name: 'Furnace install', count: 1 },
    ]);
    expect(html).not.toContain('{{ structuredData }}');
    expect(html).not.toContain('<!--__STRUCTURED_DATA__-->');
    const match = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    );
    expect(match).not.toBeNull();
    const payload = match?.[1] ?? '{}';
    const data = JSON.parse(payload) as Record<string, unknown>;
    expect(data['@type']).toBe('LocalBusiness');
    expect(data.name).toBe('Reed HVAC');
    expect(data.url).toBe('https://reed-hvac.greenput.com');
    expect(data.logo).toBe('https://cdn.example/reed-hvac/logo.png');
    expect(data.address).toEqual({
      '@type': 'PostalAddress',
      streetAddress: '123 Main St',
      addressLocality: 'Denver',
      addressRegion: 'CO',
      postalCode: '80202',
      addressCountry: 'US',
    });
    expect(data.areaServed).toEqual({ '@type': 'City', name: 'Denver, CO' });
    expect(data.makesOffer).toBeDefined();
    const offers = data.makesOffer as Array<{
      itemOffered: { '@type': string; name: string; areaServed?: string };
    }>;
    expect(offers[0]?.itemOffered['@type']).toBe('Service');
    expect(offers[0]?.itemOffered.areaServed).toBe('Denver, CO');
  });

  it('omits address and areaServed when the workspace has not filled in its profile', () => {
    const noAddress = {
      ...WORKSPACE,
      street: '',
      city: '',
      state: '',
      zip: '',
    };
    const html = renderTenantPage(noAddress, '/', []);
    const match = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    );
    const data = JSON.parse(match?.[1] ?? '{}') as Record<string, unknown>;
    expect(data.address).toBeUndefined();
    expect(data.areaServed).toBeUndefined();
  });

  it('sizes the hero and about logo images to avoid layout shift', () => {
    const home = renderTenantPage(WORKSPACE, '/', []);
    expect(home).toContain(
      '<img src="https://cdn.example/reed-hvac/logo.png" alt="Reed HVAC logo" width="200" height="80" data-bn="hero-logo">',
    );
    const about = renderTenantPage(WORKSPACE, '/about', []);
    expect(about).toContain(
      '<img src="https://cdn.example/reed-hvac/logo.png" alt="Reed HVAC logo" width="200" height="120" data-bn="about-logo">',
    );
  });

  it('escapes workspace values exactly once (no pre-escaping + renderer escaping)', () => {
    const html = renderTenantPage(
      { ...WORKSPACE, name: 'Reed & Sons HVAC' },
      '/',
      [],
    );
    expect(html).toContain(
      '<title>Reed &amp; Sons HVAC — HVAC Services</title>',
    );
    expect(html).not.toContain('&amp;amp;');
  });

  it('inserts the rendered page body as markup, not escaped text', () => {
    const html = renderTenantPage(WORKSPACE, '/services', [
      { name: 'AC repair', count: 3 },
    ]);
    expect(html).toContain('<main id="main-content">');
    expect(html).toContain('data-bn="bn-card-grid"');
    expect(html).not.toContain('&lt;section');
    expect(html).not.toContain('&lt;ul data-bn=');
  });

  it('neutralises markup in service names', () => {
    const html = renderTenantPage(WORKSPACE, '/', [
      { name: '<script>alert(1)</script>', count: 1 },
    ]);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // The JSON-LD block is spliced in verbatim; "<" must be JSON-encoded so a
    // service name cannot close the <script> element early.
    const match = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    );
    const payload = match?.[1] ?? '';
    expect(payload).toContain('\\u003cscript');
    expect(payload).not.toContain('<script');
    const data = JSON.parse(payload) as {
      makesOffer: Array<{ itemOffered: { name: string } }>;
    };
    expect(data.makesOffer[0]?.itemOffered.name).toBe(
      '<script>alert(1)</script>',
    );
  });
});

describe('renderTenantPage 404 fallback', () => {
  it('renders the branded not-found section, not the home page, for an unknown path', () => {
    const html = renderTenantPage(WORKSPACE, '/nothing-here', []);
    expect(html).toContain('data-bn="not-found"');
    expect(html).not.toContain('data-bn="hero"');
  });

  it('omits canonical/og:url and adds noindex on the 404', () => {
    const html = renderTenantPage(WORKSPACE, '/nothing-here', []);
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('property="og:url"');
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow">/);
  });

  it('drops the JSON-LD block entirely on the 404', () => {
    const html = renderTenantPage(WORKSPACE, '/nothing-here', []);
    expect(html).not.toContain('application/ld+json');
  });

  it('sends a tenant with a published quote flow to /quote, not the stale contact CTA (GP-040)', () => {
    const flow = {
      slug: 'ev-charger-install',
      name: 'EV charger install',
      description: 'A Level 2 charger.',
      vertical: 'ev_charger',
    };
    const priced = renderTenantPage(WORKSPACE, '/nothing-here', [], [flow]);
    expect(priced).toContain('href="/"');
    expect(priced).toContain('data-bn="bn-button"');
    expect(priced).toContain('href="/quote"');
    expect(priced).toContain('>Get a price<');
    expect(priced).not.toContain('>Get a quote<');

    const unpriced = renderTenantPage(WORKSPACE, '/nothing-here', [], []);
    expect(unpriced).toContain('data-bn="bn-button"');
    expect(unpriced).toContain('href="/contact"');
    expect(unpriced).not.toContain('href="/quote"');
  });

  it('still resolves real routes normally alongside isKnownTenantPath', () => {
    expect(isKnownTenantPath('/services')).toBe(true);
    expect(isKnownTenantPath('/proposal')).toBe(true);
    expect(isKnownTenantPath('/invoice')).toBe(true);
    expect(isKnownTenantPath('/nothing-here')).toBe(false);
    expect(renderTenantPage(WORKSPACE, '/proposal', [], [])).toContain(
      'Open the proposal link',
    );
    expect(renderTenantPage(WORKSPACE, '/invoice', [], [])).toContain(
      'Open the invoice link',
    );
  });
});

describe('displayTrade', () => {
  it('title-cases a lowercase free-text trade', () => {
    expect(displayTrade('electrical')).toBe('Electrical');
  });

  it('maps known slugs to their proper label (HVAC, not Hvac)', () => {
    expect(displayTrade('hvac')).toBe('HVAC');
  });

  it('leaves already-cased input untouched', () => {
    expect(displayTrade('HVAC')).toBe('HVAC');
    expect(displayTrade("Reed's Plumbing Co")).toBe("Reed's Plumbing Co");
  });
});

describe('renderTenantErrorPage', () => {
  it('renders a real HTML document with a title and lang, not plain text', () => {
    const html = renderTenantErrorPage(
      'Workspace Not Found',
      "We couldn't find that.",
    );
    expect(html).toContain('<html lang="en" data-bn-platform="ios">');
    expect(html).toContain('<title>Workspace Not Found</title>');
    expect(html).toContain("We couldn't find that.");
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow">/);
  });

  it('escapes its inputs', () => {
    const html = renderTenantErrorPage('<script>x</script>', 'a & b');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('a &amp; b');
  });
});

// GP-040. The bare page is for the one error with no workspace — a host this
// Worker cannot resolve. Pin its shape: nobody adds a link to a page that has
// no site to link into.
describe('renderTenantErrorPage stays bare (GP-040)', () => {
  it('renders no links, no nav and no footer', () => {
    const html = renderTenantErrorPage('x', 'y');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('data-bn="bn-rail"');
    expect(html).not.toContain('data-bn="bn-site-footer"');
  });
});

describe('renderTenantErrorShell (GP-040)', () => {
  const html = renderTenantErrorShell(WORKSPACE, {
    title: 'Quote not found',
    message: 'This quote link is not valid any more.',
    actions: [
      { href: '/quote', label: 'Start a new quote' },
      { href: '/', label: 'Back to home' },
    ],
  });

  it("is still the contractor's site: nav, footer and the phone number", () => {
    expect(html).toContain('data-bn="bn-rail"');
    expect(html).toContain('data-bn="bn-site-footer"');
    expect(html).toContain('Reed HVAC');
    expect(html).toContain('href="tel:+15125550142"');
    expect(html).toContain('(512) 555-0142');
    expect(html).toContain('<title>Quote not found — Reed HVAC</title>');
  });

  it('renders every action as a link the caller named, first one primary', () => {
    expect(html).toContain(
      '<a data-bn="bn-button" data-variant="prominent" data-size="large" data-label="title" data-destructive="false" data-force="" href="/quote">Start a new quote</a>',
    );
    expect(html).toContain(
      '<a data-bn="bn-button" data-variant="bordered" data-size="large" data-label="title" data-destructive="false" data-force="" href="/">Back to home</a>',
    );
    expect(html).toContain('This quote link is not valid any more.');
    expect(html).toContain('data-bn="not-found"');
    expect(html).toContain('data-bn="bn-cluster"');
  });

  it('is never indexed and never advertises a canonical', () => {
    expect(html).toMatch(/<meta name="robots" content="noindex, nofollow">/);
    expect(html).not.toContain('rel="canonical"');
  });

  it('honours an explicit variant and escapes what it is given', () => {
    const out = renderTenantErrorShell(WORKSPACE, {
      title: '<b>x</b>',
      message: 'a & b',
      actions: [{ href: '/a?x="1"', label: '<i>go</i>', variant: 'ink' }],
    });
    expect(out).toContain('data-variant="ink"');
    expect(out).not.toContain('<b>x</b>');
    expect(out).not.toContain('<i>go</i>');
    expect(out).toContain('href="/a?x=&quot;1&quot;"');
    expect(out).toContain('a &amp; b');
  });
});

describe('tenantOriginFor', () => {
  it('defaults to the subdomain when no custom domain is set', () => {
    expect(tenantOriginFor(WORKSPACE)).toBe('https://reed-hvac.greenput.com');
  });

  it('uses the custom hostname once status is active', () => {
    expect(
      tenantOriginFor({
        ...WORKSPACE,
        custom_hostname: 'www.reedhvac.com',
        custom_domain_status: 'active',
      }),
    ).toBe('https://www.reedhvac.com');
  });

  it('ignores a custom hostname that is not yet active', () => {
    expect(
      tenantOriginFor({
        ...WORKSPACE,
        custom_hostname: 'www.reedhvac.com',
        custom_domain_status: 'pending',
      }),
    ).toBe('https://reed-hvac.greenput.com');
  });
});

describe('renderTenantShell', () => {
  it("wraps arbitrary content in the tenant's own header, nav and footer", () => {
    const html = renderTenantShell(WORKSPACE, {
      content: '<section data-bn="anything"><h1>Hello</h1></section>',
      title: 'A page',
      description: 'A description',
    });
    expect(html).toContain(
      '<section data-bn="anything"><h1>Hello</h1></section>',
    );
    expect(html).toContain('data-bn="bn-topbar"');
    expect(html).toContain('data-bn="bn-site-footer"');
    expect(html).toContain('<title>A page</title>');
    expect(html).toContain('content="A description"');
  });

  it('emits no LocalBusiness JSON-LD, and leaves no marker comment behind', () => {
    const html = renderTenantShell(WORKSPACE, {
      content: '<p>x</p>',
      title: 't',
      description: 'd',
    });
    expect(html).not.toContain('application/ld+json');
    expect(html).not.toContain('__STRUCTURED_DATA__');
  });

  it('omits the canonical link unless one is given', () => {
    const without = renderTenantShell(WORKSPACE, {
      content: '<p>x</p>',
      title: 't',
      description: 'd',
    });
    expect(without).not.toContain('rel="canonical"');

    const with_ = renderTenantShell(WORKSPACE, {
      content: '<p>x</p>',
      title: 't',
      description: 'd',
      canonicalUrl: 'https://reed-hvac.greenput.com/quote',
    });
    expect(with_).toContain(
      '<link rel="canonical" href="https://reed-hvac.greenput.com/quote">',
    );
  });

  it('noindexes on request', () => {
    expect(
      renderTenantShell(WORKSPACE, {
        content: '<p>x</p>',
        title: 't',
        description: 'd',
        noindex: true,
      }),
    ).toContain('name="robots" content="noindex, nofollow"');
  });

  it('marks the active nav item and no other', () => {
    const html = renderTenantShell(WORKSPACE, {
      content: '<p>x</p>',
      title: 't',
      description: 'd',
      activeNav: 'services',
    });
    expect(html).toMatch(/href="\/services"[^>]*data-bn-active/);
    expect(html).not.toMatch(/href="\/about"[^>]*data-bn-active/);
  });
});

describe('escapeHtml', () => {
  it('escapes the four characters that can break out of markup or an attribute', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;',
    );
  });
});

// ─────────────────────────────────────────────────────────────
// The funnel.
//
// The instant-price flow shipped and ran at /quote for weeks with nothing on
// the site linking to it: every "Get a quote" button on every page — the nav
// CTA included — pointed at /contact, the form whose own copy promises "a
// person, not a robot" and a written quote after a visit. The only people who
// ever saw the feature were the ones who typed the URL.
//
// The load-bearing assertion is the second one: with flows published, a link
// to /quote must exist on the marketing pages. It fails against every version
// of this file before 2026-09-12.
// ─────────────────────────────────────────────────────────────
describe('the instant-price funnel', () => {
  const FLOWS = [
    {
      slug: 'ev-charger-install',
      name: 'Level 2 EV charger install',
      description: 'Nine questions, about two minutes, and a real price.',
      vertical: 'ev_charger',
    },
    {
      slug: 'panel-service-upgrade',
      name: 'Panel replacement and service upgrade',
      description: 'Eight questions and an honest range.',
      vertical: 'panel_service',
    },
  ];

  const PAGES = ['/', '/services', '/contact', '/about'];

  it.each(PAGES)('links to /quote from %s when flows are published', (path) => {
    expect(renderTenantPage(WORKSPACE, path, [], FLOWS)).toContain(
      'href="/quote"',
    );
  });

  it.each(PAGES)('links nowhere near /quote from %s with none', (path) => {
    expect(renderTenantPage(WORKSPACE, path, [], [])).not.toContain(
      'href="/quote"',
    );
  });

  it("makes the nav's primary action the price, not the contact form", () => {
    const html = renderTenantPage(WORKSPACE, '/', [], FLOWS);
    expect(html).toContain(
      '<a href="/quote" data-bn="nav-cta-link">Get a price</a>',
    );
    // …and the contact page stays reachable as an ordinary nav item, rather
    // than being displaced by it.
    expect(html).toContain('href="/contact"');
  });

  it('keeps the old contact CTA for a tenant with nothing to price', () => {
    const html = renderTenantPage(WORKSPACE, '/', [], []);
    expect(html).toContain(
      '<a href="/contact" data-bn="nav-cta-link">Get a quote</a>',
    );
    expect(html).not.toContain('Get a price');
  });

  it('names what it can price on the home page', () => {
    const html = renderTenantPage(WORKSPACE, '/', [], FLOWS);
    expect(html).toContain('Level 2 EV charger install');
    expect(html).toContain('Panel replacement and service upgrade');
    expect(html).toContain(
      'Nine questions, about two minutes, and a real price.',
    );
  });

  it('offers the price above the contact form without removing the form', () => {
    const html = renderTenantPage(WORKSPACE, '/contact', [], FLOWS);
    expect(html).toContain('Want the price now?');
    expect(html).toContain('id="lead-form"');
    expect(html.indexOf('Want the price now?')).toBeLessThan(
      html.indexOf('id="lead-form"'),
    );
  });

  it('stops promising a call-back as the only way to get a number', () => {
    const html = renderTenantPage(WORKSPACE, '/', [], FLOWS);
    expect(html).toContain('A price in about two minutes');
    expect(html).not.toContain(
      'Free quotes · We reply within one business day',
    );
  });
});

// ─────────────────────────────────────────────────────────────
// GP-011 — nothing a contractor did not tell us is published in their name.
// WORKSPACE above has no licence number, which is exactly the case that used
// to print "Licensed & insured · Cover in place on every job", a fixed week
// of hours, 24/7 emergency cover and free estimates — none of it from data.
// ─────────────────────────────────────────────────────────────
describe('unbacked trust claims', () => {
  const PAGES = ['/', '/services', '/about', '/contact'];
  const LICENSED: WorkspaceData = { ...WORKSPACE, license_num: 'TX-12345' };
  // What GP-101's PUT /api/availability writes: every weekday once, closed
  // days with no times. Sunday is 0, as workspace_availability stores it.
  const WEEK: WeekdayHours[] = [
    { weekday: 0, isOpen: false },
    { weekday: 1, isOpen: true, opensAt: '07:00', closesAt: '18:00' },
    { weekday: 2, isOpen: true, opensAt: '07:00', closesAt: '18:00' },
    { weekday: 3, isOpen: true, opensAt: '07:00', closesAt: '18:00' },
    { weekday: 4, isOpen: true, opensAt: '07:00', closesAt: '18:00' },
    { weekday: 5, isOpen: true, opensAt: '07:00', closesAt: '18:00' },
    { weekday: 6, isOpen: true, opensAt: '08:00', closesAt: '14:00' },
  ];
  const jsonLd = (html: string): string =>
    [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)]
      .map((m) => m[1])
      .join('\n');

  it.each(PAGES)(
    'makes no licensing or insurance claim anywhere on %s for a workspace with no licence',
    (path) => {
      const html = renderTenantPage(WORKSPACE, path, []);
      // The whole document, JSON-LD included — "licence", "license",
      // "licensing", "insured", "insurance" and their spellings.
      expect(html).not.toMatch(/licen[cs]/i);
      expect(html).not.toMatch(/insur/i);
      expect(html).not.toContain('Cover in place on every job');
      expect(html).not.toContain('Covered work');
    },
  );

  it.each(PAGES)(
    'with a licence, says only what the number backs on %s',
    (path) => {
      const html = renderTenantPage(LICENSED, path, []);
      expect(html).toContain('TX-12345');
      expect(html).not.toMatch(/insur/i);
      expect(html).not.toContain('Licensed &amp; insured');
    },
  );

  it('puts the licence in the trust bar, the guarantee, the contact note, the footer and the FAQ', () => {
    expect(renderTenantPage(LICENSED, '/', [])).toContain(
      '<strong>Licensed</strong>\n          <span>Licence TX-12345</span>',
    );
    expect(renderTenantPage(LICENSED, '/services', [])).toContain(
      'Licence TX-12345. Ask to see the paperwork any time.',
    );
    expect(renderTenantPage(LICENSED, '/contact', [])).toContain(
      '<strong>Licence TX-12345</strong>',
    );
    const about = renderTenantPage(LICENSED, '/about', []);
    expect(about).toContain('License TX-12345');
    expect(about).toContain('<dt>Are you licensed?</dt>');
    expect(about).toContain('Yes — licence TX-12345.');
  });

  it.each([WORKSPACE, LICENSED])(
    'never promises 24/7 cover or free estimates on any page ($name, licence $license_num)',
    (workspace) => {
      for (const path of PAGES) {
        const html = renderTenantPage(workspace, path, [], [], {
          availability: WEEK,
        });
        expect(html, path).not.toContain('24/7');
        expect(html, path).not.toMatch(/emergency/i);
        expect(html, path).not.toMatch(
          /free[ ,-]+(no-obligation )?estimates?/i,
        );
        expect(html, path).not.toContain('Do you offer free estimates');
      }
    },
  );

  it.each(PAGES)(
    'publishes no hours block and no openingHours on %s when there are no availability rows',
    (path) => {
      for (const html of [
        renderTenantPage(WORKSPACE, path, []),
        renderTenantPage(WORKSPACE, path, [], [], { availability: [] }),
      ]) {
        expect(html).not.toContain('<section data-bn="hours"');
        expect(html).not.toContain('data-bn="hours-row"');
        expect(html).not.toContain('7:00 AM');
        expect(html).not.toContain('openingHours');
      }
    },
  );

  it('renders the week from availability rows, Monday first, closed days as Closed', () => {
    const html = renderTenantPage(WORKSPACE, '/about', [], [], {
      availability: WEEK,
    });
    expect(html).toContain('<section data-bn="hours"');
    const rows = [
      ...html.matchAll(
        /<div data-bn="hours-row"><dt>(.*?)<\/dt><dd>(.*?)<\/dd><\/div>/g,
      ),
    ].map((m) => [m[1], m[2]]);
    expect(rows).toEqual([
      ['Mon', '7:00 AM – 6:00 PM'],
      ['Tue', '7:00 AM – 6:00 PM'],
      ['Wed', '7:00 AM – 6:00 PM'],
      ['Thu', '7:00 AM – 6:00 PM'],
      ['Fri', '7:00 AM – 6:00 PM'],
      ['Sat', '8:00 AM – 2:00 PM'],
      ['Sun', 'Closed'],
    ]);
  });

  it('mirrors the open days into LocalBusiness openingHoursSpecification, and only those', () => {
    const html = renderTenantPage(WORKSPACE, '/', [], [], {
      availability: WEEK,
    });
    const ld = JSON.parse(jsonLd(html)) as {
      openingHoursSpecification: Array<Record<string, string>>;
    };
    expect(ld.openingHoursSpecification).toHaveLength(6);
    expect(ld.openingHoursSpecification[0]).toEqual({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: 'https://schema.org/Monday',
      opens: '07:00',
      closes: '18:00',
    });
    expect(ld.openingHoursSpecification[5]).toMatchObject({
      dayOfWeek: 'https://schema.org/Saturday',
      opens: '08:00',
      closes: '14:00',
    });
    expect(jsonLd(html)).not.toContain('Sunday');
  });

  it('shows the hours block but no openingHoursSpecification for a week with no open day', () => {
    const closed = WEEK.map((d) => ({ weekday: d.weekday, isOpen: false }));
    const html = renderTenantPage(WORKSPACE, '/about', [], [], {
      availability: closed,
    });
    expect(html).toContain('<section data-bn="hours"');
    expect(html).not.toContain('openingHours');
  });

  it('keeps the FAQPage JSON-LD identical to the visible FAQ, with or without a licence', () => {
    for (const workspace of [WORKSPACE, LICENSED]) {
      const html = renderTenantPage(workspace, '/about', []);
      const visible = [...html.matchAll(/<dt>(.*?)<\/dt>\s*<dd>(.*?)<\/dd>/g)]
        .filter((m) => !m[0].includes('data-bn="hours-row"'))
        .map((m) => [m[1], m[2]]);
      const faq = jsonLd(html)
        .split('\n')
        .map((block) => JSON.parse(block) as { '@type': string })
        .find((block) => block['@type'] === 'FAQPage') as {
        mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
      };
      expect(
        faq.mainEntity.map((q) => [q.name, q.acceptedAnswer.text]),
      ).toEqual(visible.map(([q, a]) => [decode(q), decode(a)]));
      expect(faq.mainEntity.map((q) => q.name)).not.toContain(
        'Do you carry insurance?',
      );
    }
  });

  const decode = (s: string): string =>
    s
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
});

describe('the generated mark on the page itself', () => {
  const noLogo: WorkspaceData = { ...WORKSPACE, logo_url: null };

  it('colours the nav and about monograms from the same identity as the card', () => {
    const identity = generatedIdentityFor(noLogo);
    const home = renderTenantPage(noLogo, '/', [], [], {
      brandOrigin: BRAND_ORIGIN,
    });
    const about = renderTenantPage(noLogo, '/about', [], [], {
      brandOrigin: BRAND_ORIGIN,
    });
    for (const html of [home, about]) {
      expect(html).toContain(
        `style="--gp-mark-bg:${identity.variant.bg};--gp-mark-fg:${identity.variant.fg};--gp-mark-accent:${identity.accent.bg};`,
      );
      // GP-109: the treatment and shape ride along as data attributes.
      expect(html).toContain(`data-bn-treatment="${identity.treatment}"`);
      expect(html).toContain(`data-bn-shape="${identity.shape}"`);
    }
    expect(about).toContain(`data-bn="about-monogram"`);
    // The custom properties are consumed, with the old ink tile as fallback.
    expect(home).toContain(
      'background:var(--gp-mark-bg,var(--gp-surface-ink))',
    );
  });

  it('shows the same letters as the mark the API draws', () => {
    const identity = generatedIdentityFor(noLogo);
    const html = renderTenantPage(noLogo, '/', [], [], {
      brandOrigin: BRAND_ORIGIN,
    });
    expect(identity.initials).toBe('RH');
    expect(html).toContain(`>${identity.initials}</span>`);
  });

  it('still prefers an uploaded logo in the nav', () => {
    const html = renderTenantPage(WORKSPACE, '/', [], [], {
      brandOrigin: BRAND_ORIGIN,
    });
    expect(html).toContain('<img src="https://cdn.example/reed-hvac/logo.png"');
    // The element, not the stylesheet rule of the same name.
    expect(html).not.toContain('<span data-bn="monogram"');
  });

  it('keeps the mark colour across a rename and moves the letters', () => {
    const before = generatedIdentityFor(noLogo);
    const renamed = renderTenantPage(
      { ...noLogo, name: 'Reed Heating & Air' },
      '/',
      [],
      { brandOrigin: BRAND_ORIGIN },
    );
    expect(renamed).toContain(`--gp-mark-bg:${before.variant.bg}`);
    expect(renamed).toContain('>RA</span>');
  });
});

describe('JSON-LD carries the brand assets', () => {
  function jsonLd(html: string): Record<string, unknown> {
    const match = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    );
    return JSON.parse(match?.[1] ?? '{}') as Record<string, unknown>;
  }

  it('gives a logo-less tenant a logo for the first time', () => {
    const noLogo: WorkspaceData = { ...WORKSPACE, logo_url: null };
    const urls = brandAssetUrls(BRAND_ORIGIN, noLogo);
    const data = jsonLd(
      renderTenantPage(noLogo, '/', [], [], { brandOrigin: BRAND_ORIGIN }),
    );
    expect(data.logo).toBe(urls?.markUrl);
    expect(data.image).toBe(urls?.cardUrl);
  });

  it('never displaces an uploaded logo', () => {
    const urls = brandAssetUrls(BRAND_ORIGIN, WORKSPACE);
    const data = jsonLd(
      renderTenantPage(WORKSPACE, '/', [], [], { brandOrigin: BRAND_ORIGIN }),
    );
    expect(data.logo).toBe('https://cdn.example/reed-hvac/logo.png');
    expect(data.image).toBe(urls?.cardUrl);
  });

  it('omits both when there is no API origin and no uploaded logo', () => {
    const data = jsonLd(
      renderTenantPage({ ...WORKSPACE, logo_url: null }, '/', []),
    );
    expect(data.logo).toBeUndefined();
    expect(data.image).toBeUndefined();
  });
});

describe('the og:image URL this page emits, for every shared case', () => {
  // The consumer half of this table is apps/api/src/routes/brand.spec.ts, which
  // takes the very same URLs and routes them through the real brand router. The
  // table lives in libs/shared/design so neither side owns it.
  it.each(BRAND_ASSET_CASES.map((c) => [c.label, c] as const))(
    '%s',
    (_label, testCase) => {
      const workspace: WorkspaceData = {
        id: 'w1',
        name: testCase.workspace.name,
        slug: String(testCase.workspace.slug ?? ''),
        trade: String(testCase.workspace.trade ?? ''),
        phone: '555-123-4567',
        email: 'hello@example.test',
        logo_url: testCase.workspace.logo_url ?? null,
        street: '1 Main St',
        city: String(testCase.workspace.city ?? ''),
        state: String(testCase.workspace.state ?? ''),
        zip: '78701',
        custom_hostname: testCase.workspace.custom_hostname ?? null,
        custom_domain_status: testCase.workspace.custom_domain_status ?? null,
      };
      const html = renderTenantPage(workspace, '/', [], [], {
        brandOrigin: BRAND_ORIGIN,
      });
      const emitted = html.match(
        /<meta property="og:image" content="([^"]+)">/,
      )?.[1];
      expect(emitted).toBeDefined();

      if (testCase.addressable) {
        const urls = brandAssetUrls(BRAND_ORIGIN, testCase.workspace);
        expect(emitted).toBe(urls?.cardUrl);
        expect(emitted).toContain(`/${testCase.version}/card.png`);
      } else {
        // No slug ⇒ nothing to address. The uploaded logo, else the generic card.
        expect(emitted).toBe(
          workspace.logo_url || 'https://app.greenput.com/og-image.png',
        );
      }

      // Whatever the name, the tag is a single well-formed meta element and the
      // URL survives a URL parse.
      expect(emitted).not.toContain('"');
      expect(emitted).not.toContain('<');
      expect(() => new URL(String(emitted))).not.toThrow();
    },
  );

  it('escapes a hostile business name everywhere it appears in the head', () => {
    const hostile: WorkspaceData = {
      ...WORKSPACE,
      name: '"><script>alert(1)</script>',
      logo_url: null,
    };
    const html = renderTenantPage(hostile, '/', [], [], {
      brandOrigin: BRAND_ORIGIN,
    });
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).not.toContain('<script>alert');
    expect(head).toContain('&lt;script&gt;');
    // og:image:alt carries the name; it must not break out of the attribute.
    const alt = head.match(/<meta property="og:image:alt" content="([^"]*)">/);
    expect(alt).not.toBeNull();
    expect(alt?.[1]).not.toContain('"');
    // The JSON-LD block still parses.
    const ld = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    );
    expect(() => JSON.parse(ld?.[1] ?? '{}')).not.toThrow();
  });

  it('advertises no card at all for a slugless workspace, rather than a broken URL', () => {
    const slugless: WorkspaceData = { ...WORKSPACE, slug: '', logo_url: null };
    expect(brandAssetUrls(BRAND_ORIGIN, slugless)).toBeNull();
    const html = renderTenantPage(slugless, '/', [], [], {
      brandOrigin: BRAND_ORIGIN,
    });
    expect(html).toContain(
      '<meta property="og:image" content="https://app.greenput.com/og-image.png">',
    );
    expect(html).not.toContain('brand.greenput.com');
  });

  it('refuses a junk BRAND_ORIGIN rather than emitting it', () => {
    for (const origin of ['javascript:alert(1)', 'api.greenput.com', '  ']) {
      const html = renderTenantPage(
        { ...WORKSPACE, logo_url: null },
        '/',
        [],
        [],
        {
          brandOrigin: origin,
        },
      );
      expect(html).toContain(
        '<meta property="og:image" content="https://app.greenput.com/og-image.png">',
      );
      expect(html).not.toContain('javascript:');
    }
  });

  it('keeps the facts and the version in step', () => {
    // Belt and braces on the producer side: the version in the emitted URL is
    // the hash of the facts derived from the same row.
    const html = renderTenantPage(WORKSPACE, '/', [], [], {
      brandOrigin: BRAND_ORIGIN,
    });
    const emitted = html.match(
      /<meta property="og:image" content="([^"]+)">/,
    )?.[1];
    const facts = shareCardFactsFor(WORKSPACE);
    expect(emitted).toBe(
      brandAssetUrls(BRAND_ORIGIN, WORKSPACE, facts)?.cardUrl,
    );
  });
});

// ─────────────────────────────────────────────────────────────
// GP-004 — the contact form is a real POST, and the page after the
// POST-redirect-GET renders the outcome from fixed copy, never from the URL.
// ─────────────────────────────────────────────────────────────
describe('the contact form without JavaScript (GP-004)', () => {
  it('posts to /leads on its own origin, so it submits with no script at all', () => {
    const html = renderTenantPage(WORKSPACE, '/contact', []);
    expect(html).toContain(
      '<form id="lead-form" data-bn="lead-form" method="post" action="/leads" novalidate>',
    );
  });

  it('keeps #form-message hidden and empty on a plain visit', () => {
    const html = renderTenantPage(WORKSPACE, '/contact', []);
    expect(html).toMatch(
      /<div id="form-message" data-bn="form-message" role="alert" aria-live="polite" hidden(="true")?><\/div>/,
    );
    expect(html).not.toContain('data-bn-status=');
    expect(html).not.toContain('aria-invalid');
  });

  it('renders the sent message when the redirect said so', () => {
    const html = renderTenantPage(WORKSPACE, '/contact', [], [], {
      leadForm: leadFormOutcomeFrom(new URLSearchParams('sent=1')),
    });
    expect(html).toContain(
      `<div id="form-message" data-bn="form-message" role="alert" aria-live="polite" data-bn-status="success">${LEAD_FORM_SENT_MESSAGE}</div>`,
    );
    expect(html).not.toMatch(/id="form-message"[^>]*hidden/);
  });

  it('renders the error and flags only the named field', () => {
    const html = renderTenantPage(WORKSPACE, '/contact', [], [], {
      leadForm: leadFormOutcomeFrom(
        new URLSearchParams('error=contact&field=email'),
      ),
    });
    expect(html).toContain('data-bn-status="error"');
    expect(html).toContain(LEAD_FORM_ERRORS.contact);
    expect(html.match(/aria-invalid="true"/g)).toHaveLength(1);
    expect(html).toMatch(/name="email"[^>]*aria-invalid="true"/);
  });

  describe('leadFormOutcomeFrom', () => {
    it('is null with nothing in the query', () => {
      expect(leadFormOutcomeFrom(new URLSearchParams(''))).toBeNull();
      expect(leadFormOutcomeFrom(new URLSearchParams('service=EV'))).toBeNull();
    });

    it('maps every known key to its fixed message', () => {
      for (const [key, message] of Object.entries(LEAD_FORM_ERRORS)) {
        expect(
          leadFormOutcomeFrom(new URLSearchParams({ error: key })),
        ).toEqual({ status: 'error', message, field: null });
      }
    });

    it('never echoes an unknown error or field from the URL', () => {
      const hostile = '<img src=x onerror=alert(1)>';
      const outcome = leadFormOutcomeFrom(
        new URLSearchParams({ error: hostile, field: hostile }),
      );
      expect(outcome).toEqual({
        status: 'error',
        message: LEAD_FORM_ERRORS.unknown,
        field: null,
      });
      const html = renderTenantPage(WORKSPACE, '/contact', [], [], {
        leadForm: outcome,
      });
      expect(html).not.toContain('onerror');
      expect(html).toContain(LEAD_FORM_ERRORS.unknown);
    });

    it('does not treat prototype members as messages', () => {
      expect(
        leadFormOutcomeFrom(
          new URLSearchParams({ error: 'toString', field: 'constructor' }),
        ),
      ).toEqual({
        status: 'error',
        message: LEAD_FORM_ERRORS.unknown,
        field: null,
      });
    });
  });
});

describe('the phone nav without JavaScript (GP-042)', () => {
  it('scrolls the banner and the toolbar, and leaves the capsule outside', () => {
    const demo = renderTenantShell(
      { ...WORKSPACE, slug: 'demo', logo_url: '' },
      {
        content: '<p>Hello</p>',
        title: 'Demo',
        description: 'A demo',
      },
    );
    const page = demo.indexOf('data-bn="bn-page"');
    const banner = demo.indexOf('data-bn="demo-banner"');
    const topbar = demo.indexOf('data-bn="bn-topbar"');
    const main = demo.indexOf('id="main-content"');
    const footer = demo.indexOf('data-bn="bn-site-footer"');
    const tabs = demo.indexOf('<nav data-bn="bn-tab-bar"');
    expect(page).toBeGreaterThan(-1);
    expect(page).toBeLessThan(banner);
    expect(banner).toBeLessThan(topbar);
    expect(topbar).toBeLessThan(main);
    expect(main).toBeLessThan(footer);
    expect(footer).toBeLessThan(tabs);

    const live = renderTenantPage(WORKSPACE, '/', []);
    expect(live).not.toContain('data-bn="demo-banner"');
    expect(live.indexOf('data-bn="bn-page"')).toBeLessThan(
      live.indexOf('data-bn="bn-topbar"'),
    );
    expect(live.indexOf('data-bn="bn-site-footer"')).toBeLessThan(
      live.indexOf('<nav data-bn="bn-tab-bar"'),
    );
  });

  it('centers the mark and shares the hero measure from the tenant sheet', () => {
    expect(tenantStyles).toContain('place-items: center');
    expect(tenantStyles).toContain('inline-size: var(--gp-mark-tile)');
    expect(tenantStyles).toContain(
      'p[data-bn="bn-cluster"] > [data-bn="bn-button"]',
    );
    expect(tenantStyles).toContain('flex: 1 1 var(--gp-cluster-min)');
    expect(tenantStyles).toContain('padding-block-end: 0');
  });

  it('keeps the rail and the floating tab bar in the document, with no drawer', () => {
    const html = renderTenantPage(WORKSPACE, '/', []);
    expect(html).toContain('data-bn="bn-rail"');
    expect(html).toContain('data-bn="bn-tab-bar" data-placement="floating"');
    expect(html).toContain('href="/services"');
    expect(html).not.toContain('nav-toggle');
  });

  it('hides the rail links below the wide breakpoint and leaves the brand', () => {
    expect(tenantStyles).toMatch(
      /\[data-bn="bn-rail"\] > a:not\(\[data-bn="bn-brand"\]\) \{\s*display:\s*none/,
    );
  });
});

describe('the Services page "Ask about this" link (GP-044)', () => {
  const ask = (name: string): string =>
    renderTenantPage(WORKSPACE, '/services', [{ name, count: 1 }], []);

  it('URL-encodes the service name, so an ampersand is not a query separator', () => {
    const html = ask('Outlet & Switch Installation');
    expect(html).toContain(
      `href="/contact?service=${encodeURIComponent('Outlet & Switch Installation')}"`,
    );
    expect(html).toContain(
      'href="/contact?service=Outlet%20%26%20Switch%20Installation"',
    );
    // The visible name is still the plain name, HTML-escaped once.
    expect(html).toContain('<h2>Outlet &amp; Switch Installation</h2>');
  });

  it('leaves a plain name readable in the link', () => {
    const html = ask('Panel Upgrade');
    expect(html).toContain('href="/contact?service=Panel%20Upgrade"');
    expect(html).not.toContain('%25');
  });
});
