import { render } from '@basenative/server';
import {
  GP_BASE_CSS,
  GP_FONT_HEAD_HTML,
  GP_FONT_STACK,
  GP_GENERIC_SHARE_IMAGE,
  GP_SHARE_CARD_SIZE,
  GP_PLATFORM_CSS,
  GP_TOKENS_CSS,
  SURFACE_CSS,
  brandAssetUrls,
  generatedIdentityFor,
  minifyCss,
  shareCardFactsFor,
  stylesheetVersion,
} from '@greenput/shared/design';
import {
  displayTrade,
  formatPhone,
  type WeekdayHours,
} from '@greenput/shared/utils';
import { renderBnButton } from '@basenative/platform';
import { flowForService } from './service-flow';
import { raw } from '@basenative/runtime';
import { resolveRoute } from '@basenative/router';
import {
  aboutPage,
  contactPage,
  homePage,
  invoiceIndexPage,
  notFoundPage,
  proposalIndexPage,
  servicesPage,
  tenantFooterHtml,
  tenantHeaderHtml,
  tenantTabsHtml,
  type TenantChrome,
  type TenantPages,
} from './surface-pages';

export interface WorkspaceData {
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
  /** Contractor-owned domain CNAMEd onto Greenput, once verified — see
   * schema.sql `workspaces.custom_hostname`. Optional so call sites (and
   * existing tests) that never SELECT these columns keep working. */
  custom_hostname?: string | null;
  custom_domain_status?: string | null;
  /** `workspaces.license_num`. Optional so a SELECT that predates the
   *  micro-site's trust bar (and every existing test fixture) still
   *  type-checks; the licence is only shown when it is actually there,
   *  because an unbacked "licensed" claim on a real contractor's storefront
   *  is not ours to make. */
  license_num?: string | null;
}

/**
 * The canonical public origin for a workspace: its verified custom domain
 * once Cloudflare for SaaS has activated it, otherwise the `<slug>.greenput.com`
 * subdomain every tenant gets by default. Used for canonical/OG URLs and
 * JSON-LD `@id` so a contractor's SEO signal consolidates onto their own
 * domain as soon as it goes live, without waiting on a redirect to be
 * followed. index.ts uses the same active-only check to decide whether to
 * 301 subdomain traffic over to the custom domain.
 */
export function tenantOriginFor(workspace: WorkspaceData): string {
  if (
    workspace.custom_domain_status === 'active' &&
    workspace.custom_hostname
  ) {
    return `https://${workspace.custom_hostname}`;
  }
  return `https://${workspace.slug}.greenput.com`;
}

export interface ServiceType {
  name: string;
  count: number;
}

/**
 * One published pricing machine, as the marketing pages advertise it.
 *
 * Structurally identical to `IntakeFlowSummary` in intake.ts, and declared
 * here rather than imported from it because intake.ts imports this module —
 * the other direction would be a cycle.
 *
 * An empty list is the honest signal that this tenant has nothing to price
 * instantly, and every quote CTA in this file is gated on it. It is rarely
 * empty in practice: `listPublishedFlows` falls back to Greenput's global
 * templates, so a tenant can quote from day one without authoring anything.
 */
export interface QuoteFlow {
  slug: string;
  name: string;
  description: string;
  vertical: string;
}

/** One row of the About page's hours list: "Mon" / "7:00 AM – 6:00 PM". */
export interface HoursRow {
  day: string;
  times: string;
}

// Rendered Monday first, the way a shop door reads; `weekday` stays 0 = Sunday
// as workspace_availability stores it.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const DAY_SCHEMA = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/**
 * Local wall-clock `HH:MM` → "7:00 AM". No zone maths on purpose: the rows
 * are already in the workspace's own zone (schema.sql, `workspace_availability`),
 * and the homeowner reading the page is in the same town. A value that is not
 * `HH:MM` is echoed as-is rather than turned into "NaN:undefined".
 */
export function formatLocalTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const hours24 = Number(m[1]);
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${m[2]} ${period}`;
}

/**
 * The hours list, one row per weekday, from `workspace_availability` rows —
 * and ONLY from them. No rows means no list: a contractor who has never said
 * when they work has not said they are open (GP-011). A weekday without a row
 * among rows that exist reads as Closed, which is what the API writes for it.
 */
export function openingHoursRows(week: readonly WeekdayHours[]): HoursRow[] {
  if (week.length === 0) return [];
  return WEEK_ORDER.map((weekday) => {
    const row = week.find((d) => d.weekday === weekday);
    const open = row?.isOpen && row.opensAt && row.closesAt;
    return {
      day: DAY_SHORT[weekday],
      times: open
        ? `${formatLocalTime(row.opensAt)} – ${formatLocalTime(row.closesAt)}`
        : 'Closed',
    };
  });
}

/**
 * The same week as schema.org `OpeningHoursSpecification` entries, open days
 * only, for the LocalBusiness JSON-LD. Empty when there is nothing to state,
 * and the caller then omits the property rather than publishing `[]`.
 */
export function openingHoursSpecification(
  week: readonly WeekdayHours[],
): Array<Record<string, string>> {
  return WEEK_ORDER.flatMap((weekday) => {
    const row = week.find((d) => d.weekday === weekday);
    if (!row?.isOpen || !row.opensAt || !row.closesAt) return [];
    return [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: `https://schema.org/${DAY_SCHEMA[weekday]}`,
        opens: row.opensAt,
        closes: row.closesAt,
      },
    ];
  });
}

