import { AutoRouter, cors } from 'itty-router';

const { preflight, corsify } = cors({ origin: '*' });

const securityHeaders = (response) => {
  if (!(response instanceof Response)) return response;
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'");
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

const router = AutoRouter({
  before: [preflight],
  finally: [corsify, securityHeaders],
});

router.get('/api/health', () => ({ status: 'ok', service: 'duganlabs' }));

// Serve static assets through the binding so security headers apply
router.all('*', (request, env) => env.ASSETS.fetch(request));

export default {
  fetch: (request, env, ctx) => router.fetch(request, env, ctx),
};
