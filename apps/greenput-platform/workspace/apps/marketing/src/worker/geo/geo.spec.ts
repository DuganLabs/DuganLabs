/**
 * GEO checks: schema shape, llms.txt freshness against the sitemap, and
 * claims that have to stay true of the code (no Google Ads, no published
 * placeholder lead rates, no LocalBusiness NAP, MCP tool names).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import handler from '../index.js';
import type { Env } from '../env.js';
import {
  AI_DISCLOSURE,
  CANONICAL_ONE_SENTENCE,
  GEO_UPDATED,
} from './entity.js';
import { GUIDES } from './guides.js';
import {
  AI_CRAWLER_NAMES,
  MCP_TOOLS,
  llmsTxt,
  openApiDocument,
  sitemapEntries,
  sitemapXml,
} from './documents.js';

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../',
);

const env: Env = { DB: {} as D1Database, ENVIRONMENT: 'test' };
const ctx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

const fetchUrl = (path: string, host = 'greenput.com'): Promise<Response> =>
  handler.fetch(new Request(`https://${host}${path}`), env, ctx);

const decode = (value: string): string =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

function jsonLd(html: string): Array<Record<string, unknown>> {
  return [
    ...html.matchAll(
      /<script type="application\/ld\+json" nonce="[0-9a-f]+">([\s\S]*?)<\/script>/g,
    ),
  ].map((match) => JSON.parse(match[1]) as Record<string, unknown>);
}

// Removed 2026-10-25: 'GreenPut learns' and 'calibrated on real outcomes'.
// The Oct 18 website-fixes ship packet's Fix 3 section ("Every job makes
// the next one sharper") was shipped on the homepage per Canonical Model
// v14's learn loop (quote → book → arrive → work → close → learn); those
// two phrases are that section's own wording. 'sharpen the next quote'
// stays forbidden — that phrasing is not the packet's.
const FORBIDDEN = [
  'Google Ads',
  'Dugan Labs LLC',
  'SendGrid',
  'Google Maps',
  'free estimates',
  'Do you offer free estimates',
  'sharpen the next quote',
  'Crew is notified automatically',
  'Invoice is generated automatically',
  'Accept credit cards on-site',
  'linkedin.com/company/greenput',
];

describe('llms.txt freshness', () => {
  const llms = llmsTxt();
  const locs = (sitemapXml().match(/<loc>([^<]+)<\/loc>/g) ?? []).map((loc) =>
    loc.replace(/<\/?loc>/g, ''),
  );

  it('lists every sitemap URL', () => {
    for (const loc of locs) {
      expect(llms, loc).toContain(loc);
    }
  });

  it('links only to URLs the sitemap lists', () => {
    const linked = [
      ...llms.matchAll(/\]\((https:\/\/greenput\.com[^)]*)\)/g),
    ].map((match) => match[1]);
    expect(linked.length).toBeGreaterThan(10);
    for (const href of linked) {
      expect(locs, href).toContain(href);
    }
  });

  it('uses the canonical sentence as its blockquote', () => {
    expect(llms).toContain(`> ${CANONICAL_ONE_SENTENCE}`);
  });
});

describe('guide copy bounds', () => {
  it('keeps every meta description within 160 characters and free of prices', () => {
    for (const guide of GUIDES) {
      expect(guide.description.length, guide.path).toBeLessThanOrEqual(160);
      expect(guide.description, guide.path).not.toMatch(/\$\d/);
      expect(guide.directAnswer, guide.path).not.toMatch(/\$\d/);
    }
  });

  it('uses a unique path per guide', () => {
    expect(new Set(GUIDES.map((guide) => guide.path)).size).toBe(GUIDES.length);
  });
});

describe('robots and agent card', () => {
  it('names the retrieval crawlers and still allows everyone', async () => {
    const body = await (await fetchUrl('/robots.txt')).text();
    expect(body).toMatch(/User-agent: \*\nAllow: \//);
    for (const name of AI_CRAWLER_NAMES) {
      expect(body).toContain(`User-agent: ${name}\nAllow: /`);
    }
    expect(body).toContain('Sitemap: https://greenput.com/sitemap.xml');
    expect(body).not.toMatch(/Disallow:/);
  });

  it('says the MCP server is not deployed and names only the real tools', async () => {
    const card = (await (await fetchUrl('/agents.json')).json()) as {
      mcp: {
        deployed: boolean;
        data_mode: string;
        directory_listing: string;
        tools: Array<{ name: string }>;
        not_tools: string[];
      };
      directory: { public_shop_listings: boolean };
      booking: { available_on_greenput_com: boolean };
    };
    expect(card.mcp.deployed).toBe(false);
    expect(card.mcp.data_mode).toBe('mock_only');
    expect(card.mcp.directory_listing).toBe('not_submitted');
    expect(card.mcp.tools.map((tool) => tool.name)).toEqual(
      MCP_TOOLS.map((tool) => tool.name),
    );
    expect(card.mcp.not_tools).toEqual(['qualify', 'get_quote']);
    expect(card.directory.public_shop_listings).toBe(false);
    expect(card.booking.available_on_greenput_com).toBe(false);

    const server = readFileSync(
      resolve(repoRoot, 'apps/mcp/src/server.ts'),
      'utf8',
    );
    const registered = [...server.matchAll(/registerTool\(\s*'([^']+)'/g)].map(
      (match) => match[1],
    );
    expect(registered).toEqual(MCP_TOOLS.map((tool) => tool.name));
  });

  it('publishes an OpenAPI document with no write operation', () => {
    const spec = openApiDocument();
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    expect(paths['/guides/tesla-wall-connector']).toBeDefined();
    expect(paths['/llms-full.txt']).toBeDefined();
    for (const [path, operations] of Object.entries(paths)) {
      expect(path).not.toMatch(/book/i);
      expect(Object.keys(operations)).toEqual(['get']);
    }
  });
});

describe('served guides', () => {
  it('renders each guide with schema that matches the visible copy', async () => {
    for (const guide of GUIDES) {
      const res = await fetchUrl(guide.path);
      expect(res.status, guide.path).toBe(200);
      const html = await res.text();
      expect(html).toContain(
        `<link rel="canonical" href="https://greenput.com${guide.path}">`,
      );
      expect(html).toContain(guide.h1);
      expect(html).toContain(guide.directAnswer);
      expect(html).toContain(AI_DISCLOSURE);
      expect(html).not.toMatch(/\$\d/);
      for (const phrase of FORBIDDEN) {
        expect(html, `${guide.path} ${phrase}`).not.toContain(phrase);
      }

      const blocks = jsonLd(html);
      const types = blocks.map((block) => block['@type']);
      expect(types).toContain('Organization');
      expect(types).toContain('WebSite');
      expect(types).toContain('BreadcrumbList');
      expect(types).not.toContain('LocalBusiness');
      const flat = JSON.stringify(blocks);
      expect(flat).not.toContain('streetAddress');
      expect(flat).not.toContain('aggregateRating');
      expect(flat).not.toContain('telephone');
      expect(flat).not.toContain('"price"');
      expect(flat).not.toContain('reviewCount');

      const organization = blocks.find(
        (block) => block['@type'] === 'Organization',
      );
      expect(organization?.description).toBe(CANONICAL_ONE_SENTENCE);
      expect(organization?.sameAs).toEqual(['https://github.com/DuganLabs']);

      if (guide.faqs.length > 0) {
        const faq = blocks.find((block) => block['@type'] === 'FAQPage') as {
          mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
        };
        expect(faq.mainEntity.map((item) => item.name)).toEqual(
          guide.faqs.map((item) => item.question),
        );
        expect(faq.mainEntity.map((item) => item.acceptedAnswer.text)).toEqual(
          guide.faqs.map((item) => item.answer),
        );
        for (const item of guide.faqs) {
          expect(decode(html)).toContain(item.question);
          expect(decode(html)).toContain(item.answer);
        }
      }
      if (guide.howTo) {
        const howTo = blocks.find((block) => block['@type'] === 'HowTo') as {
          name: string;
          step: Array<{ name: string; text: string }>;
        };
        expect(howTo.name).toBe(guide.howTo.name);
        expect(howTo.step.map((step) => step.name)).toEqual(
          guide.howTo.steps.map((step) => step.name),
        );
        expect(howTo.step.map((step) => step.text)).toEqual(
          guide.howTo.steps.map((step) => step.text),
        );
      }
      if (guide.service) {
        const service = blocks.find((block) => block['@type'] === 'Service');
        expect(service?.description).toBe(guide.service.description);
        expect(service).not.toHaveProperty('offers');
      } else {
        expect(types).not.toContain('Service');
      }
    }
  });

  it('puts the guides in the sitemap with a stable lastmod', async () => {
    const xml = await (await fetchUrl('/sitemap.xml')).text();
    expect(xml).toContain(
      '<loc>https://greenput.com/guides/tesla-powerwall</loc>',
    );
    expect(xml).toContain(`<lastmod>${GEO_UPDATED}</lastmod>`);
    expect(sitemapEntries().some((entry) => entry.path === '/guides')).toBe(
      true,
    );
  });

  it('redirects www to the apex', async () => {
    const res = await fetchUrl('/guides', 'www.greenput.com');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://greenput.com/guides');
  });
});

describe('claims versus code', () => {
  const htmlPaths = [
    '/',
    '/features',
    '/pricing',
    '/about',
    '/technology',
    '/ai',
    '/investors',
    '/contact',
    '/privacy',
    '/terms',
    ...GUIDES.map((guide) => guide.path),
  ];

  it('does not repeat the retired false claims on any marketing page', async () => {
    for (const path of htmlPaths) {
      const html = await (await fetchUrl(path)).text();
      for (const phrase of FORBIDDEN) {
        expect(html, `${path} ${phrase}`).not.toContain(phrase);
      }
    }
  });

  it('keeps "no subscription tiers" while plan limits are not mounted', async () => {
    const apiIndex = readFileSync(
      resolve(repoRoot, 'apps/api/src/index.ts'),
      'utf8',
    );
    const mounted = /plan-limits|checkLimit|requireFeature/.test(apiIndex);
    const pricing = await (await fetchUrl('/pricing')).text();
    expect(mounted).toBe(false);
    expect(pricing).toContain('No subscription tiers');
  });

  it('does not publish placeholder per-lead dollar rates', async () => {
    const card = readFileSync(
      resolve(repoRoot, 'libs/shared/models/src/lead-rate-card.ts'),
      'utf8',
    );
    expect(card).toContain('PLACEHOLDER RATES');
    const prices = [...card.matchAll(/:\s*(\d+),/g)].map((match) => match[1]);
    expect(prices.length).toBeGreaterThan(3);
    const llms = await (await fetchUrl('/llms.txt')).text();
    const full = await (await fetchUrl('/llms-full.txt')).text();
    for (const price of prices) {
      expect(llms).not.toContain(`$${price}`);
      expect(full).not.toContain(`$${price}`);
    }
  });

  // Warren’s rule (2026-11-01): marketing content never shows a homeowner
  // price or range. The price lives only inside the quote. Every sitemap
  // URL — pages, guides, llms.txt, llms-full.txt, agents.json, openapi.json
  // — is checked for a "$X–$Y" style dollar range.
  it('shows no homeowner dollar range on any marketing page', async () => {
    const dollarRange =
      /\$\s?\d[\d,.]*\s*(?:[kK]\b)?\s*(?:–|—|-|to)\s*\$?\s?\d/;
    const entries = sitemapEntries();
    expect(entries.length).toBeGreaterThan(10);
    for (const { path } of entries) {
      const res = await fetchUrl(path);
      expect(res.status, path).toBe(200);
      const text = decode(await res.text());
      expect(dollarRange.exec(text)?.[0], path).toBeUndefined();
      expect(text, path).not.toContain('get_price_range');
      expect(text, path).not.toMatch(/range_(?:low|high)/);
    }
  });

  it('tells the truth about the AI prototype and points at the guides', async () => {
    const html = await (await fetchUrl('/ai')).text();
    expect(html).toContain('mock data');
    expect(html).toContain('not yet listed');
    expect(html).toContain('href="/guides"');
    expect(html).toContain('There is no qualify tool');
  });
});