/**
 * What this page advertises as its share image, and how a platform should
 * frame it.
 *
 * The chain, best first:
 *
 * 1. **This contractor's own card** — `https://brand.greenput.com/<slug>/<version>/card.png`
 *    from `apps/brand-assets`. 1200x630, showing their business name, their
 *    trade and their mark (generated, or their uploaded logo embedded). Needs
 *    a brand origin to address and a slug to key on.
 * 2. **Their uploaded logo**, if they have one and there is no brand origin to
 *    reach. `twitter:card` drops to `summary` here: a logo is usually square or
 *    wide-and-short and looks broken stretched across a large card.
 * 3. **Greenput's own card.** Kept deliberately as the last resort — a
 *    micro-site with no reachable API still needs *an* image, and one that says
 *    Greenput beats a bare text stub.
 *
 * Nothing here makes the browser fetch anything: these are `<meta>` values read
 * by crawlers. That matters, because the site's CSP is `img-src 'self' data:`
 * and a cross-origin `<img>` would be blocked — which is also why the in-page
 * mark is a coloured monogram rather than a cross-origin image.
 */
export interface ShareImageContext {
  shareImageUrl: string;
  shareImageAlt: string;
  shareImageSized: boolean;
  shareImageWidth: string;
  shareImageHeight: string;
  twitterCard: 'summary' | 'summary_large_image';
}

export function shareImageContextFor(
  workspace: WorkspaceData,
  brandOrigin?: string | null,
): ShareImageContext {
  const trade = displayTrade(workspace.trade);
  const alt = trade ? `${workspace.name} — ${trade}` : workspace.name;
  const sized = {
    shareImageSized: true,
    shareImageWidth: String(GP_SHARE_CARD_SIZE.width),
    shareImageHeight: String(GP_SHARE_CARD_SIZE.height),
    twitterCard: 'summary_large_image' as const,
  };

  const urls = brandAssetUrls(brandOrigin, workspace);
  if (urls) {
    return { shareImageUrl: urls.cardUrl, shareImageAlt: alt, ...sized };
  }
  const uploaded = (workspace.logo_url ?? '').trim();
  if (uploaded !== '') {
    return {
      shareImageUrl: uploaded,
      shareImageAlt: `${workspace.name} logo`,
      shareImageSized: false,
      shareImageWidth: '',
      shareImageHeight: '',
      twitterCard: 'summary',
    };
  }
  return {
    shareImageUrl: GP_GENERIC_SHARE_IMAGE,
    shareImageAlt:
      'Greenput — websites and lead capture for home-service contractors',
    ...sized,
  };
}

const TENANT_ROUTES = [
  { path: '/', name: 'home' },
  { path: '/services', name: 'services' },
  { path: '/contact', name: 'contact' },
  { path: '/about', name: 'about' },
  { path: '/proposal', name: 'proposal' },
  { path: '/invoice', name: 'invoice' },
];

/**
 * True when `pathname` matches one of the tenant site's own page routes.
 * resolveRoute never returns null itself — for an unmatched path it returns
 * `{ name: null, matched: null }` — so index.ts uses this (rather than
 * inspecting the result directly) to decide whether to answer 404.
 */
export function isKnownTenantPath(pathname: string): boolean {
  return resolveRoute(TENANT_ROUTES, pathname).name !== null;
}

/**
 * Re-exported, not defined here any more: the share card `apps/api` draws
 * prints the trade under the business name, and the `og:image` URL this file
 * emits is versioned by a hash over exactly the strings that card draws. Two
 * copies of the trade-label table would let the version and the card disagree
 * about the word "HVAC" with each side's own tests passing. It lives in
 * `libs/shared/utils/src/trade.ts`; every existing import site here is
 * unchanged.
 */
export { displayTrade };

/**
 * Escape text for an HTML body or a double-quoted attribute.
 *
 * Exported because the quote form composes markup outside BaseNative's own
 * `{{ }}` interpolation — the `@basenative/components` render helpers take HTML
 * slots, and anything interpolated into one has to be escaped by the caller.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Minimal branded HTML page for surfaces with no workspace to render a full
 * layout for (unknown subdomain, missing proposal/asset) — replaces the bare
 * `new Response('X not found')` text bodies that had no title, lang, or doc
 * structure at all.
 */
// ─── The contact form after a POST-redirect-GET (GP-004) ──────────────────────
// POST /leads answers a no-JavaScript submission with a 303 to
// `/contact?sent=1` or `/contact?error=<key>&field=<name>`; the page then
// renders #form-message from these fixed strings. A query parameter only
// SELECTS a message here — it is never echoed into the page.

/** What the visitor sees once their request is saved. */
export const LEAD_FORM_SENT_MESSAGE = 'Thank you! We will be in touch soon.';

/**
 * Every reason POST /leads can refuse a submission, keyed by the `error`
 * value it redirects with. The field-named keys are the validation messages
 * `validateLead` in index.ts hands the JSON path too, so both paths say the
 * same thing.
 */
export const LEAD_FORM_ERRORS: Readonly<Record<string, string>> = {
  firstName: 'Please enter your first name.',
  lastName: 'Please enter your last name.',
  email: 'Please enter a valid email address.',
  phone: 'Please enter a valid phone number.',
  serviceType: 'Please choose a service from the list.',
  notes: 'Please keep your message under 5,000 characters.',
  contact: 'Please provide an email address or phone number so we can reply.',
  WORKSPACE_NOT_READY:
    'This site is not set up to receive requests yet. Please call or email us directly.',
  INTERNAL:
    'Something went wrong saving your request. Please try again, or call or email us directly.',
  unknown: 'Please check the form and try again.',
};

/** Whether `key` names a message above (own keys only — never `toString`). */
export function isLeadFormErrorKey(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEAD_FORM_ERRORS, key);
}

export interface LeadFormOutcome {
  status: 'success' | 'error';
  message: string;
  /** The input the error is about (`aria-invalid`), when it is about one. */
  field: string | null;
}

/** Reads the outcome POST /leads redirected with, if any, from `/contact`'s query. */
export function leadFormOutcomeFrom(
  params: URLSearchParams,
): LeadFormOutcome | null {
  if (params.get('sent') === '1') {
    return { status: 'success', message: LEAD_FORM_SENT_MESSAGE, field: null };
  }
  const error = params.get('error');
  if (error === null) return null;
  const field = params.get('field');
  return {
    status: 'error',
    message: isLeadFormErrorKey(error)
      ? LEAD_FORM_ERRORS[error]
      : LEAD_FORM_ERRORS.unknown,
    field: field !== null && isLeadFormErrorKey(field) ? field : null,
  };
}

