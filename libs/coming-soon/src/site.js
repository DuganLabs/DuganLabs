import { assertContent } from './content.js';
import { landing, login, privacy, message, leadsView, hub, monogram, ERRORS } from './render.js';
import { requireOwner } from './access.js';
import { esc } from './escape.js';

const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

function baseSecurityHeaders() {
  return {
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'cross-origin-opener-policy': 'same-origin',
  };
}

function htmlHeaders(nonce, { allowTurnstile = false, extra = {} } = {}) {
  const scriptSrc = allowTurnstile
    ? `script-src 'nonce-${nonce}' https://challenges.cloudflare.com`
    : "script-src 'none'";
  const frameSrc = allowTurnstile
    ? 'frame-src https://challenges.cloudflare.com'
    : "frame-src 'none'";
  return {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': [
      "default-src 'none'",
      scriptSrc,
      `style-src 'nonce-${nonce}'`,
      "img-src 'self' data:",
      "connect-src 'self'",
      frameSrc,
      "form-action 'self'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    ...baseSecurityHeaders(),
    ...extra,
  };
}

const nonceOf = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...baseSecurityHeaders(),
    },
  });

export function favicon(c) {
  const fill = c.theme.accent;
  const ink = c.theme.accentInk ?? '#ffffff';
  const dark = c.theme.accentDark ?? fill;
  const inkDark = c.theme.accentInkDark ?? ink;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>rect{fill:${fill}}text{fill:${ink}}@media(prefers-color-scheme:dark){rect{fill:${dark}}text{fill:${inkDark}}}</style><rect width="64" height="64" rx="16"/><text x="32" y="43" text-anchor="middle" font-family="-apple-system,Segoe UI,Arial,sans-serif" font-size="32" font-weight="700">${esc(monogram(c))}</text></svg>`;
}

/** Deterministic 16x16 32-bit ICO derived from the brand accent & ink colors. */
export function faviconIco(c) {
  const parse = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [br, bg, bb] = parse(c.theme.accent);
  const [fr, fg, fb] = parse(c.theme.accentInk ?? '#ffffff');
  const w = 16;
  const h = 16;
  const headerSize = 6 + 16;
  const dibHeaderSize = 40;
  const pixelBytes = w * h * 4;
  const maskBytes = h * 4; // 16px wide -> 2 bytes padded to 4 bytes per row
  const bmpSize = dibHeaderSize + pixelBytes + maskBytes;
  const buf = new Uint8Array(headerSize + bmpSize);
  const view = new DataView(buf.buffer);
  // ICONDIR
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);
  // ICONDIRENTRY
  buf[6] = w;
  buf[7] = h;
  buf[8] = 0;
  buf[9] = 0;
  view.setUint16(10, 1, true);
  view.setUint16(12, 32, true);
  view.setUint32(14, bmpSize, true);
  view.setUint32(18, headerSize, true);
  // BITMAPINFOHEADER
  let o = headerSize;
  view.setUint32(o, dibHeaderSize, true);
  view.setInt32(o + 4, w, true);
  view.setInt32(o + 8, h * 2, true);
  view.setUint16(o + 12, 1, true);
  view.setUint16(o + 14, 32, true);
  view.setUint32(o + 20, pixelBytes + maskBytes, true);
  o += dibHeaderSize;
  // Pixels (bottom-up BGRA) — rounded 16x16 badge with centered accent-ink square
  for (let y = h - 1; y >= 0; y--) {
    for (let x = 0; x < w; x++) {
      const corner = (x === 0 || x === w - 1) && (y === 0 || y === h - 1);
      const inner = x >= 5 && x <= 10 && y >= 5 && y <= 10;
      buf[o++] = corner ? 0 : inner ? fb : bb;
      buf[o++] = corner ? 0 : inner ? fg : bg;
      buf[o++] = corner ? 0 : inner ? fr : br;
      buf[o++] = corner ? 0 : 255;
    }
  }
  return buf;
}

/** Branded 1200x630 Open Graph SVG card generated from content.json. */
export function ogImage(c) {
  const accent = c.theme.accent;
  const ink = c.theme.accentInk ?? '#ffffff';
  const headline = esc(c.todo ? `${c.domain} · Coming soon` : c.headline);
  const sub = esc(c.todo ? 'Something new is on the way.' : c.idea);
  const name = esc(c.name);
  const domain = esc(c.domain);
  const mark = esc(monogram(c));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><radialGradient id="g" cx="18%" cy="22%" r="65%"><stop offset="0%" stop-color="${accent}" stop-opacity=".22"/><stop offset="100%" stop-color="#0b0c0e" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="630" fill="#0b0c0e"/><rect width="1200" height="630" fill="url(#g)"/><rect x="80" y="76" width="64" height="64" rx="16" fill="${accent}"/><text x="112" y="119" text-anchor="middle" font-family="-apple-system,Segoe UI,Arial,sans-serif" font-size="34" font-weight="700" fill="${ink}">${mark}</text><text x="164" y="120" font-family="-apple-system,Segoe UI,Arial,sans-serif" font-size="32" font-weight="600" fill="#f3f4f6">${name}</text><text x="80" y="290" font-family="-apple-system,Segoe UI,Arial,sans-serif" font-size="56" font-weight="700" fill="#f3f4f6">${headline.slice(0, 44)}</text><text x="80" y="365" font-family="-apple-system,Segoe UI,Arial,sans-serif" font-size="28" fill="#a3a7b0">${sub.slice(0, 76)}</text><text x="80" y="556" font-family="-apple-system,Segoe UI,Arial,sans-serif" font-size="24" fill="#9499a3">${domain}</text></svg>`;
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
      const res = await handleRequest(c, request, env);
      if (request.method === 'HEAD') {
        return new Response(null, { status: res.status, headers: res.headers });
      }
      return res;
    },
  };
}

