import { Env } from './env';
import {
  LEAD_FORM_ERRORS,
  isLeadFormErrorKey,
  leadFormOutcomeFrom,
  renderTenantPage,
  renderTenantErrorPage,
  renderTenantErrorShell,
  type TenantErrorShellOptions,
  type WorkspaceData,
  isKnownTenantPath,
  tenantStylesMin,
  tenantScript,
} from './render';
import { renderProposalPage } from './proposal';
import { minifyCss } from '@greenput/shared/design';
import {
  DEPOSIT_PATH,
  INVOICE_PATH,
  RESERVED_SUBDOMAINS,
  type WeekdayHours,
} from '@greenput/shared/utils';
import {
  generateInvoiceHtml,
  type InvoiceCustomerRow,
  type InvoiceJobRow,
  type InvoiceLineItemRow,
  type InvoiceWorkspaceRow,
} from '@greenput/shared/documents';
import { intakeStyles } from './intake';
import { handleQuoteRequest, isQuotePath } from './intake-routes';
import { carryPreviewSlug } from './preview-slug';
import { listPublishedFlows, type D1Like } from '@greenput/shared/pricing';
import {
  CONSENT_TEXT_FORM_V1,
  recordConsent,
  type ConsentField,
  type D1Like as ConsentD1Like,
} from '@greenput/shared/consent';
import { resetIds } from '@basenative/components';
import { z } from 'zod';

// Hostnames this Worker owns and resolves tenants for by subdomain slug (or
// ?slug= in preview). Anything else is treated as a candidate contractor-
// owned custom domain — see the custom-hostname branch in fetch() below.
const GREENPUT_HOST_SUFFIXES = [
  '.greenput.com',
  '.greenput.site',
  '.workers.dev',
];
const GREENPUT_BARE_HOSTS = new Set(['greenput.com', 'greenput.site']);

function isGreenputHost(hostname: string): boolean {
  return (
    GREENPUT_BARE_HOSTS.has(hostname) ||
    GREENPUT_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  );
}

/**
 * Where a reserved subdomain is really served from.
 *
 * Only needed because this Worker now holds the `*.greenput.com/*` wildcard: a
 * hostname in RESERVED_SUBDOMAINS is never a tenant, and answering 404 for it
 * is right for `mail` or `fallback` but catastrophic for the one that is the
 * product's front door. `app` is a Cloudflare Pages custom domain, so if the
 * wildcard route ever outranks that binding the request lands here instead —
 * and a 404 would mean nobody can sign in.
 *
 * Not a general reverse proxy: one entry, for the one hostname whose only
 * binding is a kind the wildcard could plausibly beat. `www`/apex are more
 * specific marketing routes, so they never reach this code. `api` USED to be
 * only a Worker Custom Domain, and the wildcard route DID beat it — from
 * #147 until 2026-09-14 api.greenput.com was answered by this Worker's 404
 * page — so apps/api/wrangler.toml now also carries an exact
 * `api.greenput.com/*` route, which outranks the wildcard by specificity.
 * That is the fix for `api`, not an entry here: the API must never be
 * reached through a second hop.
 */
const RESERVED_ORIGINS: Record<string, string> = {
  app: 'greenput-app.pages.dev',
};

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  trade: string;
  phone: string;
  email: string;
  logo_url: string | null;
  street: string;
  city: string;
  state: string;
  zip: string;
  license_num: string | null;
  custom_hostname: string | null;
  custom_domain_status: string | null;
}

const WORKSPACE_COLUMNS =
  'id, name, slug, trade, phone, email, logo_url, street, city, state, zip, license_num, custom_hostname, custom_domain_status';

/** One `workspace_availability` row as D1 returns it (schema.sql, GP-101). */
interface AvailabilityRow {
  weekday: number;
  opens_at: string | null;
  closes_at: string | null;
  is_open: number;
}