export function renderTenantErrorPage(title: string, message: string): string {
  return `<!doctype html>
<html lang="en" data-bn-platform="ios">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="robots" content="noindex, nofollow">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:${GP_FONT_STACK};min-height:100dvh;display:grid;place-items:center;padding:1.5rem;background:#0F0E0C;color:#FBF9F5;text-align:center;line-height:1.45}
    main{max-width:30rem;border-top:3px solid #4EAF7C;padding-top:1.5rem}
    h1{font-size:1.75rem;font-weight:800;letter-spacing:-.022em;margin-block-end:.75rem}
    p{color:#CFC7B9}
    a{color:#78C79E}
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </main>
</body>
</html>`;
}

export interface TenantErrorAction {
  href: string;
  label: string;
  /** Defaults to `primary` for the first action and `ghost` for the rest. */
  variant?: 'primary' | 'ghost' | 'ink';
}

export interface TenantErrorShellOptions {
  title: string;
  message: string;
  /** Each caller names its own way out; the shell never invents one. */
  actions: readonly TenantErrorAction[];
}

/**
 * An error page that is still the contractor's site (GP-040).
 *
 * `renderTenantErrorPage` above is for the one case with no workspace — a
 * host this Worker cannot resolve. Everywhere else the caller has a
 * workspace in hand, and a dead link on it should not be a dead end: this
 * renders through `renderTenantShell`, so the page carries the nav, the
 * footer page list and the phone number, plus the actions the caller
 * chose. Shaped like `notFoundTemplate`, on the same `data-bn` hooks, so
 * `tenantStyles` already covers it. Always `noindex`.
 */
export function renderTenantErrorShell(
  workspace: WorkspaceData,
  options: TenantErrorShellOptions,
): string {
  const actions = options.actions
    .map((action, index) => {
      const variant =
        action.variant === 'ink'
          ? 'ink'
          : action.variant === 'ghost' || (action.variant == null && index > 0)
            ? 'bordered'
            : 'prominent';
      return renderBnButton(action.label, {
        href: action.href,
        variant,
        size: 'large',
      });
    })
    .join('');
  const content = `
<section data-bn="not-found" aria-labelledby="error-heading">
  <div data-bn-column>
    <h1 id="error-heading" data-bn="bn-large-title">${escapeHtml(options.title)}</h1>
    <p data-bn="bn-lead">${escapeHtml(options.message)}</p>
    <p data-bn="bn-cluster">${actions}</p>
  </div>
</section>`;

  return renderTenantShell(workspace, {
    content,
    title: `${options.title} — ${workspace.name}`,
    description: options.message,
    noindex: true,
  });
}

// ─── Layout Template ──────────────────────────────────────────────────────────
let layoutTemplate = `
<!doctype html>
<html lang="en" data-bn-platform="ios">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{{ pageTitle }}</title>
  <meta name="description" content="{{ pageDescription }}">
  <template @if="noindex">
    <meta name="robots" content="noindex, nofollow">
  </template>
  <meta name="theme-color" content="#F2F2F7" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#1C1C1E" media="(prefers-color-scheme: dark)">
  <meta name="color-scheme" content="light dark">
  <meta name="apple-mobile-web-app-title" content="{{ workspaceName }}">
  <template @if="hasCanonical">
    <link rel="canonical" href="{{ canonicalUrl }}">
  </template>

  <!-- Open Graph -->
  <meta property="og:site_name" content="{{ workspaceName }}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="{{ pageTitle }}">
  <meta property="og:description" content="{{ pageDescription }}">
  <template @if="hasCanonical">
    <meta property="og:url" content="{{ canonicalUrl }}">
  </template>
  <meta property="og:locale" content="en_US">
  <meta property="og:image" content="{{ shareImageUrl }}">
  <meta property="og:image:alt" content="{{ shareImageAlt }}">
  <template @if="shareImageSized">
    <meta property="og:image:type" content="image/png">
    <meta property="og:image:width" content="{{ shareImageWidth }}">
    <meta property="og:image:height" content="{{ shareImageHeight }}">
  </template>

  <!-- Twitter Card -->
  <meta name="twitter:card" content="{{ twitterCard }}">
  <meta name="twitter:title" content="{{ pageTitle }}">
  <meta name="twitter:description" content="{{ pageDescription }}">
  <meta name="twitter:image" content="{{ shareImageUrl }}">
  <meta name="twitter:image:alt" content="{{ shareImageAlt }}">

  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  ${GP_FONT_HEAD_HTML}
  <link rel="stylesheet" href="__TENANT_CSS__">
  <!--__STRUCTURED_DATA__-->
</head>
<body>
  <section data-bn="bn-page">
  <template @if="isDemo">
    <p data-bn="demo-banner" data-bn-column role="note">
      Demo site — this showcases the Greenput platform. It is not a real business.
    </p>
  </template>
  {{ headerHtml }}
  <main id="main-content">
    {{ pageContent }}
  </main>
  {{ footerHtml }}
  </section>
  {{ tabsHtml }}
  <script src="/js/app.js" defer></script>
</body>
</html>
`;