async function handleRequest(c, request, env) {
  const url = new URL(request.url);
  if (url.hostname === `www.${c.domain}`) {
    url.hostname = c.domain;
    return Response.redirect(url.toString(), 301);
  }
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  const isRead = method === 'GET' || method === 'HEAD';
  const nonce = nonceOf();
  const page = (body, status = 200, { allowTurnstile = false, cache = 'private, no-cache', extra = {} } = {}) =>
    new Response(body, {
      status,
      headers: htmlHeaders(nonce, { allowTurnstile, extra: { 'cache-control': cache, ...extra } }),
    });

  if (isRead && path === '/healthz') return json({ ok: true, app: c.source });
  if (isRead && path === '/favicon.svg') {
    return new Response(favicon(c), {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
        'cache-control': 'public, max-age=86400',
        ...baseSecurityHeaders(),
      },
    });
  }
  if (isRead && path === '/favicon.ico') {
    return new Response(faviconIco(c), {
      headers: {
        'content-type': 'image/x-icon',
        'cache-control': 'public, max-age=86400',
        ...baseSecurityHeaders(),
      },
    });
  }
  if (isRead && path === '/og.svg') {
    return new Response(ogImage(c), {
      headers: {
        'content-type': 'image/svg+xml; charset=utf-8',
        'content-security-policy': "default-src 'none'",
        'cache-control': 'public, max-age=86400',
        ...baseSecurityHeaders(),
      },
    });
  }
  if (isRead && path === '/robots.txt') {
    const robots = c.todo || c.noindex
      ? 'User-agent: *\nDisallow: /\n'
      : 'User-agent: *\nDisallow: /app\nDisallow: /app/\nDisallow: /login\nDisallow: /api/\n';
    return new Response(robots, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=3600',
        ...baseSecurityHeaders(),
      },
    });
  }

  if (isRead && path === '/') {
    const state = { joined: url.searchParams.has('joined'), error: url.searchParams.get('error') };
    return page(landing(c, env, { nonce, state }), 200, { allowTurnstile: c.form !== false });
  }
  if (method === 'POST' && path === '/api/lead') {
    if (c.form === false) return json({ ok: false, error: 'not-found' }, 404);
    return submitLead(c, request, env);
  }
  if (isRead && path === '/login') return page(login(c, { nonce }));
  if (isRead && path === '/privacy') return page(privacy(c, { nonce }));

  if (path === '/app' || path.startsWith('/app/')) {
    if (!isRead) {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { allow: 'GET, HEAD', 'cache-control': 'no-store', ...baseSecurityHeaders() },
      });
    }
    const who = await requireOwner(request, env);
    if (who.deny) {
      const text = who.deny === 'not-configured'
        ? 'The private area is not configured on this deployment yet.'
        : 'This area is restricted to the owner.';
      return page(message(c, { nonce, title: 'Access denied', text, status: 'Forbidden', path }), 403, { cache: 'no-store' });
    }
    if (path === '/app') {
      const r = await env.LEADS.fetch(`https://leads.internal/leads?${new URLSearchParams({ source: c.leadsScope === 'all' ? '' : c.source, format: 'json' })}`);
      const total = r.ok ? (await r.json()).stats.total : 0;
      return page(hub(c, { nonce, email: who.email, total }), 200, { cache: 'no-store' });
    }
    if (path === '/app/leads' || path === '/app/leads.csv') {
      const scopeAll = c.leadsScope === 'all';
      const source = scopeAll ? url.searchParams.get('source') || '' : c.source;
      const q = url.searchParams.get('q') || '';
      const csv = path.endsWith('.csv');
      const r = await env.LEADS.fetch(`https://leads.internal/leads?${new URLSearchParams({ source, q, format: csv ? 'csv' : 'json' })}`);
      if (!r.ok) return page(message(c, { nonce, title: 'Leads unavailable', text: 'The leads service did not respond. Try again shortly.', status: 'Error', path }), 502, { cache: 'no-store' });
      if (csv) {
        const safeSource = (source || 'all').replace(/[^a-z0-9-]/gi, '').slice(0, 40) || 'all';
        return new Response(r.body, {
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': `attachment; filename="leads-${safeSource}.csv"`,
            'cache-control': 'no-store',
            ...baseSecurityHeaders(),
          },
        });
      }
      const data = await r.json();
      return page(leadsView(c, { nonce, data, email: who.email, source: scopeAll ? source : '', q, sources: data.sourceList ?? [] }), 200, { cache: 'no-store' });
    }
  }
  return page(message(c, { nonce, title: 'Page not found', text: "That page doesn't exist.", path }), 404);
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
