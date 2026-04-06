import { AutoRouter, cors } from 'itty-router';

const { preflight, corsify } = cors({ origin: '*' });

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const router = AutoRouter({ before: [preflight], finally: [corsify] });

router.get('/api/health', () => ({ status: 'ok', service: 'duganlabs' }));

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API routes go through the router
    if (url.pathname.startsWith('/api/')) {
      const response = await router.fetch(request, env, ctx);
      return withSecurityHeaders(response);
    }

    // Everything else served from static assets with security headers
    const assetResponse = await env.ASSETS.fetch(new Request(request.url, { headers: request.headers }));
    return withSecurityHeaders(assetResponse);
  },
};