const tenantStyles = `
@layer tokens, reset, base, components, states;

${GP_PLATFORM_CSS}

${GP_TOKENS_CSS}

@layer base {
${GP_BASE_CSS}
}

/* Intake styles still name this alias. The accent itself is --gp-primary. */
:root { --brand-primary: var(--gp-primary); }

${SURFACE_CSS}

/* Tenant chrome the shared sheet does not know about. Unlayered, so it
   wins over the component layer. No page-gutter padding here: that
   declaration is the one page-spine rule. */
[data-bn="bn-brand"] {
  flex: 1 1 auto;
  min-inline-size: 0;
  max-inline-size: 100%;
  overflow: hidden;
}
/* Initials sit in the middle of the tile. A flex item blockifies the span,
   so without a grid the glyphs start at the top and line up with the name's
   first line only. */
[data-bn="monogram"] {
  display: grid;
  place-items: center;
  flex: none;
  inline-size: var(--gp-mark-tile);
  block-size: var(--gp-mark-tile);
  border-radius: var(--gp-radius-sm);
  background: var(--gp-mark-bg, var(--gp-surface-ink));
  color: var(--gp-mark-fg, var(--gp-primary-on-ink));
  font-size: 0.8125rem;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
}
[data-bn="bn-brand"] > img {
  flex: none;
  inline-size: var(--gp-mark-tile);
  block-size: var(--gp-mark-tile);
  object-fit: contain;
  border-radius: var(--gp-radius-sm);
}
[data-bn="demo-banner"] {
  margin-block: 0;
  padding-block: var(--gp-space-2);
  text-align: center;
  font-size: var(--gp-text-sm);
  line-height: var(--gp-leading-snug);
  color: var(--gp-text-muted);
}
/* The headline's measure. A wrapped control grows to the column instead of
   stopping at its label. Intake clusters are divs and stay as they are. */
p[data-bn="bn-cluster"] {
  inline-size: 100%;
}
p[data-bn="bn-cluster"] > [data-bn="bn-button"] {
  flex: 1 1 var(--gp-cluster-min);
  min-inline-size: min(100%, var(--gp-cluster-min));
}
[data-bn="nav-name"] {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: stretch;
  justify-content: center;
  min-inline-size: 0;
  overflow: hidden;
  line-height: 1.05;
  text-align: start;
}
[data-bn="nav-name"] strong {
  display: block;
  min-inline-size: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-bn="nav-name"] small {
  max-inline-size: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--gp-text-muted);
}
[data-bn="about-monogram"] {
  display: grid;
  place-items: center;
  inline-size: 5.5rem;
  block-size: 5.5rem;
  border-radius: 1.25rem;
  background: var(--gp-mark-bg, var(--gp-surface-ink));
  color: var(--gp-mark-fg, var(--gp-primary-on-ink));
  font-size: 1.75rem;
  font-weight: 700;
}
[data-bn="bn-info-card"] :is(h2, h3, p) {
  min-inline-size: 0;
  overflow-wrap: break-word;
}
[data-bn="bn-inset-row"] > strong,
[data-bn="bn-inset-row"] > span {
  min-inline-size: 0;
}
[data-bn="bn-inset-row"] > span {
  margin-inline-start: auto;
  text-align: end;
}
[data-bn="lead-form"] {
  position: relative;
  display: grid;
  gap: var(--gp-stack-content);
  min-inline-size: 0;
}
[data-bn="lead-form"] > * { min-inline-size: 0; }
[data-bn="bn-field"] :is(input, select, textarea) {
  box-sizing: border-box;
  max-inline-size: 100%;
  min-inline-size: 0;
}
[data-bn="bn-field"] input[type="checkbox"] {
  inline-size: 1.15rem;
  block-size: 1.15rem;
  min-inline-size: 1.15rem;
  min-block-size: 1.15rem;
  max-inline-size: 1.15rem;
  margin: 0.2rem 0.65rem 0 0;
  padding: 0;
  flex: none;
}
[data-bn="bn-field"] span:has(> input[type="checkbox"]) {
  min-inline-size: 0;
}
[data-bn="hp-field"] {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  margin: 0;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
[data-bn="hours-row"] {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  min-inline-size: 0;
}
[data-bn="hours-row"] dd { margin: 0; }

/* The shared sheet parks an empty dock under the scrollport the size of
   the capsule. The capsule already overlays the viewport, so the clearance
   belongs on the scrolling page. The bar stays one capsule. */
@media (max-width: 1023px) {
  body:has([data-bn="bn-tab-bar"][data-placement="floating"]) {
    padding-block-end: 0;
  }

  body:has([data-bn="bn-tab-bar"][data-placement="floating"]) > [data-bn="bn-page"] {
    padding-block-end: calc(
      var(--gp-capsule-h) + max(var(--gp-capsule-inset), env(safe-area-inset-bottom, 0px))
    );
  }
}
`;

const tenantScript = `
(function(){
  'use strict';
  // Phone nav is the rail plus the floating tab bar. No drawer script.
  var form=document.getElementById('lead-form');
  if(form){
    form.addEventListener('submit',async function(e){
      e.preventDefault();
      var btn=form.querySelector('[type=submit]');
      var msgEl=document.getElementById('form-message');
      var origText=btn.textContent;
      btn.disabled=true;btn.textContent='Sending...';
      msgEl.hidden=true;msgEl.removeAttribute('data-bn-status');
      form.querySelectorAll('[aria-invalid]').forEach(function(el){el.removeAttribute('aria-invalid');});
      // The failure copy names a way to reach the contractor (GP-043). This
      // script is a static asset, so the number and address come from the
      // footer the page already rendered, not from the script.
      function showFailure(copy){
        msgEl.textContent=copy+' ';
        document.querySelectorAll('[data-bn="footer-contact"]').forEach(function(a){
          var link=a.cloneNode(true);
          link.setAttribute('data-bn','form-message-link');
          msgEl.appendChild(link);
        });
      }
      try{
        var fd=new FormData(form);
        if((fd.get('website')||'').toString().trim()){return;}
        var res=await fetch('/leads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(fd))});
        if(!res.ok){
          var d=null;try{d=await res.json();}catch(parseErr){d=null;}
          var failure=new Error((d&&d.error&&d.error.message)||'Request failed');
          failure.field=d&&d.error&&d.error.field;
          failure.status=res.status;
          throw failure;
        }
        msgEl.textContent='Thank you! We will be in touch soon.';
        msgEl.setAttribute('data-bn-status','success');msgEl.hidden=false;
        form.reset();
      }catch(err){
        var invalidField=err.field&&form.querySelector('[name="'+err.field+'"]');
        if(err instanceof TypeError){showFailure('We could not reach the site. Check your connection, or call us directly:');}
        else if(err.status>=500){showFailure('Something went wrong on our end. Please call or email us:');}
        else{msgEl.textContent=err.message||'Something went wrong. Please try again.';}
        msgEl.setAttribute('data-bn-status','error');msgEl.hidden=false;
        msgEl.scrollIntoView({block:'center',behavior:'smooth'});
        if(invalidField){invalidField.setAttribute('aria-invalid','true');invalidField.focus();}
        else{msgEl.setAttribute('tabindex','-1');msgEl.focus();}
      }finally{
        btn.disabled=false;btn.textContent=origText;
      }
    });
  }
  var params=new URLSearchParams(window.location.search);
  var svc=params.get('service');
  if(svc){
    var sel=document.querySelector('[name=serviceType]');
    if(sel){
      // An unmatched value would leave the select blank (selectedIndex -1),
      // not on its placeholder (GP-044).
      var hit=Array.prototype.some.call(sel.options,function(o){return o.value===svc;});
      if(hit)sel.value=svc;
    }
  }
})();
`;

