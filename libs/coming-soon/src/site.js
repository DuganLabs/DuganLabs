import { assertContent } from './content.js';
import { landing, login, privacy, message, leadsView, hub, monogram, ERRORS } from './render.js';
import { requireOwner } from './access.js';

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function headers(nonce, extra = {}) {
  return {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': [
      "default-src 'none'",
      `script-src 'nonce-${nonce}' https://challenges.cloudflare.com`,
      `style-src 'nonce-${nonce}'`,
      "img-src 'self' data:",
      "connect-src 'self'",
      'frame-src https://challenges.cloudflare.com',
      "form-action 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'cross-origin-opener-policy': 'same-origin',
    ...extra,
  };
}

const nonceOf = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export function favicon(c) {
  const fill = c.theme.accent, ink = c.theme.accentInk ?? '#ffffff';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${fill}"/><text x="32" y="43" text-anchor="middle" font-family="-apple-system,Segoe UI,Arial,sans-serif" font-size="32" font-weight="700" fill="${ink}">${monogram(c)}</text></svg>`;
}

/**
 * The standard DuganLabs site Worker. An app's whole Worker is:
 *   import content from '../content.json'; export default createSite(content);
 * Bindings (wrangler.toml): LEADS (service binding to the leads Worker),
 * vars TURNSTILE_SITE_KEY, ACCESS_TEAM_DOMAIN, ACCESS_AUD; secret OWNER_EMAILS
 * (Doppler -> `wrangler secret bulk`; never committed: this repo is public).
 */
export function createSite(rawContent) {
  const c = assertContent(rawContent);
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      const path = url.pathname.replace(/\/+$/, '') || '/';
      const method = request.method;
      const page = (body, status = 200, extra = {}) => new Response(body, { status, headers: headers(nonce, { 'cache-control': 'no-store', ...extra }) });
      const nonce = nonceOf();

      if (method === 'GET' && path === '/healthz') return json({ ok: true, app: c.source });
      if (method === 'GET' && path === '/favicon.svg') return new Response(favicon(c), { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
      if (method === 'GET' && path === '/robots.txt') return new Response(c.todo || c.noindex ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nDisallow: /app/\nDisallow: /login\n', { headers: { 'content-type': 'text/plain' } });

      if (method === 'GET' && path === '/') {
        const state = { joined: url.searchParams.has('joined'), error: url.searchParams.get('error') };
        return page(landing(c, env, { nonce, state }));
      }
      if (method === 'POST' && path === '/api/lead') return submitLead(c, request, env);
      if (method === 'GET' && path === '/login') return page(login(c, { nonce }));
      if (method === 'GET' && path === '/privacy') return page(privacy(c, { nonce }));

      if (path === '/app' || path.startsWith('/app/')) {
        const who = await requireOwner(request, env);
        if (who.deny) {
          const text = who.deny === 'not-configured'
            ? 'The private area is not configured on this deployment yet.'
            : 'This area is restricted to the owner.';
          return page(message(c, { nonce, title: 'Access denied', text, status: 'Forbidden' }), 403);
        }
        if (path === '/app') {
          const r = await env.LEADS.fetch(`https://leads.internal/leads?${new URLSearchParams({ source: c.leadsScope === 'all' ? '' : c.source, format: 'json' })}`);
          const total = r.ok ? (await r.json()).stats.total : 0;
          return page(hub(c, { nonce, email: who.email, total }));
        }
        if (path === '/app/leads' || path === '/app/leads.csv') {
          const scopeAll = c.leadsScope === 'all';
          const source = scopeAll ? url.searchParams.get('source') || '' : c.source;
          const q = url.searchParams.get('q') || '';
          const csv = path.endsWith('.csv');
          const r = await env.LEADS.fetch(`https://leads.internal/leads?${new URLSearchParams({ source, q, format: csv ? 'csv' : 'json' })}`);
          if (!r.ok) return page(message(c, { nonce, title: 'Leads unavailable', text: 'The leads service did not respond. Try again shortly.', status: 'Error' }), 502);
          if (csv) return new Response(r.body, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="leads-${source || 'all'}.csv"`, 'cache-control': 'no-store' } });
          const data = await r.json();
          return page(leadsView(c, { nonce, data, email: who.email, source: scopeAll ? source : '', q, sources: data.sourceList ?? [] }));
        }
      }
      return page(message(c, { nonce, title: 'Page not found', text: "That page doesn't exist." }), 404);
    },
  };
}

async function submitLead(c, request, env) {
  const wantsJson = (request.headers.get('accept') ?? '').includes('application/json');
  const done = (ok, code) => {
    if (wantsJson) return json(ok ? { ok: true } : { ok: false, error: code, message: ERRORS[code] }, ok ? 200 : code === 'rate' ? 429 : 400);
    return Response.redirect(new URL(ok ? '/?joined=1' : `/?error=${code}#lead`, request.url).toString(), 303);
  };
  let form;
  try { form = await request.formData(); } catch { return done(false, 'email'); }
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return done(false, 'email');
  if (form.get('consent') !== 'yes') return done(false, 'consent');
  const body = {
    email,
    name: String(form.get('name') ?? '').trim().slice(0, 120) || null,
    interest: String(form.get('interest') ?? '').trim().slice(0, 280) || null,
    consentVersion: String(form.get('consent_version') ?? '').slice(0, 20),
    token: String(form.get('cf-turnstile-response') ?? ''),
    // Server-side facts. The browser cannot choose the source tag.
    source: c.source,
    siteKey: env.TURNSTILE_SITE_KEY ?? '',
    host: new URL(request.url).hostname,
    ip: request.headers.get('cf-connecting-ip') ?? '',
    ua: (request.headers.get('user-agent') ?? '').slice(0, 300),
  };
  let r;
  try {
    r = await env.LEADS.fetch('https://leads.internal/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch { return done(false, 'server'); }
  if (r.ok) return done(true);
  const { error } = await r.json().catch(() => ({ error: 'server' }));
  return done(false, ['verify', 'rate', 'email', 'consent'].includes(error) ? error : 'server');
}
