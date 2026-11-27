/**
 * Security headers applied to every marketing response.
 *
 * @param nonce Per-request CSP nonce. Pass it when the response body embeds
 *   the inline JSON-LD `<script>` so that tag (and only that tag) is allowed
 *   to run without leaning on a blanket 'unsafe-inline'. 'unsafe-inline' is
 *   still listed alongside it — nonce-aware browsers ignore 'unsafe-inline'
 *   once a nonce-source is present, so this is a no-op there and a fallback
 *   for anything older.
 */
export function securityHeaders(nonce?: string): Record<string, string> {
  return {
    'Content-Security-Policy': [
      "default-src 'self'",
      `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ''} 'unsafe-inline' https://static.cloudflareinsights.com`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data:",
      // fonts.googleapis.com: Cloudflare's bot-detection script re-fetches the
      // Google Fonts stylesheet href on the live site and needs connect-src to
      // allow it. static.cloudflareinsights.com: its own analytics beacon.
      "connect-src 'self' https://fonts.googleapis.com https://static.cloudflareinsights.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      'upgrade-insecure-requests',
    ].join('; '),
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // No 'bluetooth' — it isn't a recognised Permissions-Policy feature in
    // Chromium and just logs a console warning on every page load.
    'Permissions-Policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
}