// ─── Critical CSS (inlined in <head> to prevent FOUC) ─────────────────────────
// Sizing-only rules — must apply before /css/styles.css arrives so SVG icons
// and key layout primitives render at the correct size on first paint.
const criticalCss = [
  // Sizing-only rules that have to apply before /css/styles.css arrives, so
  // an icon or the hero art never paints at its intrinsic size first and
  // shifts the layout when the sheet lands (the hero is the LCP element).
  ':where(svg):not([width]):not([height]){width:1em;height:1em}',
  'svg{display:block;max-inline-size:100%}',
  '[data-bn="hero-art"] svg{inline-size:100%;block-size:auto}',
  '[data-bn="service-detail-card"] svg,[data-bn="highlight-item"] svg{width:1.5rem;height:1.5rem}',
  '[data-bn="detail-icon"]{width:2.5rem;height:2.5rem;flex-shrink:0}',
  '[data-bn="detail-icon"] svg{width:1.25rem;height:1.25rem}',
  // Sizing AND colour: the nav monogram is above the fold, so without the
  // colour here it would paint as the default ink tile and then repaint to the
  // contractor's own colourway when the full sheet lands.
  '[data-bn="monogram"]{display:grid;place-items:center;width:2.25rem;height:2.25rem;border-radius:8px;line-height:1;background:var(--gp-mark-bg,var(--gp-surface-ink));color:var(--gp-mark-fg,var(--gp-primary-on-ink))}',
  '[data-bn="bn-tab-bar"] [data-bn="bn-symbol"]{width:1.75rem;height:1.75rem}',
].join('');

export interface TenantShellOptions {
  /** Already-rendered markup for `<main>`. Not escaped — pass trusted HTML. */
  content: string;
  title: string;
  description: string;
  /** Absolute canonical URL. Omit on a page that should not advertise one. */
  canonicalUrl?: string;
  /** Which primary-nav item to mark active, if any. */
  activeNav?: 'home' | 'services' | 'about' | 'contact' | null;
  noindex?: boolean;
  /**
   * Published pricing machines. Non-empty turns the nav's primary call to
   * action into the instant price; empty leaves the site on the
   * describe-it-and-wait path it had before.
   */
  quoteFlows?: QuoteFlow[];
  /** `env.BRAND_ORIGIN` — where this tenant's share card is served from. */
  brandOrigin?: string | null;
}

/**
 * The tenant's own chrome — header, nav, footer, theme — around arbitrary
 * content.
 *
 * `renderTenantPage` builds the four marketing pages and their LocalBusiness
 * JSON-LD; this is the same layout for pages that are not marketing pages and
 * have no business being described as one. The quote form uses it, so a
 * homeowner filling it in never leaves the contractor's site.
 */
/**
 * What the shared layout (header monogram, footer line, licence) needs to
 * know about a workspace, derived ONCE. Both renderTenantPage and
 * renderTenantShell (the quote and proposal pages) spread this in. It used
 * to be built only in renderTenantPage, so every page through the shell
 * rendered `{{ initials }}` as nothing — a blank black square where the
 * contractor's monogram should be, and a footer with no area.
 */
export function shellIdentity(workspace: WorkspaceData) {
  const area =
    workspace.city && workspace.state
      ? `${workspace.city}, ${workspace.state}`
      : workspace.city || '';
  // The SAME identity the share card draws, because both call this one
  // function — see libs/shared/design/src/brand-identity.ts.
  const identity = generatedIdentityFor(workspace);
  return {
    initials: identity.initials,
    markBg: identity.variant.bg,
    markFg: identity.variant.fg,
    markAccent: identity.accent.bg,
    markTreatment: identity.treatment,
    markShape: identity.shape,
    markTurn: String(identity.orientation * 90),
    license: (workspace.license_num ?? '').trim(),
    area,
    areaSuffix: area ? ` in ${area}` : '',
  };
}

function chromeRaw(
  workspace: WorkspaceData,
  options: { hasQuote: boolean; active: TenantChrome['active'] },
): {
  headerHtml: ReturnType<typeof raw>;
  tabsHtml: ReturnType<typeof raw>;
  footerHtml: ReturnType<typeof raw>;
} {
  const id = shellIdentity(workspace);
  const chrome: TenantChrome = {
    workspaceName: workspace.name,
    trade: displayTrade(workspace.trade),
    phone: workspace.phone,
    phoneDisplay: workspace.phone ? formatPhone(workspace.phone) : '',
    email: workspace.email,
    logoUrl: workspace.logo_url || '',
    initials: id.initials,
    markBg: id.markBg,
    markFg: id.markFg,
    markAccent: id.markAccent,
    markTreatment: id.markTreatment,
    markShape: id.markShape,
    markTurn: id.markTurn,
    license: id.license,
    areaSuffix: id.areaSuffix,
    hasQuote: options.hasQuote,
    active: options.active,
  };
  return {
    headerHtml: raw(tenantHeaderHtml(chrome)),
    tabsHtml: raw(tenantTabsHtml(chrome)),
    footerHtml: raw(tenantFooterHtml(chrome)),
  };
}

