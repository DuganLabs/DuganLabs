import { documentLocation } from './document-redirect';
import { render } from '@basenative/server';
import { raw } from '@basenative/runtime';
import { resolveRoute } from '@basenative/router';
import {
  layoutTemplate,
  homeTemplate,
  featuresTemplate,
  pricingTemplate,
  contactTemplate,
  aboutTemplate,
  privacyTemplate,
  termsTemplate,
  technologyTemplate,
  aiTemplate,
  investorsTemplate,
  notFoundTemplate,
} from './templates.js';
import {
  homeContext,
  featuresContext,
  pricingContext,
  contactContext,
  aboutContext,
  technologyContext,
  aiContext,
  investorsContext,
} from './page-data.js';
import { OG_IMAGES } from './og-images.js';
import { gp4Density, gp4Shell } from './gp4-shell.js';
import { siteStyles, siteScript } from './styles.js';
import { handleContactForm } from './contact.js';
import type { Env } from './env.js';
import { securityHeaders } from './security.js';
import { CANONICAL_ONE_SENTENCE, CANONICAL_URL } from './geo/entity.js';
import { GUIDES, guideByRoute } from './geo/guides.js';
import { renderGuide } from './geo/render.js';
import {
  agentCard,
  llmsFullTxt,
  llmsTxt,
  openApiDocument,
  robotsTxt,
  sitemapXml,
} from './geo/documents.js';
import {
  faqLd,
  guideJsonLd,
  organizationLd,
  pricingServiceLd,
  serializeJsonLd,
  websiteLd,
  type JsonLd,
} from './geo/schema.js';

const SITE_ORIGIN = CANONICAL_URL;

// Org favicon — output of `bn-favicon render greenput` (@basenative/favicon preset).
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" role="img" aria-label="Favicon"><defs><clipPath id="bn-fav-clip"><circle cx="512" cy="512" r="512"/></clipPath></defs><circle cx="512" cy="512" r="512" fill="#0F0E0C"/><g clip-path="url(#bn-fav-clip)"><path d="M820 200 C 820 200 540 180 380 340 C 220 500 200 760 200 820 C 280 820 540 800 700 640 C 860 480 820 200 820 200 Z" fill="#4EAF7C"/><path d="M780 240 L 280 800" stroke="#0F0E0C" stroke-width="28" stroke-linecap="round" fill="none"/><path d="M620 280 L 460 460" stroke="#0F0E0C" stroke-width="18" stroke-linecap="round" fill="none" opacity="0.7"/><path d="M460 460 L 320 600" stroke="#0F0E0C" stroke-width="18" stroke-linecap="round" fill="none" opacity="0.7"/></g></svg>`;

// HTML routes. Guides are appended from geo/guides.ts so a new guide is
// a route, a sitemap URL, and an llms.txt link together.
const routes = [
  { path: '/', name: 'home' },
  { path: '/features', name: 'features' },
  { path: '/pricing', name: 'pricing' },
  { path: '/contact', name: 'contact' },
  { path: '/about', name: 'about' },
  { path: '/technology', name: 'technology' },
  { path: '/ai', name: 'ai' },
  { path: '/investors', name: 'investors' },
  { path: '/privacy', name: 'privacy' },
  { path: '/terms', name: 'terms' },
  ...GUIDES.map((guide) => ({ path: guide.path, name: guide.route })),
];

const STATIC_ASSETS: Record<string, { content: string; contentType: string }> =
  {
    '/css/styles.css': {
      content: siteStyles,
      contentType: 'text/css; charset=utf-8',
    },
    '/js/app.js': {
      content: siteScript,
      contentType: 'application/javascript; charset=utf-8',
    },
  };

function getPageTemplate(
  routeName: string,
  overrides: Record<string, unknown> = {},
): {
  template: string;
  context: Record<string, unknown>;
  title: string;
  description: string;
  /** Guide bodies are already rendered; the template renderer is skipped. */
  bodyHtml?: string;
  jsonLd?: JsonLd[];
} {
  const page = getPageDefinition(routeName);
  return { ...page, context: { ...page.context, ...overrides } };
}