// The org leaf, not a generic tick — same mark the platform and greenput.com
// use, so a contractor's tab reads as part of one family.
const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="5" fill="#0F0E0C"/><path d="M19.22 4.69C19.22 4.69 12.66 4.22 8.91 7.97C5.16 11.72 4.69 17.81 4.69 19.22C6.56 19.22 12.66 18.75 16.41 15C20.16 11.25 19.22 4.69 19.22 4.69Z" fill="#4EAF7C"/><path d="M18.28 5.63L6.56 18.75" stroke="#0F0E0C" stroke-width="0.66" stroke-linecap="round"/></svg>`;

interface SecurityHeaderOptions {
  /** Per-request CSP nonce for the page's inline JSON-LD. */
  nonce?: string;
  // WS-0: the Stripe allowance that used to be an option here existed
  // only for the removed booking-deposit confirmation page. No page on
  // a tenant site loads Stripe.js or calls Stripe's API any more, so
  // the policy has no Stripe case to open.
}

function securityHeaders(
  options: SecurityHeaderOptions = {},
): Record<string, string> {
  const { nonce } = options;
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ''} 'unsafe-inline' https://static.cloudflareinsights.com`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      // fonts.googleapis.com: Cloudflare's bot-detection script re-fetches the
      // Google Fonts stylesheet href and needs connect-src to allow it.
      // static.cloudflareinsights.com: its own analytics beacon.
      `connect-src 'self' https://fonts.googleapis.com https://static.cloudflareinsights.com`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      'upgrade-insecure-requests',
    ].join('; '),
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // No 'bluetooth' — Chromium doesn't recognise it and just logs a
    // warning. The camera is denied on every route: the tenant site has no
    // session, so nothing on it may read the device (GP-022).
    'Permissions-Policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
}

function renderPreviewLanding(demoUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Greenput — Tenant Site Preview</title>
  <meta name="robots" content="noindex, nofollow">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Serif+Display&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DM Sans', system-ui, sans-serif; background: hsl(220 15% 10%); color: hsl(220 15% 94%); min-height: 100dvh; display: grid; place-items: center; padding: 1.5rem; }
    .card { background: hsl(220 15% 14%); border: 1px solid hsl(220 15% 20%); border-radius: 1rem; padding: 2.5rem; max-width: 32rem; width: 100%; text-align: center; }
    h1 { font-family: 'DM Serif Display', serif; font-size: 2rem; margin-block-end: 1rem; }
    p { color: hsl(220 10% 65%); margin-block-end: 1.5rem; }
    code { background: hsl(220 15% 18%); padding: .125rem .375rem; border-radius: .25rem; font-size: .875em; }
    a { display: inline-block; padding: .875rem 2rem; background: hsl(152 56% 35%); color: white; border-radius: .5rem; text-decoration: none; font-weight: 600; margin-block-start: 1rem; transition: background 150ms; }
    a:hover { background: hsl(152 56% 28%); }
  </style>
</head>
<body>
  <div class="card">
    <h1>Tenant Site Preview</h1>
    <p>No slug detected. Use <code>?slug=demo</code> or visit a contractor subdomain like <code>acme.greenput.com</code>.</p>
    <a href="${demoUrl.replace(/"/g, '&quot;')}">Open Demo Tenant →</a>
  </div>
