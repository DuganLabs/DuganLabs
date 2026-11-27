/**
 * Machine-readable surfaces: llms.txt, llms-full.txt, robots.txt,
 * the sitemap URL list, an agent card, and a small OpenAPI document.
 *
 * All of them are generated from GUIDES and the canonical entity, so a
 * new guide shows up in the sitemap, both llms files, and the OpenAPI
 * paths together. geo.spec.ts fails if a served route is missing from
 * llms.txt or if llms.txt links to a path the sitemap does not list.
 */

import {
  AI_DISCLOSURE,
  CANONICAL_NAME,
  CANONICAL_ONE_SENTENCE,
  CANONICAL_STAGE,
  CANONICAL_URL,
  GEO_UPDATED,
  TESLA_DISCLAIMER,
} from './entity.js';
import { GUIDES, type GuidePage } from './guides.js';

export interface SitemapEntry {
  path: string;
  changefreq: 'weekly' | 'monthly';
  priority: string;
}

/** HTML routes that are not guides. Keep in lockstep with the worker. */
export const CORE_PAGES: readonly {
  path: string;
  title: string;
  blurb: string;
  changefreq: 'weekly' | 'monthly';
  priority: string;
}[] = [
  {
    path: '/',
    title: 'Home',
    blurb: 'What Greenput is — the operating system for trade contractors.',
    changefreq: 'weekly',
    priority: '1.0',
  },
  {
    path: '/features',
    title: 'Features',
    blurb:
      'Lead management, job scheduling, and invoicing. The customer portal is marked coming soon.',
    changefreq: 'monthly',
    priority: '0.8',
  },
  {
    path: '/pricing',
    title: 'Pricing',
    blurb:
      'How Greenput charges contractors — no subscription tiers, prepaid SMS balance, one price per delivered lead. No dollar rates for leads are published. Includes the pricing FAQ.',
    changefreq: 'monthly',
    priority: '0.9',
  },
  {
    path: '/about',
    title: 'About',
    blurb: 'Who Greenput is built for and who built it.',
    changefreq: 'monthly',
    priority: '0.6',
  },
  {
    path: '/technology',
    title: 'Technology',
    blurb: 'Measured performance of a live Greenput reference site.',
    changefreq: 'monthly',
    priority: '0.7',
  },
  {
    path: '/ai',
    title: 'AI Assistants',
    blurb:
      'The MCP server is a prototype on mock data and is not listed in the ChatGPT or Claude directories. The page includes an illustrated walkthrough of a booking.',
    changefreq: 'monthly',
    priority: '0.7',
  },
  {
    path: '/investors',
    title: 'Investors',
    blurb:
      'The pre-seed round — the model, the wedge, and where Greenput stands.',
    changefreq: 'monthly',
    priority: '0.6',
  },
  {
    path: '/contact',
    title: 'Contact',
    blurb:
      'Contact the Greenput team. The form is the only published contact route.',
    changefreq: 'monthly',
    priority: '0.7',
  },
  {
    path: '/privacy',
    title: 'Privacy',
    blurb: 'How Greenput collects, uses, and protects information.',
    changefreq: 'monthly',
    priority: '0.3',
  },
  {
    path: '/terms',
    title: 'Terms',
    blurb: 'The terms that govern use of the Greenput marketing site.',
    changefreq: 'monthly',
    priority: '0.3',
  },
];

const MACHINE_PAGES: readonly SitemapEntry[] = [
  { path: '/llms.txt', changefreq: 'monthly', priority: '0.4' },
  { path: '/llms-full.txt', changefreq: 'monthly', priority: '0.4' },
  { path: '/agents.json', changefreq: 'monthly', priority: '0.4' },
  { path: '/openapi.json', changefreq: 'monthly', priority: '0.3' },
];

export function sitemapEntries(): SitemapEntry[] {
  return [
    ...CORE_PAGES.map((page) => ({
      path: page.path,
      changefreq: page.changefreq,
      priority: page.priority,
    })),
    ...GUIDES.map((guide) => ({
      path: guide.path,
      changefreq: 'monthly' as const,
      priority: guide.path === '/guides' ? '0.8' : '0.7',
    })),
    ...MACHINE_PAGES,
  ];
}

