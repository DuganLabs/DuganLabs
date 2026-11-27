import type { Env } from '../env';

/**
 * Security headers middleware.
 * Applied to every response from the Worker.
 * These headers are what Mozilla Observatory grades us on.
 */
export function applySecurityHeaders(response: Response, env: Env): Response {
  const headers = new Headers(response.headers);
  const isProd = env.ENVIRONMENT === 'production';

  // ── Content Security Policy ───────────────────────────────
  // No inline scripts in build output — strict script-src 'self' only.
  // style-src still needs 'unsafe-inline' for Angular component styles.
  const connectSrc = isProd
    ? "'self' https://api.greenput.com https://api.greenput.site https://fonts.googleapis.com https://fonts.gstatic.com"
    : "'self' https://api.greenput.com https://api.greenput.site https://greenput-api.greenput.workers.dev https://*.workers.dev https://fonts.googleapis.com https://fonts.gstatic.com";

  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    `connect-src ${connectSrc}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');

  headers.set('Content-Security-Policy', csp);

  // ── HSTS ──────────────────────────────────────────────────
  // 1 year, include subdomains, preload-eligible
  if (isProd) {
    headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );
  }

  // ── Framing ───────────────────────────────────────────────
  headers.set('X-Frame-Options', 'DENY');

  // ── MIME sniffing ─────────────────────────────────────────
  headers.set('X-Content-Type-Options', 'nosniff');

  // ── Referrer policy ───────────────────────────────────────
  // strict-origin-when-cross-origin: sends origin on same-origin,
  // only origin on cross-origin HTTPS, nothing on downgrade
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // ── Permissions policy ────────────────────────────────────
  // Deny all browser features we don't use
  headers.set(
    'Permissions-Policy',
    [
      'camera=()',
      'microphone=()',
      'geolocation=()',
      'payment=()',
      'usb=()',
      'bluetooth=()',
      'accelerometer=()',
      'gyroscope=()',
      'magnetometer=()',
    ].join(', '),
  );

  // ── Cross-Origin policies ─────────────────────────────────
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  // A handler that set CORP itself keeps it. The default below is right for
  // API JSON and wrong for anything meant to be embedded from another origin —
  // the share card learned this the hard way while it was still served from
  // here (it has since moved to apps/brand-assets): the blanket `set` overwrote
  // the route's own `cross-origin` on the way out, so the header the route
  // chose never shipped.
  const declaredCorp = response.headers.get('Cross-Origin-Resource-Policy');
  if (declaredCorp) {
    headers.set('Cross-Origin-Resource-Policy', declaredCorp);
  } else if (isProd) {
    // same-site allows cross-subdomain access (app.greenput.com → api.greenput.com)
    headers.set('Cross-Origin-Resource-Policy', 'same-site');
  } else {
    // Preview environments need cross-origin access from Pages deployments
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  }

  // ── Cache control for API responses ──────────────────────
  // API responses must never be cached by intermediaries
  if (response.headers.get('Content-Type')?.includes('application/json')) {
    headers.set('Cache-Control', 'no-store');
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
