/**
 * `greenput-brand` — the Worker behind `brand.greenput.com`.
 *
 * One job: answer `GET /:slug/:version/card.png` and `/mark.png` with a PNG,
 * drawn by `routes/brand.ts` from the workspace row and cached at the edge.
 * `apps/api` and `apps/tenant-site` only ever *build* those URLs, through
 * `brandAssetUrls` in `libs/shared/design`; neither carries the rasterizer.
 *
 * No router, no auth, no CORS: a crawler fetching an `og:image` sends no
 * `Origin`, and the artwork is meant to be embedded from anywhere — including
 * a contractor's own custom domain, which is why every response says
 * `Cross-Origin-Resource-Policy: cross-origin`.
 */

import type { Env } from './env';
import { error, json, notFound } from './lib/response';
import { brandAssetRateLimit } from './lib/rate-limit';
import { handleBrandAsset, type BrandAssetDeps } from './routes/brand';

/** `/<slug>/<version>/<asset>` — exactly three non-empty segments. */
const ASSET_PATH = /^\/([^/]+)\/([^/]+)\/([^/]+)$/;

function decodeSegment(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * The headers every response leaves with. Smaller than `apps/api`'s set on
 * purpose: there is no HTML here to frame, no script to police, and the one
 * thing worth stating is that these bytes may be embedded cross-origin.
 */
function finish(response: Response, env: Env, method: string): Response {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'",
  );
  if (!headers.has('Cross-Origin-Resource-Policy')) {
    headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
  }
  if (env.ENVIRONMENT === 'production') {
    headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload',
    );
  }
  return new Response(method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * The fetch handler, with the rasterizer and the cache injectable so
 * `index.spec.ts` can exercise the real path parsing, the method handling and
 * the rate limit without WASM or a font CDN.
 */
export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext | undefined,
  deps: BrandAssetDeps = {},
): Promise<Response> {
  const method = request.method.toUpperCase();
  const url = new URL(request.url);

  if (url.pathname === '/health') {
    return finish(
      json({ status: 'ok', worker: 'greenput-brand' }),
      env,
      method,
    );
  }

  if (method !== 'GET' && method !== 'HEAD') {
    const res = error('Method not allowed', 405, 'METHOD_NOT_ALLOWED');
    res.headers.set('Allow', 'GET, HEAD');
    return finish(res, env, method);
  }

  const match = ASSET_PATH.exec(url.pathname);
  if (!match) return finish(notFound('Brand asset'), env, method);

  const slug = decodeSegment(match[1]);
  const version = decodeSegment(match[2]);
  const asset = decodeSegment(match[3]);
  if (slug === null || version === null || asset === null) {
    return finish(notFound('Brand asset'), env, method);
  }

  const limited = brandAssetRateLimit(request);
  if (limited) return finish(limited, env, method);

  const response = await handleBrandAsset({ slug, version, asset }, env, {
    ...deps,
    waitUntil:
      deps.waitUntil ??
      (ctx ? (promise: Promise<unknown>) => ctx.waitUntil(promise) : undefined),
  });
  return finish(response, env, method);
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx);
    } catch (err) {
      console.error('brand-assets: unhandled', err);
      return finish(
        error('Internal error', 500, 'INTERNAL_ERROR'),
        env,
        request.method,
      );
    }
  },
};