export function renderTenantShell(
  workspace: WorkspaceData,
  options: TenantShellOptions,
): string {
  const layout = render(
    layoutTemplate,
    {
      pageTitle: options.title,
      pageDescription: options.description,
      // Already-rendered markup: mark it raw or the renderer escapes it to text.
      pageContent: raw(options.content),
      ...chromeRaw(workspace, {
        hasQuote: (options.quoteFlows ?? []).length > 0,
        active: options.activeNav ?? null,
      }),
      canonicalUrl: options.canonicalUrl ?? '',
      hasCanonical: Boolean(options.canonicalUrl),
      noindex: options.noindex ?? workspace.slug === 'demo',
      workspaceName: workspace.name,
      trade: displayTrade(workspace.trade),
      // `phone` is the stored E.164 value and feeds every tel: href, the
      // @if gates and the JSON-LD telephone. `phoneDisplay` is the same
      // number formatted for a human to read; it is only ever visible text.
      phone: workspace.phone,
      phoneDisplay: workspace.phone ? formatPhone(workspace.phone) : '',
      email: workspace.email,
      logoUrl: workspace.logo_url || '',
      ...shellIdentity(workspace),
      ...shareImageContextFor(workspace, options.brandOrigin),
      isDemo: workspace.slug === 'demo',
      homeActive: options.activeNav === 'home' ? '' : null,
      servicesActive: options.activeNav === 'services' ? '' : null,
      aboutActive: options.activeNav === 'about' ? '' : null,
      contactActive: options.activeNav === 'contact' ? '' : null,
      hasQuote: (options.quoteFlows ?? []).length > 0,
      quoteFlows: options.quoteFlows ?? [],
    },
    { criticalCss },
  );
  // No JSON-LD: the marker is part of the shared layout template and would
  // otherwise be served to the browser as a literal HTML comment.
  return layout.replace('<!--__STRUCTURED_DATA__-->', '');
}

// ─── Main render function ─────────────────────────────────────────────────────
export interface TenantPageOptions {
  /**
   * `env.BRAND_ORIGIN` — where `apps/brand-assets` serves this tenant's share
   * card. Absent or unusable ⇒ the page advertises Greenput's own card instead
   * of a URL that would 404. Optional so every existing caller and spec is
   * unchanged.
   */
  brandOrigin?: string | null;
  /**
   * The workspace's recurring week from `workspace_availability` (GP-101), as
   * index.ts reads it. Absent or empty ⇒ no hours block on the About page and
   * no `openingHoursSpecification` in the JSON-LD. Never defaulted to a
   * plausible week: hours the contractor did not enter are not theirs.
   */
  availability?: readonly WeekdayHours[];
  /**
   * The result of a no-JavaScript contact-form submission, read from the
   * `/contact` query string by leadFormOutcomeFrom (GP-004). Null on a plain
   * visit: #form-message stays hidden.
   */
  leadForm?: LeadFormOutcome | null;
}