</body>
</html>`;
}

// Shape/length validation only. Contact-detail rules (email format, phone
// digits, "at least one of email/phone") produce field-specific messages in
// validateLead below so the form can focus the offending input.
const LeadSubmissionSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().max(255).optional().default(''),
  phone: z.string().trim().max(30).optional().default(''),
  serviceType: z.string().trim().max(100).optional().default(''),
  notes: z.string().trim().max(5000).optional().default(''),
  website: z.string().optional().default(''), // honeypot field
  // The consent checkbox (render.ts): 'yes' when ticked, absent when not.
  // Ticked → a consent_records row (CONSENT_TEXT_FORM_V1); unticked → no
  // record, and no consumer SMS may be sent to this lead.
  consent: z.string().optional().default(''),
  // The separate network-reroute opt-in (grant model): its own checkbox,
  // never bundled into the contact consent above.
  consentReroute: z.string().optional().default(''),
});

type LeadSubmission = z.infer<typeof LeadSubmissionSchema>;

interface LeadValidationError {
  field: string;
  message: string;
  /** Key into LEAD_FORM_ERRORS; the `error` value a form POST redirects with. */
  reason: string;
}

// One definition for both paths: the JSON body carries the message, the
// no-JavaScript redirect carries the key and render.ts looks it up (GP-004).
const FIELD_MESSAGES = LEAD_FORM_ERRORS;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateLead(
  raw: unknown,
):
  | { ok: true; data: LeadSubmission }
  | { ok: false; error: LeadValidationError } {
  const parsed = LeadSubmissionSchema.safeParse(raw);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path[0] ?? 'firstName');
    const reason = isLeadFormErrorKey(field) ? field : 'unknown';
    return {
      ok: false,
      error: { field, reason, message: FIELD_MESSAGES[reason] },
    };
  }

  const { email, phone } = parsed.data;
  if (email && !EMAIL_PATTERN.test(email)) {
    return {
      ok: false,
      error: { field: 'email', reason: 'email', message: FIELD_MESSAGES.email },
    };
  }
  if (phone && phone.replace(/\D/g, '').length < 10) {
    return {
      ok: false,
      error: { field: 'phone', reason: 'phone', message: FIELD_MESSAGES.phone },
    };
  }
  if (!email && !phone) {
    return {
      ok: false,
      error: {
        field: 'email',
        reason: 'contact',
        message: FIELD_MESSAGES.contact,
      },
    };
  }

  return { ok: true, data: parsed.data };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...securityHeaders() },
  });
}

/**
 * Bare 404 for any host/slug this Worker can't resolve to a workspace — the
 * one error with nothing to brand. Everything after host resolution goes
 * through `errorShellResponse` instead (GP-040).
 */
function notFoundPage(title: string, message: string): Response {
  return new Response(renderTenantErrorPage(title, message), {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...securityHeaders(),
    },
  });
}

/**
 * A 404 that is still the contractor's site: nav, footer, phone and the
 * actions the caller names (GP-040). Never cached — every one of these is
 * a capability URL that may become valid, or stop being, at any moment.
 */
function errorShellResponse(
  workspace: WorkspaceData,
  options: TenantErrorShellOptions,
): Response {
  return new Response(renderTenantErrorShell(workspace, options), {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      ...securityHeaders(),
    },
  });
}

/** An expired link is a reason to talk to the contractor. */
const REACH_OUT_ACTIONS: TenantErrorShellOptions['actions'] = [
  { href: '/', label: 'Back to home' },
  { href: '/contact', label: 'Get in touch' },
];

const INVOICE_NOT_FOUND: TenantErrorShellOptions = {
  title: 'Invoice Not Found',
  message: 'This invoice link is invalid or has expired.',
  actions: REACH_OUT_ACTIONS,
};

/**
 * The plain not-found shell for a link to a page this site no longer
 * has (WS-0: /deposit/<token>). Deliberately generic — the shell must
 * not name the removed surface or its copy.
 */
const PAGE_NOT_FOUND: TenantErrorShellOptions = {
  title: 'Page Not Found',
  message: 'This page does not exist on this site.',
  actions: REACH_OUT_ACTIONS,
};

/** A browser-submitted form, as opposed to the page's own JSON fetch(). */
function isFormEncoded(request: Request): boolean {
  const contentType = request.headers.get('content-type') ?? '';
  return (
    contentType.startsWith('application/x-www-form-urlencoded') ||
    contentType.startsWith('multipart/form-data')
  );
}

/**
 * POST-redirect-GET for the no-JavaScript path (GP-004): the browser lands
 * on /contact with the outcome in the query, never with the visitor's
 * details in it. render.ts maps `error`/`field` to fixed copy.
 */
function redirectToContact(params: Record<string, string>): Response {
  const query = new URLSearchParams(params).toString();
  return new Response(null, {
    status: 303,
    headers: {
      Location: `/contact${query ? `?${query}` : ''}`,
      ...securityHeaders(),
    },
  });
}

/**
 * POST /leads. Accepts the page's JSON fetch() and a plain form post, and
 * answers each in kind: JSON, or a 303 to /contact carrying the outcome.
 * Validation and the honeypot behave identically on both.
 */
async function handleLeadSubmission(
  request: Request,
  env: Env,
  workspace: { id: string; slug: string },
): Promise<Response> {
  const asForm = isFormEncoded(request);
  const raw: unknown = asForm
    ? await request
        .formData()
        .then((formData) => {
          const fields: Record<string, FormDataEntryValue> = {};
          formData.forEach((value, key) => {
            fields[key] = value;
          });
          return fields;
        })
        .catch(() => ({}))
    : await request.json().catch(() => ({}));
  const validated = validateLead(raw);

  if (validated.ok === false) {
    const { field, reason, message } = validated.error;
    return asForm
      ? redirectToContact({ error: reason, field })
      : jsonResponse(
          { ok: false, error: { code: 'VALIDATION_ERROR', field, message } },
          400,
        );
  }

  const {
    firstName,
    lastName,
    email,
    phone,
    serviceType,
    notes,
    website,
    consent,
    consentReroute,
  } = validated.data;

  // Honeypot: pretend success so bots learn nothing.
  if (website) {
    return asForm
      ? redirectToContact({ sent: '1' })
      : jsonResponse({ ok: true });
  }

  try {
    // leads.created_by is a NOT NULL foreign key to users(id): attribute the
    // website lead to the workspace owner (or the most senior member).
    const attributedTo = await env.DB.prepare(
      `SELECT id FROM users WHERE workspace_id = ?
       ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, created_at
       LIMIT 1`,
    )
      .bind(workspace.id)
      .first<{ id: string }>();

    if (!attributedTo) {
      console.error('tenant-site lead submission failed', {
        workspaceId: workspace.id,
        slug: workspace.slug,
        reason: 'workspace has no users to attribute the lead to',
      });
      return asForm
        ? redirectToContact({ error: 'WORKSPACE_NOT_READY' })
        : jsonResponse(
            {
              ok: false,
              error: {
                code: 'WORKSPACE_NOT_READY',
                message: FIELD_MESSAGES.WORKSPACE_NOT_READY,
              },
            },
            500,
          );
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // Optional columns are NOT NULL DEFAULT '' in schema.sql, so bind the
    // empty string rather than null.
    await env.DB.prepare(
      `INSERT INTO leads (
         id, workspace_id, first_name, last_name, email, phone, preferred_contact,
         status, source, service_type, notes, created_at, updated_at, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 'website', ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        workspace.id,
        firstName,
        lastName,
        email,
        phone,
        email ? 'email' : 'phone',
        serviceType,
        notes,
        now,
        now,
        attributedTo.id,
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
       VALUES (?, ?, ?, 'lead', ?, 'created', ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        workspace.id,
        attributedTo.id,
        id,
        JSON.stringify({ source: 'tenant_site' }),
        now,
      )
      .run();

    // Consent capture: the checkbox was ticked. Logged, not thrown — a
    // consent-write failure must not eat the lead the consumer sent.
    if (consent === 'yes') {
      try {
        const fields: ConsentField[] = ['name', 'job_details'];
        if (phone) fields.push('phone');
        if (email) fields.push('email');
        await recordConsent({
          db: env.DB as unknown as ConsentD1Like,
          newId: () => crypto.randomUUID(),
          workspaceId: workspace.id,
          leadId: id,
          consumerPhone: phone,
          consumerEmail: email,
          fields,
          source: 'tenant_site_form',
          consentText: CONSENT_TEXT_FORM_V1,
          allowNetworkReroute: consentReroute === 'yes',
          now,
        });
      } catch (err) {
        console.error('tenant-site consent capture failed', {
          workspaceId: workspace.id,
          leadId: id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return asForm
      ? redirectToContact({ sent: '1' })
      : jsonResponse({ ok: true, id });
  } catch (err) {
    console.error('tenant-site lead submission failed', {
      workspaceId: workspace.id,
      slug: workspace.slug,
      error: err instanceof Error ? err.message : String(err),
    });
    return asForm
      ? redirectToContact({ error: 'INTERNAL' })
      : jsonResponse(
          {
            ok: false,
            error: { code: 'INTERNAL', message: FIELD_MESSAGES.INTERNAL },
          },
          500,
        );
  }
}

// ProposalWorkspace and ProposalLineItem types are re-exported from ./proposal

/** Everything the Worker answers, before the preview-slug pass below. */
const site = {
  async fetch(request: Request, env: Env): Promise<Response> {
    // @basenative/components draws element ids from a module-level counter;
    // restart it per request so every response renders byte-identical ids.
    resetIds();
    const url = new URL(request.url);
    const pathname = url.pathname;
    // Per-request nonce for the page's inline JSON-LD.
    const nonce = crypto.randomUUID().replace(/-/g, '');

    // Serve favicon inline
    if (pathname === '/favicon.svg' || pathname === '/favicon.ico') {
      return new Response(FAVICON_SVG, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=86400',
        },
      });
    }

    // Serve CSS
    if (pathname === '/css/styles.css') {
      // One stylesheet for the whole tenant site, quote form included — a
      // second request would cost the form a round trip on a phone. Both halves
      // go through minifyCss so the rationale stays in the source and off the
      // homeowner's connection.
      return new Response(tenantStylesMin + minifyCss(intakeStyles), {
        headers: {
          'Content-Type': 'text/css; charset=utf-8',
          'Cache-Control': url.searchParams.has('v')
            ? 'public, max-age=31536000, immutable'
            : 'public, max-age=300, must-revalidate',
          ...securityHeaders(),
        },
      });
    }

    // Serve JS
    if (pathname === '/js/app.js') {
      return new Response(tenantScript, {
        headers: {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
          ...securityHeaders(),
        },
      });
    }

    // robots.txt — let crawlers index every public-facing tenant page
    // and skip the lead-submission endpoint.
    if (pathname === '/robots.txt') {
      const origin = `${url.protocol}//${url.host}`;
      return new Response(
        `User-agent: *\nAllow: /\nDisallow: /leads\nDisallow: /quote/s/\nDisallow: /deposit/\nSitemap: ${origin}/sitemap.xml\n`,
        {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=86400',
            ...securityHeaders(),
          },
        },
      );
    }

    // sitemap.xml — public pages only.
    if (pathname === '/sitemap.xml') {
      const origin = `${url.protocol}//${url.host}`;
      const lastmod = new Date().toISOString().slice(0, 10);
      const paths = [
        '/',
        '/services',
        '/about',
        '/contact',
        '/quote',
        '/proposal',
        '/invoice',
      ];
      const urls = paths
        .map(
          (p) =>
            `  <url>\n    <loc>${origin}${p === '/' ? '' : p}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`,
        )
        .join('\n');
      const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
      return new Response(body, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
          ...securityHeaders(),
        },
      });
    }

    // ── Resolve the workspace for this request's Host header ───
    // Two ways a hostname maps to a workspace, tried in order:
    //   (a) an exact, ACTIVE contractor custom domain (Cloudflare for
    //       SaaS) — checked first and ONLY for hosts we don't own, so a
    //       foreign domain can never fall through to slug parsing below
    //       and accidentally collide with an unrelated workspace's slug.
    //   (b) the <slug>.greenput.com subdomain every workspace gets by
    //       default. `?slug=` is honoured ONLY on a *.workers.dev preview
    //       host, where there is no subdomain to read; on a Greenput host
    //       it is ignored (not rejected — the subdomain's real site is the
    //       right answer), because until GP-023 a `?slug=` on
    //       demo.greenput.com served another contractor's site and filed
    //       the leads it captured into that other workspace.
    // A host that matches neither gets the same branded 404 either way.
    let workspace: WorkspaceRow | null;
    let matchedViaSubdomain = false;

    if (!isGreenputHost(url.hostname)) {
      // Requests only reach this Worker for a foreign hostname once the
      // contractor has CNAMEd it to Greenput's Cloudflare for SaaS
      // fallback origin AND Cloudflare has finished domain-control
      // validation + certificate issuance for it — both captured by
      // custom_domain_status = 'active'. Anything else (no row, or still
      // pending/verifying/failed) is treated as unresolved.
      workspace = await env.DB.prepare(
        `SELECT ${WORKSPACE_COLUMNS} FROM workspaces
         WHERE custom_hostname = ? AND custom_domain_status = 'active' LIMIT 1`,
      )
        .bind(url.hostname)
        .first<WorkspaceRow>();

      if (!workspace) {
        return notFoundPage('Not Found', 'This site could not be found.');
      }
    } else {
      // The slug comes from the subdomain; the query override exists for
      // workers.dev previews only (GP-023). Gated on the hostname the
      // request arrived on rather than on ENVIRONMENT, because the one
      // production Worker answers both the preview URL and the real hosts.
      const querySlug = url.searchParams.get('slug');
      const hostParts = url.hostname.split('.');
      const isWorkersDev = url.hostname.endsWith('.workers.dev');
      const subdomainSlug = isWorkersDev ? null : hostParts[0];
      const slug = (isWorkersDev ? querySlug : null) ?? subdomainSlug;

      if (!slug) {
        if (isWorkersDev) {
          return new Response(
            renderPreviewLanding(`${url.origin}/?slug=demo`),
            {
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                ...securityHeaders(),
              },
            },
          );
        }
        return notFoundPage('Not Found', 'This site could not be found.');
      }

      if (RESERVED_SUBDOMAINS.has(slug)) {
        // This Worker now holds `*.greenput.com/*` (wrangler.toml), which
        // matches the platform's own hostnames as well as every tenant's.
        // Most of them are bound more specifically elsewhere — api has an
        // exact route on the API Worker (a Custom Domain alone LOST to this
        // wildcard), www and the apex are marketing routes — and for those
        // this branch never runs. app.greenput.com is the one that
        // is only a Pages custom domain, and it is the only way anyone signs
        // in, so it is not a hostname to be clever about: if a request for it
        // does reach here, pass it to the Pages project rather than answering
        // 404 at the sign-in door.
        const origin = RESERVED_ORIGINS[slug];
        if (origin) {
          const upstream = new URL(request.url);
          upstream.hostname = origin;
          return fetch(new Request(upstream, request));
        }
        return notFoundPage('Not Found', 'This site could not be found.');
      }

      workspace = await env.DB.prepare(
        `SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE slug = ? LIMIT 1`,
      )
        .bind(slug)
        .first<WorkspaceRow>();

      if (!workspace) {
        return notFoundPage(
          'Workspace Not Found',
          "We couldn't find a site at this address.",
        );
      }

      matchedViaSubdomain = true;
    }

    // Canonical-domain redirect: once a contractor's custom domain is
    // verified and active, the subdomain becomes an alias for it. 301
    // every GET/HEAD page view over to the custom domain so search
    // engines and bookmarks consolidate there (see tenantOriginFor in
    // render.ts, which points canonical/OG tags the same way). POST
    // /leads is excluded so a form submitted from a page the visitor
    // already had open still lands.
    if (
      matchedViaSubdomain &&
      workspace.custom_domain_status === 'active' &&
      workspace.custom_hostname &&
      (request.method === 'GET' || request.method === 'HEAD') &&
      pathname !== '/leads'
    ) {
      const target = new URL(
        `${pathname}${url.search}`,
        `https://${workspace.custom_hostname}`,
      );
      return Response.redirect(target.toString(), 301);
    }

    // Handle lead form submission
    if (pathname === '/leads' && request.method === 'POST') {
      return handleLeadSubmission(request, env, workspace);
    }

    // ── The quote form ───────────────────────────────────────
    // Server-rendered, one screen per request, on this origin — the CSP's
    // `form-action 'self'` would block a form that posted to the API, and a
    // homeowner in a garage should not need JavaScript to answer a question.
    if (isQuotePath(pathname)) {
      const quote = await handleQuoteRequest(request, env, workspace);
      if (quote.kind === 'redirect') {
        return new Response(null, {
          status: 303,
          headers: { Location: quote.location, ...securityHeaders() },
        });
      }
      if (quote.kind === 'html') {
        return new Response(quote.html, {
          status: quote.status,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // A form in progress is one homeowner's, and the price at the end
            // is theirs alone. Never let a shared cache hold either.
            'Cache-Control': 'no-store',
            ...securityHeaders({ nonce }),
          },
        });
      }
    }

    // Read-only proposal view for customers
    const proposalMatch = pathname.match(/^\/proposal\/([a-f0-9-]+)$/);
    if (proposalMatch) {
      const estimateId = proposalMatch[1];
      const estimate = await env.DB.prepare(
        `SELECT e.*, o.title AS opportunity_title
         FROM estimates e
         LEFT JOIN opportunities o ON e.opportunity_id = o.id
         WHERE e.id = ? AND e.workspace_id = ? AND e.status IN ('sent', 'accepted')`,
      )
        .bind(estimateId, workspace.id)
        .first<Record<string, unknown>>();

      if (!estimate) {
        return errorShellResponse(workspace, {
          title: 'Proposal Not Found',
          message: 'This proposal link is invalid or has expired.',
          actions: REACH_OUT_ACTIONS,
        });
      }

      const lineItems = JSON.parse(
        (estimate['line_items'] as string) || '[]',
      ) as Array<{
        description: string;
        quantity: number;
        unitPrice: number;
        total: number;
      }>;

      const html = renderProposalPage(workspace, estimate, lineItems);
      return new Response(html, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'private, max-age=60',
          ...securityHeaders(),
        },
      });
    }

    // ── The public invoice (GP-008) ──────────────────────────
    // GET /invoice/<token>. The token is `jobs.invoice_token`, minted by
    // POST /api/jobs/:id/invoice and handed to the homeowner by the
    // contractor; it is the whole authorisation, so a wrong one is a 404
    // indistinguishable from a job that was never invoiced. Scoped to THIS
    // workspace as well, so a token cannot be replayed on another
    // contractor's site. Same HTML the contractor's own GET
    // /api/jobs/:id/invoice renders — one renderer, libs/shared/documents.
    if (pathname.startsWith(INVOICE_PATH) && request.method === 'GET') {
      const token = pathname.slice(INVOICE_PATH.length);
      const job = /^[a-f0-9-]{36}$/.test(token)
        ? await env.DB.prepare(
            `SELECT * FROM jobs
             WHERE invoice_token = ? AND workspace_id = ? AND status IN ('invoiced', 'paid')`,
          )
            .bind(token, workspace.id)
            .first<Record<string, unknown>>()
        : null;

      if (!job) {
        return errorShellResponse(workspace, INVOICE_NOT_FOUND);
      }

      const [lineItems, customer, invoiceWorkspace] = await Promise.all([
        env.DB.prepare('SELECT * FROM job_line_items WHERE job_id = ?')
          .bind(job['id'] as string)
          .all<Record<string, unknown>>(),
        env.DB.prepare('SELECT * FROM customers WHERE id = ?')
          .bind(job['customer_id'] as string)
          .first<Record<string, unknown>>(),
        env.DB.prepare(
          'SELECT name, slug, phone, email, street, city, state, zip, license_num, logo_url FROM workspaces WHERE id = ?',
        )
          .bind(workspace.id)
          .first<InvoiceWorkspaceRow>(),
      ]);

      if (!customer || !invoiceWorkspace) {
        return errorShellResponse(workspace, INVOICE_NOT_FOUND);
      }

      const invoiceJob: InvoiceJobRow = {
        id: job['id'] as string,
        job_number: job['job_number'] as string,
        title: job['title'] as string,
        invoiced_at: (job['invoiced_at'] as string | null) ?? null,
        paid_at: (job['paid_at'] as string | null) ?? null,
        total: job['total'] as number,
        notes: job['notes'] as string,
        street: job['street'] as string,
        city: job['city'] as string,
        state: job['state'] as string,
        zip: job['zip'] as string,
      };
      const invoiceCustomer: InvoiceCustomerRow = {
        first_name: customer['first_name'] as string,
        last_name: customer['last_name'] as string,
        company: (customer['company'] as string | null) ?? null,
        email: customer['email'] as string,
        phone: customer['phone'] as string,
        street: customer['street'] as string,
        city: customer['city'] as string,
        state: customer['state'] as string,
        zip: customer['zip'] as string,
      };
      const invoiceLineItems: InvoiceLineItemRow[] = (
        lineItems.results ?? []
      ).map((li) => ({
        id: li['id'] as string,
        description: li['description'] as string,
        quantity: li['quantity'] as number,
        unit_price: li['unit_price'] as number,
        total: li['total'] as number,
      }));

      return new Response(
        generateInvoiceHtml({
          job: invoiceJob,
          lineItems: invoiceLineItems,
          customer: invoiceCustomer,
          workspace: invoiceWorkspace,
        }),
        {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // A homeowner's name and address. Never in a shared cache.
            'Cache-Control': 'no-store',
            'X-Robots-Tag': 'noindex, nofollow',
            ...securityHeaders(),
          },
        },
      );
    }

    // ── /deposit/<token> — REMOVED (WS-0, PRD v1.5) ──────────
    // This path used to render the booking-deposit confirmation page.
    // The deposit model was revoked on 2026-10-20 (canonical model:
    // "No deposit at booking. Ever."), so the page, its card form and
    // its Stripe CSP allowance are gone. An old link still in a
    // homeowner's messages gets the site's plain not-found shell —
    // no deposit copy, no token lookup, nothing to confirm. The
    // unrouted renderer (src/deposit.ts) was deleted on 2026-11-01.
    if (pathname.startsWith(DEPOSIT_PATH) && request.method === 'GET') {
      return errorShellResponse(workspace, PAGE_NOT_FOUND);
    }

    // No /scanner here any more. It served a contractor's asset register —
    // serials, condition, location, the assigned employee's name — to anyone
    // holding a label, with no session, because this Worker has none. The
    // authenticated read is GET /api/assets/lookup/:qrCode and the tool that
    // uses it belongs in apps/platform (GP-022).

    // service_type lives on leads (the same field this page writes to), not
    // on jobs. Jobs are individual bookings; services are demand-side.
    const servicesResult = await env.DB.prepare(
      `SELECT service_type as name, COUNT(*) as count
       FROM leads
       WHERE workspace_id = ? AND service_type IS NOT NULL AND service_type != ''
       GROUP BY service_type
       ORDER BY count DESC
       LIMIT 12`,
    )
      .bind(workspace.id)
      .all<{ name: string; count: number }>();

    const serviceTypes = servicesResult.results ?? [];

    // The recurring week the contractor entered (GP-101), for the About
    // page's hours block and the LocalBusiness openingHoursSpecification.
    // No rows ⇒ an empty list ⇒ neither renders (GP-011): the page must not
    // fill in a week the contractor never gave us.
    const availabilityResult = await env.DB.prepare(
      `SELECT weekday, opens_at, closes_at, is_open
       FROM workspace_availability
       WHERE workspace_id = ?
       ORDER BY weekday`,
    )
      .bind(workspace.id)
      .all<AvailabilityRow>();
    const availability: WeekdayHours[] = (availabilityResult.results ?? []).map(
      (row) => ({
        weekday: row.weekday,
        isOpen: row.is_open === 1,
        opensAt: row.opens_at ?? undefined,
        closesAt: row.closes_at ?? undefined,
      }),
    );

    // What this tenant can price without a human. Every quote call to action
    // on the marketing pages is gated on it being non-empty — the feature was
    // live at /quote for weeks with nothing on the site linking to it, so the
    // only visitors who ever saw it were the ones who typed the URL.
    //
    // Two indexed reads at worst, on a response cached for 300s at the edge
    // and 1800s at the origin. listPublishedFlows falls back to Greenput's
    // global templates, so this is normally non-empty even for a tenant who
    // has authored nothing.
    const quoteFlows = await listPublishedFlows(
      env.DB as unknown as D1Like,
      workspace.id,
    );

    // Render page with BaseNative SSR — falls back to a branded, noindexed
    // 404 (still with the tenant's own nav/footer) for any unmatched path.
    const html = renderTenantPage(
      workspace,
      pathname,
      serviceTypes,
      quoteFlows.map((f) => ({
        slug: f.slug,
        name: f.name,
        description: f.description,
        vertical: f.vertical,
      })),
      {
        // Where this tenant's own share card is served from. Empty in staging
        // and preview, which have no brand hostname — the page then advertises
        // Greenput's own card rather than a URL that 404s. See env.ts.
        brandOrigin: env.BRAND_ORIGIN,
        availability,
        // Outcome of a no-JavaScript POST /leads, carried in the query (GP-004).
        leadForm: leadFormOutcomeFrom(url.searchParams),
      },
    );
    const known = isKnownTenantPath(pathname);

    return new Response(html, {
      status: known ? 200 : 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': known
          ? 'public, max-age=300, s-maxage=1800'
          : 'no-store',
        ...securityHeaders({ nonce }),
      },
    });
  },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const res = await site.fetch(request, env);
    // A workers.dev preview resolves the tenant from ?slug= (GP-023); keep it
    // on every same-site link, form, and redirect so the preview can be
    // clicked through instead of falling back to the preview landing page.
    const url = new URL(request.url);
    const previewSlug = url.hostname.endsWith('.workers.dev')
      ? url.searchParams.get('slug')
      : null;
    return previewSlug ? carryPreviewSlug(res, previewSlug) : res;
  },
};
