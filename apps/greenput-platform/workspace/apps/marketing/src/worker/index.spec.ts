import { describe, expect, it } from 'vitest';
import handler from './index.js';
import type { Env } from './env.js';

const env: Env = { DB: {} as D1Database, ENVIRONMENT: 'test' };
const ctx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

const fetchUrl = (path: string): Promise<Response> =>
  handler.fetch(new Request(`https://greenput.com${path}`), env, ctx);

describe('marketing worker', () => {
  it('serves /robots.txt with the canonical Greenput sitemap pointer', async () => {
    const res = await fetchUrl('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    const body = await res.text();
    expect(body).toMatch(/User-agent: \*/);
    expect(body).toMatch(/Sitemap: https:\/\/greenput\.com\/sitemap\.xml/);
  });

  it('serves /sitemap.xml with all canonical routes', async () => {
    const res = await fetchUrl('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/xml/);
    const body = await res.text();
    expect(body).toContain('<loc>https://greenput.com/</loc>');
    expect(body).toContain('<loc>https://greenput.com/features</loc>');
    expect(body).toContain('<loc>https://greenput.com/pricing</loc>');
    expect(body).toContain('<loc>https://greenput.com/about</loc>');
    expect(body).toContain('<loc>https://greenput.com/contact</loc>');
  });

  it('emits Open Graph + Twitter Card meta tags on the home page', async () => {
    const res = await fetchUrl('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(
      /<link rel="canonical" href="https:\/\/greenput\.com">/,
    );
    expect(html).toMatch(/<meta property="og:site_name" content="Greenput">/);
    expect(html).toMatch(/<meta property="og:type" content="website">/);
    expect(html).toMatch(
      /<meta property="og:url" content="https:\/\/greenput\.com">/,
    );
    expect(html).toMatch(
      /<meta name="twitter:card" content="summary_large_image">/,
    );
  });

  it('updates the canonical URL per route', async () => {
    const res = await fetchUrl('/pricing');
    const html = await res.text();
    expect(html).toContain(
      '<link rel="canonical" href="https://greenput.com/pricing">',
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://greenput.com/pricing">',
    );
  });

  it('renders the JSON-LD Organization payload as parsed JSON, nonced to match the CSP', async () => {
    const res = await fetchUrl('/');
    const html = await res.text();
    expect(html).not.toContain('<!--__STRUCTURED_DATA__-->');
    const match = html.match(
      /<script type="application\/ld\+json" nonce="([0-9a-f]+)">([\s\S]*?)<\/script>/,
    );
    expect(match).not.toBeNull();
    const [, nonce, payload] = match ?? [];
    const data = JSON.parse(payload ?? '{}') as Record<string, unknown>;
    expect(data['@type']).toBe('Organization');
    expect(data.name).toBe('Greenput');
    expect(data.legalName).toBe('Greenput LLC');
    expect(JSON.stringify(data)).not.toContain('Warren Michael Dugan');
    expect(data.url).toBe('https://greenput.com');
    // No public mailing address. OPERATOR_MAILING_ADDRESS is empty, and
    // Organization JSON-LD must not grow a streetAddress.
    expect(JSON.stringify(data)).not.toContain('streetAddress');
    expect(JSON.stringify(data)).not.toContain('7 Ninos');
    expect(res.headers.get('content-security-policy')).toContain(
      `'nonce-${nonce}'`,
    );
  });

  it('serves /privacy and /terms with real content, linked from the footer', async () => {
    const home = await (await fetchUrl('/')).text();
    expect(home).toContain('href="/privacy"');
    expect(home).toContain('href="/terms"');
    expect(home).toContain('Operated by Greenput LLC');
    expect(home).not.toContain('Warren Michael Dugan');
    expect(home).not.toContain('7 Ninos');
    expect(home).not.toContain('92620');
    const llms = await (await fetchUrl('/llms.txt')).text();
    expect(llms).not.toContain('Warren Michael Dugan');
    expect(llms).not.toContain('7 Ninos');
    expect(llms).not.toContain('92620');

    const privacy = await fetchUrl('/privacy');
    expect(privacy.status).toBe(200);
    const privacyText = await privacy.text();
    expect(privacyText).toContain('id="privacy-heading"');
    expect(privacyText).toContain('>Privacy Policy</h1>');
    // Pool sharing (2026-10-16): the policy names all three ways a
    // customer’s information is shared — infrastructure providers, the
    // contractor they chose, and a second contractor only under their
    // own per-field grant, receipted and revocable. The pre-pool
    // sentence ("share it only with the infrastructure providers")
    // must not come back: it stopped describing the product when the
    // pool shipped.
    expect(privacyText).toContain('We never sell your information');
    expect(privacyText).toContain('We share it only in these ways:');
    expect(privacyText).toContain('only with your separate permission');
    expect(privacyText).toContain(
      'Every share under the last two bullets is recorded',
    );
    expect(privacyText).not.toContain(
      'share it only with the infrastructure providers',
    );
    expect(privacyText).toContain('Operated by Greenput LLC');
    expect(privacyText).not.toContain('Warren Michael Dugan');
    expect(privacyText).not.toContain('7 Ninos');
    expect(privacyText).toContain('login and verification codes');
    expect(privacyText).toContain('Reply STOP to opt out');
    expect(privacyText).toContain('HELP for help');
    expect(privacyText).toContain('not a condition of any purchase');

    const terms = await fetchUrl('/terms');
    expect(terms.status).toBe(200);
    const termsText = await terms.text();
    expect(termsText).toContain('id="terms-heading"');
    expect(termsText).toContain('>Terms of Service</h1>');
    expect(termsText).toContain('Operated by Greenput LLC');
    expect(termsText).not.toContain('Warren Michael Dugan');
    expect(termsText).not.toContain('7 Ninos');
    expect(termsText).not.toContain('92620');
    expect(termsText).toContain('login and verification codes');
    expect(termsText).toContain('notifications about leads');
    expect(termsText).toContain('Reply STOP to cancel');
    expect(termsText).toContain('HELP for help');
    expect(termsText).toContain('not a condition of purchase');
  });

  it('renders the contact form as a real POST to /contact, so it works without JavaScript (GP-004)', async () => {
    const html = await (await fetchUrl('/contact')).text();
    expect(html).toContain(
      '<form id="contact-form" data-bn="bn-form" method="post" action="/contact" novalidate>',
    );
    expect(html).toContain('Operated by Greenput LLC');
    expect(html).not.toContain('Warren Michael Dugan');
    expect(html).toContain('contact form');
    expect(html).not.toContain('7 Ninos');
    expect(html).not.toContain('92620');
    // A plain visit: nothing submitted, no error, empty inputs.
    expect(html).not.toContain('Message sent!');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('aria-invalid');
  });

  it('includes a consent note on the contact form', async () => {
    const html = await (await fetchUrl('/contact')).text();
    expect(html).toMatch(
      /data-bn="bn-note"[^>]*>\s*By submitting, you agree to be contacted/,
    );
    expect(html).toMatch(/agree to be contacted/);
  });

  it('renders the vertical rate bands on /pricing', async () => {
    const html = await (await fetchUrl('/pricing')).text();
    expect(html).toContain('Higher value');
    expect(html).toContain('Solar/EV Charger');
  });

  it('adds FAQPage JSON-LD on /pricing, matching the rendered FAQ copy', async () => {
    const html = await (await fetchUrl('/pricing')).text();
    const matches = [
      ...html.matchAll(
        /<script type="application\/ld\+json" nonce="[0-9a-f]+">([\s\S]*?)<\/script>/g,
      ),
    ];
    const blocks = matches.map(
      (match) => JSON.parse(match[1]) as { '@type': string },
    );
    expect(blocks.map((block) => block['@type'])).toEqual([
      'Organization',
      'WebSite',
      'FAQPage',
      'Service',
    ]);
    const faqPage = blocks[2] as {
      '@type': string;
      mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
    };
    expect(faqPage['@type']).toBe('FAQPage');
    expect(faqPage.mainEntity[0].name).toBe('Why no subscription tiers?');
    expect(html).toContain(faqPage.mainEntity[0].name);
  });

  it('adds Service JSON-LD on /pricing, describing the delivered-lead offer', async () => {
    const html = await (await fetchUrl('/pricing')).text();
    const matches = [
      ...html.matchAll(
        /<script type="application\/ld\+json" nonce="[0-9a-f]+">([\s\S]*?)<\/script>/g,
      ),
    ];
    const service = matches
      .map((match) => JSON.parse(match[1]) as Record<string, unknown>)
      .find((block) => block['@type'] === 'Service') as {
      provider: { '@id': string };
      description: string;
    };
    expect(service.provider['@id']).toBe('https://greenput.com/#organization');
    expect(service.description).toContain('one price per delivered lead');
  });

  it('serves /llms.txt with the machine-readable entity summary', async () => {
    const res = await fetchUrl('/llms.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    const body = await res.text();
    expect(body).toContain('# Greenput');
    expect(body).toContain('one price per delivered lead');
    expect(body).toContain('not affiliated with or endorsed by Tesla');
    // the /ai page shows an illustrated walkthrough — the protocol
    // captures it once described were removed in PR #209
    expect(body).toContain('illustrated walkthrough of a booking');
    expect(body).not.toContain('captured exchanges');
  });

  it('does not claim Google Ads campaign management anywhere on home or pricing', async () => {
    // There is no Ads integration in the product (campaigns are an
    // attribution ledger). What pauses is lead DELIVERY, via
    // schedule-aware delivery — the copy must say that, not Ads.
    for (const path of ['/', '/pricing']) {
      const html = await (await fetchUrl(path)).text();
      expect(html).not.toContain('Google Ads campaign');
      expect(html).not.toContain('manages your Google Ads');
      expect(html).toContain('Lead delivery pauses when your schedule is full');
    }
  });

  it('does not add FAQPage JSON-LD on the home page', async () => {
    const html = await (await fetchUrl('/')).text();
    const types = [
      ...html.matchAll(
        /<script type="application\/ld\+json" nonce="[0-9a-f]+">([\s\S]*?)<\/script>/g,
      ),
    ].map((match) => (JSON.parse(match[1]) as { '@type': string })['@type']);
    expect(types).toEqual(['Organization', 'WebSite']);
  });

  it('runs the homepage loop quote-first and bills at booking (Canonical Model v14)', async () => {
    const html = await (await fetchUrl('/')).text();
    // the loop, quote first — the old lead-first pipeline must not return
    expect(html).toContain('quote, book, arrive, work, close, learn');
    expect(html).toContain('The quote is the first thing');
    expect(html).not.toContain('Lead Captured');
    expect(html).not.toContain('Lead Qualified');
    // the fee event is booking, on the homepage pipeline step itself
    expect(html).toContain(
      'At booking, the contractor pays the per-lead price',
    );
    // the dual-feedback-loops section (Oct 18 ship packet, Fix 3) sits
    // after the pipeline, and the closing CTA states the beta stage
    // plainly instead of implying an existing user base (Fix 1)
    expect(html).toContain('Every job makes the next one sharper');
    expect(html).toContain(
      'Greenput is in beta, onboarding its first contractors now.',
    );
    // llms.txt states the same fee event
    const llms = await (await fetchUrl('/llms.txt')).text();
    expect(llms).toContain('The fee is charged at booking');
    expect(llms).not.toContain('fee is recorded when a shop accepts');
  });

  it('sends quote, proposal, and invoice to the tenant that can render them', async () => {
    for (const path of ['/quote', '/proposal', '/invoice']) {
      const res = await fetchUrl(path);
      expect(res.status, path).toBe(302);
      expect(res.headers.get('location')).toBe(
        `https://demo.greenput.com${path}`,
      );
    }
  });

  it('returns a branded, noindexed 404 for an unknown path with no canonical/og:url', async () => {
    const res = await fetchUrl('/this-page-does-not-exist');
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain('We couldn’t find that page');
    expect(html).toMatch(
      /<meta name="robots" content="noindex, nofollow"\s*\/?>/,
    );
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain('property="og:url"');
  });

  it('serves the same branded 404 for /privacy-typo-like unknown legal paths', async () => {
    const res = await fetchUrl('/privicy');
    expect(res.status).toBe(404);
  });
});

describe('the mobile nav (GP-042)', () => {
  // The nav is reachable with no JavaScript. The header menu is a popover
  // and the phone tab bar is in the DOM; gp4.css shows the bar through
  // 760px. There is no hamburger checkbox and no script that opens a menu.
  it.each(['/pricing', '/technology', '/ai', '/investors'])(
    '%s renders the v4 header and phone tab bar, with no checkbox hack',
    async (path) => {
      const res = await fetchUrl(path);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('data-gp4="1"');
      expect(html).toContain('popover="auto"');
      expect(html).toContain('aria-label="Main sections"');
      expect(html).toContain('href="/features"');
      expect(html).toContain('href="/contact"');
      expect(html).not.toContain('data-bn="bn-topbar"');
      expect(html).not.toContain('nav-toggle');
      expect(html).not.toContain('type="checkbox"');
      expect(html).not.toContain('<noscript>');
      expect(html).not.toContain('prefers-color-scheme');
    },
  );

  it('the retired stylesheet is still served, and no page links it', async () => {
    const res = await fetchUrl('/css/styles.css');
    expect(res.status).toBe(200);
    const pricing = await (await fetchUrl('/pricing')).text();
    expect(pricing).not.toContain('/css/styles.css');
    expect(pricing).toContain('/css/gp4.css');
  });

  it('the site script does not open a menu', async () => {
    const res = await fetchUrl('/js/app.js');
    expect(res.status).toBe(200);
    const js = await res.text();
    expect(js).not.toContain('nav-toggle');
    expect(js).not.toContain('data-open');
    expect(js).toContain('contact-form');
  });
});

describe('AI assistants page (/ai)', () => {
  it('serves /ai with its title and the MCP walkthrough', async () => {
    const res = await fetchUrl('/ai');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(
      '<title>Greenput for AI Assistants — Greenput</title>',
    );
    expect(html).toContain('greenput-discovery');
    expect(html).toContain('find_contractors');
    expect(html).toContain('start_quote');
    expect(html).not.toContain('get_price_range');
    expect(html).toContain('request_booking');
  });

  it('walks the homeowner journey: ask, verified answer, grant, receipt', async () => {
    const html = await (await fetchUrl('/ai')).text();
    // labeled as what it is: an illustrated walkthrough on demo data
    expect(html).toContain('Illustrated walkthrough · Demo data');
    expect(html).toContain('an illustrated walkthrough, not screenshots');
    // step 1 — the ask, in the homeowner’s own words
    expect(html).toContain(
      'I need an electrician near Irvine to install a Tesla Wall Connector this week.',
    );
    // step 2 — verified results as cards, and no homeowner price: the
    // price lives only inside the quote, where the engine’s questions take
    // it to one exact number the customer books at, and a booked job lands
    // on the shop’s schedule — no response-time badges
    expect(html).toContain('Irvine Electric Co.');
    expect(html).toContain('Greenput Verified');
    expect(html).not.toContain('$850–$1,450');
    expect(html).not.toContain('$900–$1,600');
    expect(html).toContain('answer a few questions to start your quote');
    expect(html).toContain('Book Irvine Electric Co.');
    expect(html).toContain('No price is shown yet.');
    expect(html).toContain('you book at one exact number');
    expect(html).not.toContain('turns the range into a quote');
    expect(html).toContain(
      'Books into their schedule — they confirm the details with you',
    );
    expect(html).not.toContain('Books straight into their schedule');
    expect(html).not.toContain('a range, not a quote');
    expect(html).not.toContain('confirms the exact price');
    expect(html).not.toContain('Responds within 1 business day');
    expect(html).not.toContain('Responds the same business day');
    // step 3 — the grant screen: who is asking, the fields, the purpose,
    // and the network reroute as a separate, unchecked opt-in
    expect(html).toContain(
      'asked Greenput to book your Wall Connector install',
    );
    expect(html).toContain('Name');
    expect(html).toContain('Phone number');
    expect(html).toContain('Service address');
    expect(html).toContain('Job details');
    expect(html).toContain(
      'Purpose: so they can quote and schedule your install',
    );
    expect(html).toContain(
      'share my details with another verified contractor instead',
    );
    expect(html).toContain('data-state="off"');
    expect(html).toContain('Grant &amp; book');
    expect(html).toContain('Cancel');
    // step 4 — the receipt: what was shared, with whom, and revocation;
    // the booking lands in an open slot — the shop confirms the booking
    // and the details with the customer, who can cancel or switch shops
    expect(html).toContain('Booked with Irvine Electric Co.');
    expect(html).toContain('books the job into an open slot on their calendar');
    expect(html).toContain(
      'The shop confirms the booking and the details with the customer directly',
    );
    expect(html).toContain('take the job to a different shop, at any point');
    expect(html).not.toContain('confirmed slot');
    expect(html).not.toContain('no booking is promised');
    expect(html).toContain('Name, phone number, service address, job details');
    expect(html).toContain('Not shared');
    expect(html).toContain('Revoke this grant');
  });

  it('shows no protocol captures: the JSON frames are gone', async () => {
    const html = await (await fetchUrl('/ai')).text();
    expect(html).not.toContain('data_mode');
    expect(html).not.toContain('sharing_receipt');
    expect(html).not.toContain('protocolVersion');
    expect(html).not.toContain('data-bn="tool-json"');
    expect(html).not.toContain('MOCK — SunTest Electric Co.');
    expect(html).not.toContain('expected object, received undefined at grant');
  });

  it('includes /ai in the sitemap and the shared nav', async () => {
    const sitemap = await (await fetchUrl('/sitemap.xml')).text();
    expect(sitemap).toContain('<loc>https://greenput.com/ai</loc>');
    const home = await (await fetchUrl('/')).text();
    expect(home).toContain('href="/ai"');
  });
});

describe('Investors page (/investors)', () => {
  it('serves /investors with its title, the canonical sentence and the round terms', async () => {
    const res = await fetchUrl('/investors');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>For Investors — Greenput</title>');
    // the canonical entity sentence, verbatim
    expect(html).toContain(
      'Greenput is the operating system for trade contractors — a lead-to-payment platform that charges one price per delivered lead, so contractors pay for booked jobs, not bought leads.',
    );
    expect(html).toContain('post-money SAFE');
    expect(html).toContain('$8M cap');
    expect(html).toContain('$1M');
    // the Tesla program scale and the wedge sentence, intact
    expect(html).toContain('7,000+ installers');
    expect(html).toContain('35+ countries');
    expect(html).toContain('1M+');
    expect(html).toContain(
      'Tesla One handles Tesla product ordering and quoting; Greenput runs all of the shop’s work, Tesla and non-Tesla, from first click to payment.',
    );
    // the model’s settled terms (Canonical Model v14, 2026-10-24: deposit
    // abolished, referral fees abolished — the fee bills at booking, and
    // bilateral confirmation locks the details; it is never the billing gate)
    expect(html).toContain('One price, billed at booking');
    expect(html).toContain(
      'At booking, the contractor pays the per-lead price',
    );
    expect(html).toContain('bilateral confirmation');
    expect(html).toContain('never the billing gate');
    expect(html).not.toContain('billed on acceptance');
    expect(html).not.toContain('billing on acceptance');
    expect(html).not.toContain('second confirmation is what bills');
    expect(html).toContain('No referral fees, ever');
    expect(html).not.toContain('Referral share');
    expect(html).not.toContain('Bookings carry a deposit');
    expect(html).toContain('No subscription tiers');
    expect(html).toContain('quoted → scheduled → completed → paid');
    // the stage, stated as plainly as llms.txt states it
    expect(html).toContain('pre-first-user and pre-revenue');
    // the CTA — the form is the only published contact route; no email
    expect(html).toContain('href="/contact"');
    expect(html).not.toContain('owner@example.com');
    expect(html).not.toContain('mailto:');
  });

  it('names no one: people appear by role only', async () => {
    const html = await (await fetchUrl('/investors')).text();
    expect(html).not.toContain('Sheen');
    expect(html).not.toContain('Oshin');
    expect(html).not.toContain('Hi Power');
    expect(html).not.toContain('Chapman');
  });

  it('is in the sitemap, the footer and llms.txt — but not the top nav', async () => {
    const sitemap = await (await fetchUrl('/sitemap.xml')).text();
    expect(sitemap).toContain('<loc>https://greenput.com/investors</loc>');
    const home = await (await fetchUrl('/')).text();
    expect(home).toContain('href="/investors"');
    const llms = await (await fetchUrl('/llms.txt')).text();
    expect(llms).toContain(
      '- [Investors](https://greenput.com/investors): The pre-seed round — the model, the wedge, and where Greenput stands.',
    );
    // the shared nav row is width-critical (the 72rem breakpoint was
    // measured for its current links): /investors stays out of it
    const header = home.slice(
      home.indexOf('<header'),
      home.indexOf('</header>'),
    );
    expect(header).not.toContain('href="/investors"');
    const tabsStart = home.indexOf('aria-label="Main sections"');
    const tabs = home.slice(tabsStart, home.indexOf('</nav>', tabsStart));
    expect(tabs).not.toContain('href="/investors"');
  });
});

describe('per-route Open Graph cards', () => {
  const ROUTES: Array<[string, string]> = [
    ['/', 'home'],
    ['/features', 'features'],
    ['/pricing', 'pricing'],
    ['/about', 'about'],
    ['/technology', 'technology'],
    ['/ai', 'ai'],
    ['/investors', 'investors'],
    ['/contact', 'contact'],
    ['/privacy', 'privacy'],
    ['/terms', 'terms'],
  ];

  const metaContent = (html: string, attr: string, name: string): string => {
    const match = new RegExp(`<meta ${attr}="${name}" content="([^"]+)"`).exec(
      html,
    );
    return match?.[1] ?? '';
  };

  it('gives every route its own og:image, twitter:image and alt', async () => {
    const images = new Set<string>();
    const alts = new Set<string>();
    for (const [path, slug] of ROUTES) {
      const html = await (await fetchUrl(path)).text();
      const ogImage = metaContent(html, 'property', 'og:image');
      expect(ogImage, `${path} og:image`).toBe(
        `https://greenput.com/og/${slug}.png`,
      );
      expect(
        metaContent(html, 'name', 'twitter:image'),
        `${path} twitter:image`,
      ).toBe(ogImage);
      const alt = metaContent(html, 'property', 'og:image:alt');
      expect(alt.length, `${path} og:image:alt`).toBeGreaterThan(10);
      images.add(ogImage);
      alts.add(alt);
    }
    expect(images.size).toBe(ROUTES.length);
    expect(alts.size).toBe(ROUTES.length);
  });

  it('serves every card as a real PNG', async () => {
    for (const [, slug] of ROUTES) {
      const res = await fetchUrl(`/og/${slug}.png`);
      expect(res.status, slug).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes.length, slug).toBeGreaterThan(10000);
      expect([...bytes.slice(0, 4)], slug).toEqual([0x89, 0x50, 0x4e, 0x47]);
    }
  });

  it('404s an unknown card slug', async () => {
    const res = await fetchUrl('/og/nope.png');
    expect(res.status).toBe(404);
  });
});