export function sitemapXml(): string {
  const urls = sitemapEntries()
    .map((entry) => {
      const loc =
        entry.path === '/'
          ? `${CANONICAL_URL}/`
          : `${CANONICAL_URL}${entry.path}`;
      return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${GEO_UPDATED}</lastmod>\n    <changefreq>${entry.changefreq}</changefreq>\n    <priority>${entry.priority}</priority>\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/**
 * Retrieval crawlers for the assistants a homeowner actually asks.
 * `User-agent: *` already allows them; naming them makes the allow
 * explicit so a later Disallow cannot silently cover ChatGPT or Claude.
 * Training opt-out (Google-Extended and the rest) is also Allow: the
 * plan’s bet is retrieval, and blocking training crawlers is Warren’s
 * call, not a default.
 */
const AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-SearchBot',
  'Claude-User',
  'anthropic-ai',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'GoogleOther',
  'Applebot-Extended',
  'GrokBot',
  'xAI-Grok',
  'Amazonbot',
  'Bytespider',
  'CCBot',
  'cohere-ai',
  'Meta-ExternalAgent',
  'DuckAssistBot',
] as const;

export const AI_CRAWLER_NAMES = AI_CRAWLERS;

export function robotsTxt(): string {
  const groups = [
    'User-agent: *',
    'Allow: /',
    '',
    ...AI_CRAWLERS.flatMap((name) => [`User-agent: ${name}`, 'Allow: /', '']),
    `# ${CANONICAL_URL}/llms.txt`,
    `# ${CANONICAL_URL}/llms-full.txt`,
    `Sitemap: ${CANONICAL_URL}/sitemap.xml`,
    '',
  ];
  return groups.join('\n');
}

function link(path: string, title: string, blurb: string): string {
  const href = path === '/' ? `${CANONICAL_URL}/` : `${CANONICAL_URL}${path}`;
  return `- [${title}](${href}): ${blurb}`;
}

export function llmsTxt(): string {
  const keyPages = CORE_PAGES.map((page) =>
    link(page.path, page.title, page.blurb),
  ).join('\n');
  const guides = GUIDES.map((guide) =>
    link(guide.path, guide.h1, guide.description),
  ).join('\n');
  return `# ${CANONICAL_NAME}

> ${CANONICAL_ONE_SENTENCE}

Greenput runs a trade contractor’s work from first click to payment as one loop — quote → book → arrive → work → close → learn — in one system, with a tenant website for each shop. The quote is the first thing: the homeowner starts a quote, and the engine’s questions happen inside it: no price at first, then a range that firms into one exact quote the homeowner books at. It is built for residential trade contractors, starting with electricians — including Tesla certified installers in Orange County, California — and expanding to plumbing and HVAC.

Stage, stated plainly: ${CANONICAL_STAGE} ${TESLA_DISCLAIMER}

## How Greenput charges

- One price per delivered lead, regardless of source. The fee is charged at booking: at booking, the contractor pays the per-lead price — one flat price per booked job, for all booked jobs. Confirmation after booking locks the job details; it is never the billing gate.
- The rate per delivered lead is set by vertical and service. The dollar figures in the product are placeholders pending a pilot and are not published on this site. There are no subscription tiers and no monthly minimum. Plan-limit tables exist in the API and are not mounted on any route.
- Outbound SMS (booking texts and chat fallback) is paid from a prepaid workspace balance that tops up from the card on file: Twilio’s published US list price is reserved at send time, then adjusted to the price Twilio reports. Sign-in codes are not charged to the workspace. Cloudflare request volume is not billed. Stripe takes its processing fee from each card charge.
- Greenput pays no referral fees — not flat fees, and not a share when a job books. AI assistants that route a customer here are unpaid distribution.
- Every delivered lead can be tracked to an outcome: quoted, scheduled, completed, paid. Those records do not recalibrate prices yet.
- Greenput is not an electrician and does not publish a shop directory, a license number, a review, or an install price.

## Key pages

${keyPages}

## Guides for homeowners

${guides}

## For agents

${link('/llms.txt', 'llms.txt', 'This file.')}
${link('/llms-full.txt', 'llms-full.txt', 'The homeowner guides in full, including each direct answer and FAQ.')}
${link('/agents.json', 'Agent card', 'Whether the MCP server is deployed, and the only tool names it defines.')}
${link('/openapi.json', 'OpenAPI', 'The public read endpoints. There is no booking operation.')}

## The trades

- Electricians — first trade in the rollout, including Tesla certified installers. Seeded quote engines: Level 2 EV charger, panel or service upgrade, circuit or outlet, troubleshooting, whole-home surge protection.
- Plumbing — named as next. No quote engine yet.
- HVAC — named after plumbing. No quote engine yet.
- Roofing — part of the contractor base the product is built for. No quote engine yet.
- Tesla Powerwall and home solar — not quoted. See the Powerwall guide.

## Contact

- Website: ${CANONICAL_URL}
- Contact form: ${CANONICAL_URL}/contact
- GitHub: https://github.com/DuganLabs
`;
}

function guideMarkdown(guide: GuidePage): string {
  const sections = guide.sections
    .map((section) => {
      const body = [
        ...section.paragraphs,
        ...(section.bullets ?? []).map((bullet) => `- ${bullet}`),
        ...(section.links ?? []).map((item) => {
          const href = item.href.startsWith('/')
            ? `${CANONICAL_URL}${item.href}`
            : item.href;
          return `- [${item.label}](${href}): ${item.note}`;
        }),
      ];
      return `## ${section.heading}\n\n${body.join('\n\n')}`;
    })
    .join('\n\n');
  const howTo = guide.howTo
    ? `\n\n## ${guide.howTo.name}\n\n${guide.howTo.description}\n\n${guide.howTo.steps
        .map((step, index) => `${index + 1}. **${step.name}.** ${step.text}`)
        .join('\n')}`
    : '';
  const faqs = guide.faqs
    .map((faq) => `### ${faq.question}\n\n${faq.answer}`)
    .join('\n\n');
  return `# ${guide.h1}\n\n${guide.directAnswer}\n\n${sections}${howTo}\n\n## Frequently asked questions\n\n${faqs}\n\n## Disclosure\n\n${AI_DISCLOSURE}`;
}

export function llmsFullTxt(): string {
  const body = GUIDES.map((guide) => guideMarkdown(guide)).join('\n\n---\n\n');
  return `# ${CANONICAL_NAME} — homeowner guides\n\n> ${CANONICAL_ONE_SENTENCE}\n\n${CANONICAL_STAGE} ${TESLA_DISCLAIMER}\n\nThis file is the full text of the guides at ${CANONICAL_URL}/guides. It is generated from the same objects as the HTML. It lists no shops, license numbers, reviews, or prices.\n\n---\n\n${body}\n`;
}

/**
 * The three tools apps/mcp registers, and nothing else. geo.spec.ts
 * checks these names against apps/mcp/src/server.ts. `qualify` and
 * `get_quote` are not tools.
 */
export const MCP_TOOLS = [
  {
    name: 'find_contractors',
    access: 'read-only',
    description:
      'Defined to return verified shops for a service near a city or ZIP. The only implementation is mock data. Uncovered areas are specified to return an empty list, never a padded one.',
  },
  {
    name: 'start_quote',
    access: 'read-only',
    description:
      'Defined to open a quote session on the shop’s pricing engine. Returns no price until the questions are answered. The only implementation is mock data; it is not the seeded pricing engine and its optional params are an untyped record.',
  },
  {
    name: 'request_booking',
    access: 'write',
    description:
      'Defined to require an explicit per-shop, per-field sharing grant with a contact path, and to return a sharing receipt. The prototype does not write into the product database.',
  },
] as const;

export function agentCard(): {
  name: string;
  url: string;
  description: string;
  stage: string;
  updated: string;
  llms_txt: string;
  llms_full_txt: string;
  openapi: string;
  guides: string;
  contact: string;
  tesla: string;
  directory: {
    public_shop_listings: false;
    rollout_focus: string;
    note: string;
  };
  mcp: {
    server_name: string;
    deployed: false;
    data_mode: 'mock_only';
    directory_listing: 'not_submitted';
    tools: Array<{ name: string; access: string; description: string }>;
    not_tools: string[];
  };
  booking: {
    available_on_greenput_com: false;
    note: string;
  };
} {
  return {
    name: CANONICAL_NAME,
    url: CANONICAL_URL,
    description: CANONICAL_ONE_SENTENCE,
    stage: CANONICAL_STAGE,
    updated: GEO_UPDATED,
    llms_txt: `${CANONICAL_URL}/llms.txt`,
    llms_full_txt: `${CANONICAL_URL}/llms-full.txt`,
    openapi: `${CANONICAL_URL}/openapi.json`,
    guides: `${CANONICAL_URL}/guides`,
    contact: `${CANONICAL_URL}/contact`,
    tesla: TESLA_DISCLAIMER,
    directory: {
      public_shop_listings: false,
      rollout_focus: 'Orange County, California',
      note: 'No verified shop is published on greenput.com. The /ai page walkthrough is labeled demo data.',
    },
    mcp: {
      server_name: 'greenput-discovery',
      deployed: false,
      data_mode: 'mock_only',
      directory_listing: 'not_submitted',
      tools: MCP_TOOLS.map((tool) => ({ ...tool })),
      not_tools: ['qualify', 'get_quote'],
    },
    booking: {
      available_on_greenput_com: false,
      note: 'Booking runs on a contractor tenant site once a shop has published hours. This origin does not accept a booking.',
    },
  };
}

export function openApiDocument(): Record<string, unknown> {
  const paths: Record<string, unknown> = {};
  const addGet = (path: string, summary: string, mediaType: string): void => {
    paths[path === '/' ? '/' : path] = {
      get: {
        summary,
        operationId: `get_${path.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root'}`,
        responses: {
          '200': {
            description: summary,
            content: { [mediaType]: { schema: { type: 'string' } } },
          },
        },
      },
    };
  };
  addGet('/llms.txt', 'Curated site summary for assistants', 'text/plain');
  addGet('/llms-full.txt', 'Full homeowner guides', 'text/plain');
  addGet(
    '/agents.json',
    'Agent card, including MCP deployment status',
    'application/json',
  );
  addGet('/openapi.json', 'This document', 'application/json');
  addGet('/sitemap.xml', 'Sitemap', 'application/xml');
  addGet('/robots.txt', 'Crawler policy', 'text/plain');
  for (const page of CORE_PAGES) {
    addGet(page.path, page.blurb, 'text/html');
  }
  for (const guide of GUIDES) {
    addGet(guide.path, guide.directAnswer, 'text/html');
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Greenput public site',
      version: GEO_UPDATED,
      description:
        'Read-only description of greenput.com for assistants. There is no booking, lead, or payment operation on this origin. The MCP server named in /agents.json is not deployed. ' +
        TESLA_DISCLAIMER,
    },
    servers: [{ url: CANONICAL_URL }],
    paths,
  };
}