function getPageDefinition(routeName: string): {
  template: string;
  context: Record<string, unknown>;
  title: string;
  description: string;
  bodyHtml?: string;
  jsonLd?: JsonLd[];
} {
  const guide = guideByRoute(routeName);
  if (guide) {
    return {
      template: '',
      context: {},
      title: guide.title,
      description: guide.description,
      bodyHtml: renderGuide(guide),
      jsonLd: guideJsonLd(guide),
    };
  }
  switch (routeName) {
    case 'features':
      return {
        template: featuresTemplate,
        context: featuresContext,
        title: 'Features',
        description:
          'Lead management, job scheduling, and invoicing for trade contractors. The customer portal is not shipped yet.',
      };
    case 'pricing':
      return {
        template: pricingTemplate,
        context: pricingContext,
        title: 'Pricing',
        // The abstract lives with the page’s copy, not here (GP-045).
        description: pricingContext.description,
      };
    case 'contact':
      return {
        template: contactTemplate,
        context: contactContext,
        title: 'Contact',
        description:
          'Get in touch with the Greenput team. Questions, demos, or partnerships — we’d love to hear from you.',
      };
    case 'about':
      return {
        template: aboutTemplate,
        context: aboutContext,
        title: 'About',
        description:
          'Learn about Greenput — built for trade contractors by people who respect the work.',
      };
    case 'technology':
      return {
        template: technologyTemplate,
        context: technologyContext,
        title: 'Technology',
        description:
          'Measured Lighthouse scores, Core Web Vitals, and page weight for a live Greenput reference site — real numbers, not marketing claims.',
      };
    case 'ai':
      return {
        template: aiTemplate,
        context: aiContext,
        title: 'Greenput for AI Assistants',
        description:
          'The Greenput MCP server is a prototype on mock data, not listed in ChatGPT or Claude. Illustrated booking, plus the sharing grant.',
      };
    case 'investors':
      return {
        template: investorsTemplate,
        context: investorsContext,
        title: 'For Investors',
        description:
          'Greenput is raising $1M on a standard YC post-money SAFE — cap-only, $8M cap, no discount, no MFN. The model, the Tesla installer wedge, and where the product stands.',
      };
    case 'privacy':
      return {
        template: privacyTemplate,
        context: {},
        title: 'Privacy Policy',
        description:
          'How Greenput collects, uses, and protects the information you share with us.',
      };
    case 'terms':
      return {
        template: termsTemplate,
        context: {},
        title: 'Terms of Service',
        description:
          'The terms that govern your use of the Greenput marketing site.',
      };
    default:
      return {
        template: homeTemplate,
        context: homeContext,
        title: 'The Operating System for Trade Contractors',
        description: CANONICAL_ONE_SENTENCE,
      };
  }
}

/**
 * The route’s dedicated Open Graph card. Cards live in og-images.ts as
 * base64 PNGs (the change pipeline for this app is text-only, so binary
 * assets can’t ride along); the /og/<slug>.png route below decodes and
 * serves the same bytes the meta tags point at. Unknown routes fall back
 * to the home card.
 */
function ogCardFor(routeName: string): { url: string; alt: string } {
  const slug = OG_IMAGES[routeName] ? routeName : 'home';
  return {
    url: `${SITE_ORIGIN}/og/${slug}.png`,
    alt: OG_IMAGES[slug]?.alt ?? '',
  };
}

/**
 * The full HTML document for one marketing route: page template inside the
 * layout, JSON-LD spliced in under `nonce`. `overrides` are spread over the
 * route’s context so a handler can re-render a page in a different state —
 * POST /contact uses it for the submitted / rejected form (GP-004) — without
 * duplicating the layout and structured-data plumbing here.
 */