export function renderTenantPage(
  workspace: WorkspaceData,
  pathname: string,
  serviceTypes: ServiceType[],
  quoteFlows: QuoteFlow[] = [],
  options: TenantPageOptions = {},
): string {
  // resolveRoute never returns null itself — for an unmatched path it
  // returns { name: null, matched: null } — so `?? 'home'` here used to
  // silently fall through every unknown path to the home page with a 200.
  const route = resolveRoute(TENANT_ROUTES, pathname);
  const routeName = route.name;
  const trade = displayTrade(workspace.trade);
  // The generated mark: initials from the name, colourway seeded on the slug.
  const brandFacts = shareCardFactsFor(workspace);
  const brandUrls = brandAssetUrls(options.brandOrigin, workspace, brandFacts);

  // `demo` is the only slug reserved for Greenput's own reference/showcase
  // site (see scripts/preview/seed.sql) — every real tenant gets a normal
  // slug, so this can never collide with a customer's own site.
  const isDemo = workspace.slug === 'demo';
  const serviceArea =
    workspace.city && workspace.state
      ? `${workspace.city}, ${workspace.state} and surrounding areas`
      : '';

  // Everything the homeowner-facing copy needs, derived once. Each string
  // degrades to something true when the workspace has not filled its
  // profile in: no city, no "Serving …"; no licence number, no licence
  // claim.
  const { area, license } = shellIdentity(workspace);

  // Opening hours come from workspace_availability rows and nothing else.
  const availability = options.availability ?? [];
  const hours = openingHoursRows(availability);
  const hasHours = hours.length > 0;
  const hoursSpec = openingHoursSpecification(availability);

  // Rendered on the About page (see aboutTemplate) and mirrored into a
  // FAQPage JSON-LD block below, built from the SAME array so the structured
  // data cannot say something the page does not. Every answer is either a
  // fact the workspace row backs (a licence number, a city) or a statement
  // about how this site works. There is no insurance entry: nothing in the
  // schema records cover, so nothing here may imply it (GP-011).
  const faqEntries = [
    ...(license
      ? [
          {
            q: 'Are you licensed?',
            a: `Yes — licence ${license}. Ask to see the paperwork any time.`,
          },
        ]
      : []),
    {
      q: 'What areas do you serve?',
      a: serviceArea
        ? `We serve ${serviceArea}. Contact us to confirm coverage for your address.`
        : 'Contact us to confirm we serve your area.',
    },
    {
      q: 'How quickly can you respond?',
      a: 'Most requests submitted through this site receive a response within one business day.',
    },
  ];

  // Every quote call to action on every page is gated on this. A tenant with
  // nothing published keeps the describe-it-and-wait funnel rather than being
  // pointed at an empty page.
  const hasQuote = quoteFlows.length > 0;

  // The contact form's server-rendered status line. Fixed copy only — see
  // leadFormOutcomeFrom.
  const leadForm = options.leadForm ?? null;

  const baseCtx = {
    formStatus: leadForm?.status ?? null,
    formMessage: leadForm?.message ?? '',
    formField: leadForm?.field ?? null,
    // Plain values: @basenative/server escapes every {{ }} interpolation
    // itself, so pre-escaping here would double-encode (& -> &amp;amp;).
    workspaceName: workspace.name,
    trade,
    // `phone` (E.164) drives tel: hrefs, @if gates and JSON-LD; `phoneDisplay`
    // is the human-readable form and appears only as visible text.
    phone: workspace.phone,
    phoneDisplay: workspace.phone ? formatPhone(workspace.phone) : '',
    email: workspace.email,
    logoUrl: workspace.logo_url || '',
    ...shareImageContextFor(workspace, options.brandOrigin),
    serviceArea,
    ...shellIdentity(workspace),
    areaLabel: area ? `Serving ${area}` : 'Local to you',
    areaDetail: area ? 'And the streets around it' : 'Ask about your street',
    heroLead: area
      ? `${trade} work for homes in ${area}. A written price before anything starts, and a time we keep to.`
      : `${trade} work for homes near you. A written price before anything starts, and a time we keep to.`,
    responseNote: hasQuote
      ? 'A price in about two minutes · No call-back needed'
      : 'Free quotes · We reply within one business day',
    // `query` is the name URL-encoded for the Services page's "Ask about
    // this" link (GP-044). The renderer escapes {{ }} for HTML, not for a
    // query string, so a bare "&" in a service name split the parameter.
    // Mapped, not mutated: the JSON-LD below still reads the plain names.
    serviceTypes: serviceTypes.map((svc) => ({
      ...svc,
      query: encodeURIComponent(svc.name),
      flow: flowForService(svc.name, quoteFlows)?.slug ?? null,
    })),
    hasQuote,
    quoteFlows,
    hasHours,
    hours,
    isDemo,
    faqEntries,
  };

  let pageContent: string;
  let pageTitle: string;
  let pageDescription: string;

  const pages: TenantPages = {
    workspaceName: baseCtx.workspaceName,
    trade: baseCtx.trade,
    phone: baseCtx.phone,
    phoneDisplay: baseCtx.phoneDisplay,
    email: baseCtx.email,
    logoUrl: baseCtx.logoUrl,
    initials: baseCtx.initials,
    markBg: baseCtx.markBg,
    markFg: baseCtx.markFg,
    markAccent: baseCtx.markAccent,
    markTreatment: baseCtx.markTreatment,
    markShape: baseCtx.markShape,
    markTurn: baseCtx.markTurn,
    license: baseCtx.license,
    areaSuffix: baseCtx.areaSuffix,
    areaLabel: baseCtx.areaLabel,
    areaDetail: baseCtx.areaDetail,
    heroLead: baseCtx.heroLead,
    responseNote: baseCtx.responseNote,
    hasQuote: baseCtx.hasQuote,
    hasHours: baseCtx.hasHours,
    hours: baseCtx.hours,
    serviceTypes: baseCtx.serviceTypes,
    quoteFlows: baseCtx.quoteFlows,
    faqEntries: baseCtx.faqEntries,
    formStatus: baseCtx.formStatus,
    formMessage: baseCtx.formMessage,
    formField: baseCtx.formField,
  };

  switch (routeName) {
    case 'services':
      pageContent = servicesPage(pages);
      pageTitle = `Services — ${workspace.name}`;
      pageDescription = `${trade} services offered by ${workspace.name}. Contact us for a free quote.`;
      break;
    case 'contact':
      pageContent = contactPage(pages);
      pageTitle = `Get a Quote — ${workspace.name}`;
      pageDescription = `Request a free quote from ${workspace.name}, professional ${trade} services.`;
      break;
    case 'about':
      pageContent = aboutPage(pages);
      pageTitle = `About — ${workspace.name}`;
      pageDescription = `Learn about ${workspace.name}, a professional ${trade} company.`;
      break;
    case 'proposal':
      pageContent = proposalIndexPage(pages);
      pageTitle = `Proposal — ${workspace.name}`;
      pageDescription = `Open the proposal link from ${workspace.name}.`;
      break;
    case 'invoice':
      pageContent = invoiceIndexPage(pages);
      pageTitle = `Invoice — ${workspace.name}`;
      pageDescription = `Open the invoice link from ${workspace.name}.`;
      break;
    case 'home':
      pageContent = homePage(pages);
      pageTitle = `${workspace.name} — ${trade} Services`;
      pageDescription = `${workspace.name} provides professional ${trade} services. Contact us today for a free quote.`;
      break;
    default:
      pageContent = notFoundPage(pages);
      pageTitle = `Page Not Found — ${workspace.name}`;
      pageDescription =
        "The page you're looking for doesn't exist or has moved.";
      break;
  }

  const notFound = routeName === null;
  const tenantOrigin = tenantOriginFor(workspace);
  const canonicalPath = pathname === '/' ? '' : pathname;
  const canonicalUrl = `${tenantOrigin}${canonicalPath}`;

  // Only emit a PostalAddress when every field is present — schema.sql
  // defaults street/city/state/zip to '' for workspaces that haven't filled
  // out their profile, and a partial address is worse than none for
  // LocalBusiness validation (Google's Rich Results Test flags it).
  const hasAddress = !!(
    workspace.street &&
    workspace.city &&
    workspace.state &&
    workspace.zip
  );
  const areaServedName =
    workspace.city && workspace.state
      ? `${workspace.city}, ${workspace.state}`
      : '';

  // JSON is spliced verbatim into a <script> element below, where a literal
  // "</script>" in user data (a workspace or service name) would terminate the
  // element and hand the rest of the string to the HTML parser. Encoding "<"
  // as \u003c keeps the payload valid JSON and closes that hole.
  const structuredData = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: workspace.name,
    description: pageDescription,
    telephone: workspace.phone,
    email: workspace.email,
    '@id': tenantOrigin,
    url: tenantOrigin,
    // `logo` is a square raster Google can crop; `image` is the wide card. A
    // workspace with its own logo keeps it as `logo` — the generated mark never
    // displaces an uploaded one — and still gets the card as `image`, which is
    // the right shape for a rich result. A workspace with neither gets the
    // generated mark's PNG, which is the first time a logo-less tenant has had
    // a `logo` at all.
    ...(workspace.logo_url
      ? { logo: workspace.logo_url }
      : brandUrls
        ? { logo: brandUrls.markUrl }
        : {}),
    ...(brandUrls
      ? { image: brandUrls.cardUrl }
      : workspace.logo_url
        ? { image: workspace.logo_url }
        : {}),
    ...(hasAddress
      ? {
          address: {
            '@type': 'PostalAddress',
            streetAddress: workspace.street,
            addressLocality: workspace.city,
            addressRegion: workspace.state,
            postalCode: workspace.zip,
            // Not in schema.sql (no country column) — every workspace seen
            // so far is a US trade contractor; flagged in the SEO doc as an
            // assumption to confirm before this expands internationally.
            addressCountry: 'US',
          },
        }
      : {}),
    ...(areaServedName
      ? { areaServed: { '@type': 'City', name: areaServedName } }
      : {}),
    ...(trade ? { knowsAbout: trade } : {}),
    // Only the days the contractor said they are open, and only when they
    // have said anything at all — mirrors the About page's hours block.
    ...(hoursSpec.length > 0 ? { openingHoursSpecification: hoursSpec } : {}),
    ...(serviceTypes.length > 0
      ? {
          makesOffer: serviceTypes.map((svc) => ({
            '@type': 'Offer',
            itemOffered: {
              '@type': 'Service',
              name: svc.name,
              serviceType: svc.name,
              ...(areaServedName ? { areaServed: areaServedName } : {}),
              provider: { '@id': tenantOrigin },
            },
          })),
        }
      : {}),
  }).replace(/</g, '\\u003c');

  // Only the About page shows the FAQ copy, so only it gets FAQPage
  // structured data — matching visible content is what search engines
  // expect from FAQPage markup.
  const faqStructuredData =
    routeName === 'about'
      ? JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: faqEntries.map((f) => ({
            '@type': 'Question',
            name: f.q,
            acceptedAnswer: { '@type': 'Answer', text: f.a },
          })),
        }).replace(/</g, '\\u003c')
      : '';

  const layoutCtx = {
    pageTitle,
    pageDescription,
    // Already-rendered markup: mark it raw or the renderer escapes it to text.
    pageContent: raw(pageContent),
    ...chromeRaw(workspace, {
      hasQuote,
      active:
        routeName === 'home' ||
        routeName === 'services' ||
        routeName === 'about' ||
        routeName === 'contact'
          ? routeName
          : null,
    }),
    canonicalUrl,
    hasCanonical: !notFound,
    // The `demo` reference site is real, crawlable HTML (so it still proves
    // the platform's performance/SEO plumbing works end to end) but is kept
    // out of search results via meta robots — noindex is Google's own
    // recommended tool for excluding a page from the index while still
    // permitting normal crawling; robots.txt Disallow can still leave a
    // disallowed URL indexed with no snippet, and can't be scoped to one
    // tenant anyway since this single Worker serves every tenant's
    // robots.txt from the same handler (see index.ts).
    noindex: notFound || isDemo,
    workspaceName: baseCtx.workspaceName,
    trade: baseCtx.trade,
    phone: baseCtx.phone,
    phoneDisplay: baseCtx.phoneDisplay,
    email: baseCtx.email,
    logoUrl: baseCtx.logoUrl,
    ...shareImageContextFor(workspace, options.brandOrigin),
    isDemo,
    initials: baseCtx.initials,
    markBg: baseCtx.markBg,
    markAccent: baseCtx.markAccent,
    markTreatment: baseCtx.markTreatment,
    markShape: baseCtx.markShape,
    markTurn: baseCtx.markTurn,
    markFg: baseCtx.markFg,
    license: baseCtx.license,
    areaSuffix: baseCtx.areaSuffix,
    // BN's `:attr` binding sets the attribute when the value is a non-empty
    // string and skips it when the value is null. We pass '' for the active
    // route (sets `data-bn-active=""`) and null for inactive routes.
    homeActive: routeName === 'home' ? '' : null,
    servicesActive: routeName === 'services' ? '' : null,
    aboutActive: routeName === 'about' ? '' : null,
    contactActive: routeName === 'contact' ? '' : null,
    hasQuote,
    quoteFlows,
  };

  // BaseNative server skips <script> interpolation for type !== 'application/json',
  // so we splice the JSON-LD block(s) in post-render via a comment marker.
  // Skip entirely on the 404 — there's no page to describe.
  const layout = render(layoutTemplate, layoutCtx, { criticalCss });
  const structuredDataScripts = notFound
    ? ''
    : `<script type="application/ld+json">${structuredData}</script>` +
      (faqStructuredData
        ? `<script type="application/ld+json">${faqStructuredData}</script>`
        : '');
  return layout.replace('<!--__STRUCTURED_DATA__-->', structuredDataScripts);
}

/** Served as /css/styles.css — see `minifyCss`: the rationale stays in
 *  the source above, not on the homeowner's connection. */
const tenantStylesMin = minifyCss(tenantStyles);
const tenantCssHref = `/css/styles.css?v=${stylesheetVersion(tenantStylesMin)}`;
layoutTemplate = layoutTemplate.replaceAll('__TENANT_CSS__', tenantCssHref);

export { tenantStyles, tenantStylesMin, tenantCssHref, tenantScript };