export function renderMarketingPage(
  routeName: string,
  nonce: string,
  overrides: Record<string, unknown> = {},
): string {
  const { template, context, title, description, bodyHtml, jsonLd } =
    getPageTemplate(routeName, overrides);

  // Render page content with BaseNative SSR. Guides pass pre-rendered
  // HTML so their copy is not a second template that can drift from
  // llms-full.txt.
  const pageContent = bodyHtml ?? render(template, context);

  const canonicalPath =
    routes.find((route) => route.name === routeName)?.path ?? '/';
  const canonicalUrl = `${SITE_ORIGIN}${canonicalPath === '/' ? '' : canonicalPath}`;

  // Every marketing document uses the v4 shell. routeName is the nav’s
  // current-route key; routes outside the nav simply match nothing.
  const layoutContext = {
    pageTitle: title,
    pageDescription: description,
    // Already-rendered markup: mark it raw or the renderer escapes it to text.
    shellHtml: raw(gp4Shell(pageContent, routeName)),
    gp4Flag: '1',
    gp4DensityAttr: gp4Density(routeName),
    gp4: true,
    canonicalUrl,
    hasCanonical: true,
    noindex: false,
    ogImageUrl: ogCardFor(routeName).url,
    ogImageAlt: ogCardFor(routeName).alt,
  };

  // BaseNative server skips <script> interpolation for type !== 'application/json',
  // so we splice the JSON-LD block(s) in post-render via a comment marker.
  // Organization and WebSite run on every page, from geo/entity.ts.
  // /pricing adds FAQPage from the same faqs the page renders, plus the
  // contractor Service. Guides add their own FAQ, HowTo, Service, and
  // breadcrumb from the same objects as the visible copy.
  const structuredDataPayloads = [
    serializeJsonLd(organizationLd()),
    serializeJsonLd(websiteLd()),
    ...(routeName === 'pricing'
      ? [
          serializeJsonLd(faqLd(pricingContext.faqs)),
          serializeJsonLd(pricingServiceLd()),
        ]
      : []),
    ...(jsonLd ?? []).map((block) => serializeJsonLd(block)),
  ];
  const layout = render(layoutTemplate, layoutContext);
  return layout.replace(
    '<!--__STRUCTURED_DATA__-->',
    structuredDataPayloads
      .map(
        (json) =>
          `<script type="application/ld+json" nonce="${nonce}">${json}</script>`,
      )
      .join('\n'),
  );
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    // Quote, proposal, and invoice are tenant pages. Resolve them before
    // the apex 404, including on www so that host does not answer first.
    const documents = await documentLocation(
      url.hostname,
      url.pathname,
      url.search,
      env.DB,
    );
    if (documents) {
      return Response.redirect(
        documents,
        request.method === 'GET' || request.method === 'HEAD' ? 302 : 307,
      );
    }
    // Apex is canonical. www serving the same 200 leaves two hosts for
    // an assistant to reconcile. Redirect before any other routing.
    if (url.hostname === 'www.greenput.com') {
      url.hostname = 'greenput.com';
      return Response.redirect(url.toString(), 301);
    }
    const pathname = url.pathname;
    // Per-request nonce so the CSP can allow the one inline (JSON-LD) script
    // without a blanket 'unsafe-inline' being the only thing gating it.
    const nonce = crypto.randomUUID().replace(/-/g, '');

    // Contact form submission: persisted to D1, then notified (see contact.ts).
    if (pathname === '/contact' && request.method === 'POST') {
      return handleContactForm(request, env, ctx, nonce);
    }

    // Per-route Open Graph cards (og-images.ts). Unknown slugs fall
    // through to route matching and 404 like any other missing page.
    if (pathname.startsWith('/og/') && pathname.endsWith('.png')) {
      const slug = pathname.slice('/og/'.length, -'.png'.length);
      const card = OG_IMAGES[slug];
      if (card) {
        const bytes = Uint8Array.from(atob(card.base64), (c) =>
          c.charCodeAt(0),
        );
        return new Response(bytes.buffer as ArrayBuffer, {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=86400',
          },
        });
      }
    }

    // Serve static assets
    if (pathname === '/favicon.svg') {
      return new Response(FAVICON_SVG, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    // CSS routes
    if (pathname.startsWith('/css/') || pathname.startsWith('/js/')) {
      const asset = STATIC_ASSETS[pathname];
      if (asset) {
        return new Response(asset.content, {
          headers: {
            'Content-Type': asset.contentType,
            'Cache-Control':
              pathname.startsWith('/css/') && url.searchParams.has('v')
                ? 'public, max-age=31536000, immutable'
                : pathname.startsWith('/css/')
                  ? 'public, max-age=300, must-revalidate'
                  : 'public, max-age=3600',
            ...securityHeaders(),
          },
        });
      }
    }

    const textDocument = (body: string, contentType: string): Response =>
      new Response(body, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400',
          ...securityHeaders(),
        },
      });

    // llms.txt and llms-full.txt are generated from the guides, so they
    // cannot describe a page that does not exist.
    if (pathname === '/llms.txt') {
      return textDocument(llmsTxt(), 'text/plain; charset=utf-8');
    }
    if (pathname === '/llms-full.txt') {
      return textDocument(llmsFullTxt(), 'text/plain; charset=utf-8');
    }
    if (pathname === '/robots.txt') {
      return textDocument(robotsTxt(), 'text/plain; charset=utf-8');
    }
    if (pathname === '/sitemap.xml') {
      return textDocument(sitemapXml(), 'application/xml; charset=utf-8');
    }
    if (pathname === '/agents.json') {
      return textDocument(
        `${JSON.stringify(agentCard(), null, 2)}\n`,
        'application/json; charset=utf-8',
      );
    }
    if (pathname === '/openapi.json') {
      return textDocument(
        `${JSON.stringify(openApiDocument(), null, 2)}\n`,
        'application/json; charset=utf-8',
      );
    }

    // Route matching. resolveRoute never returns null itself — for an
    // unmatched path it returns { name: null, matched: null, path: pathname }
    // — so the emptiness check has to be on `.name`, not on the result.
    const matched = resolveRoute(routes, pathname);

    if (!matched.name) {
      const pageContent = render(notFoundTemplate, {});
      const layoutContext = {
        pageTitle: 'Page Not Found',
        pageDescription:
          'The page you’re looking for doesn’t exist or has moved.',
        shellHtml: raw(gp4Shell(pageContent, 'not-found')),
        gp4Flag: '1',
        gp4DensityAttr: 'spacious',
        gp4: true,
        canonicalUrl: '',
        hasCanonical: false,
        noindex: true,
        ogImageUrl: ogCardFor('home').url,
        ogImageAlt: ogCardFor('home').alt,
      };
      // No Organization structured data on a 404 — just drop the marker.
      const html = render(layoutTemplate, layoutContext).replace(
        '<!--__STRUCTURED_DATA__-->',
        '',
      );
      return new Response(html, {
        status: 404,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          ...securityHeaders(nonce),
        },
      });
    }

    const html = renderMarketingPage(matched.name, nonce);

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=3600',
        Link: `<${SITE_ORIGIN}/llms.txt>; rel="describedby", <${SITE_ORIGIN}/llms-full.txt>; rel="describedby"`,
        ...securityHeaders(nonce),
      },
    });
  },
};
