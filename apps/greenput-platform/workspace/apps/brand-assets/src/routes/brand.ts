/**
 * Public brand assets: the share card a micro-site advertises in `og:image`,
 * and the square mark an invoice or an email can point at.
 *
 *   GET https://brand.greenput.com/:slug/:version/card.png   1200x630
 *   GET https://brand.greenput.com/:slug/:version/mark.png   512x512
 *
 * This is its own Worker (`apps/brand-assets`, GP-108) because the rasterizer
 * is 2.4 MB of WASM. It used to sit in `apps/api`, which serves every
 * authenticated request in the product — so a cold start that tripped the
 * 1-second startup CPU limit would have failed sign-in, leads, jobs and
 * billing at once, not a picture. Here the blast radius of a slow start is one
 * crawler's image fetch. `apps/tenant-site` was kept clear of it for the same
 * reason from the start — see the note at the top of `../lib/brand-card.ts`.
 *
 * ## How a renamed business stops serving its old card
 *
 * Two mechanisms, and it takes both:
 *
 * 1. **The URL moves.** `:version` is a hash of every string the card draws
 *    (`brandAssetVersion` in `libs/shared/design`), so a rename, a move, a new
 *    trade or an uploaded logo all change the URL the micro-site advertises.
 *    That is what makes `Cache-Control: immutable` honest on the canonical URL.
 *
 * 2. **The old URL is not honoured.** This route reads the workspace row on
 *    every request and keys its cache by the version it computes *from that
 *    row* — never by the version in the path. So a platform that kept the
 *    pre-rename URL and refetches it is answered with the post-rename card, and
 *    that answer is sent with a five-minute `max-age` instead of `immutable`
 *    because the URL no longer describes its content.
 *
 *    Mechanism 1 alone would leave stale bytes cached under the old URL behind
 *    an `immutable` header for a year. Mechanism 2 alone would need every
 *    downstream cache to revalidate. The cost of doing both is one indexed D1
 *    read per request, which is why the *render* is cached and the *lookup* is
 *    not.
 *
 * ## Two things the cache does not do
 *
 * `caches.default` is per-colo: N distinct cards is N renders *per
 * datacenter*, not N renders globally. And Cloudflare's cache key does not
 * include the hostname, so the synthetic `brand-assets.greenput.internal`
 * origin in the key namespaces nothing — only the path prefix does. Both are
 * fine at this scale; neither should be relied on for more than they are.
 *
 * ## What is deliberately not on the card
 *
 * `workspaces.phone`. It is already on the micro-site and in its LocalBusiness
 * JSON-LD, but a share card is refetched by crawlers, cached by platforms and
 * reposted with the page stripped away, and
 * `/api/auth/otp/recovery/start` refuses to text a recovery code to that number
 * *because* it is public. The number cannot reach this file: the scene draws
 * only `ShareCardFacts`, which has no phone field. `brand.spec.ts` and
 * `brand-assets.spec.ts` both hold that line.
 */

import { pngHeaders, renderSvg } from '@basenative/og-image';
import {
  GP_GENERIC_SHARE_IMAGE,
  GP_MARK_ASSET_SIZE,
  GP_SHARE_CARD_SIZE,
  brandAssetVersion,
  shareCardFactsFor,
  type GpBrandAssetSource,
  type ShareCardFacts,
} from '@greenput/shared/design';

import type { Env } from '../env';
import { error, notFound } from '../lib/response';
import {
  CARD_FONT_FAMILY,
  markAssetSvg,
  shareCardSvg,
  type BrandSceneOptions,
} from '../lib/brand-card';

/**
 * Archivo, the family every other Greenput surface is set in (`GP_FONT_HREF`).
 *
 * `ttf`, not `woff`: resvg's font parser cannot read WOFF and fails by drawing
 * *no glyphs at all* rather than by throwing — a correctly sized card with the
 * text missing. `cacheBinding: null` says "there is deliberately no KV here":
 * the library fetches fonts with `cf: { cacheEverything: true }`, so
 * Cloudflare's own edge cache absorbs the cold fetch, and a new KV namespace id
 * would have to be kept straight across three `wrangler*.toml` files for no
 * gain.
 */
const CARD_FONTS = {
  family: CARD_FONT_FAMILY,
  format: 'ttf' as const,
  weights: [600, 800],
  cacheBinding: null,
  urls: {
    600: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/archivo@0.2.3/Archivo_600SemiBold.ttf',
    800: 'https://cdn.jsdelivr.net/npm/@expo-google-fonts/archivo@0.2.3/Archivo_800ExtraBold.ttf',
  },
};

/** A version token this route will answer at all. */
const VERSION_PATTERN = /^[0-9a-f]{4,32}$/;

/** Uploaded logos larger than this are not embedded — the generated mark is. */
const MAX_LOGO_BYTES = 512 * 1024;

/** Formats resvg can decode from a data URI. */
const EMBEDDABLE_LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg']);

const LOGO_FETCH_TIMEOUT_MS = 3000;

/** Seam for tests. Every field defaults to the real thing. */
export interface BrandAssetDeps {
  rasterize?: (
    svg: string,
    env: Env,
    width: number,
  ) => Promise<Uint8Array | ArrayBuffer>;
  fetchLogo?: (url: string, init: RequestInit) => Promise<Response>;
  /** `null` means "do not cache" (the Workers `caches` global is absent). */
  cache?: Cache | null;
  waitUntil?: (promise: Promise<unknown>) => void;
}

/** The three path segments, already split and decoded by the entry point. */
export interface BrandAssetParams {
  readonly slug: string;
  readonly version: string;
  readonly asset: string;
}

const WORKSPACE_COLUMNS =
  'name, slug, trade, city, state, logo_url, custom_hostname, custom_domain_status';

type WorkspaceRow = GpBrandAssetSource & { name: string };

async function defaultRasterize(
  svg: string,
  env: Env,
  width: number,
): Promise<Uint8Array> {
  return renderSvg(svg, env as unknown as Record<string, unknown>, {
    width,
    fonts: CARD_FONTS,
  });
}

/**
 * Is this host one we are willing to fetch a contractor's logo from?
 *
 * `logo_url` is written by an authenticated owner through `PATCH
 * /api/workspace`, so this is not an open redirector — but it is still a URL
 * this Worker dereferences, and "an owner typed it" is not the same as "it is
 * safe to ask our edge to fetch it". IP literals, single-label hosts and the
 * private-network suffixes are refused; everything else is a public name.
 */
function isFetchableLogoHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === '' || host === 'localhost') return false;
  // Bracketed IPv6, or a dotted-quad / bare-number IPv4.
  if (host.startsWith('[') || /^[0-9.]+$/.test(host)) return false;
  if (!host.includes('.')) return false;
  return !/\.(local|internal|localdomain|home|lan)$/.test(host);
}

function toBase64(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

/**
 * Fetch the contractor's own logo and turn it into a `data:` URI the rasterizer
 * can draw.
 *
 * Returns `undefined` for every failure — a bad URL, a private host, a non-200,
 * a format resvg cannot decode, an oversize body, a timeout, a network error.
 * The caller then draws the generated mark. A card is never failed over a logo:
 * the whole point of this work is that a contractor who has not given us an
 * image still gets one.
 */
async function embedUploadedLogo(
  logoUrl: string,
  deps: BrandAssetDeps,
): Promise<string | undefined> {
  if (logoUrl === '') return undefined;
  let parsed: URL;
  try {
    parsed = new URL(logoUrl);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'https:') return undefined;
  if (!isFetchableLogoHost(parsed.hostname)) return undefined;

  const doFetch = deps.fetchLogo ?? ((url, init) => fetch(url, init));
  try {
    const res = await doFetch(parsed.toString(), {
      redirect: 'follow',
      signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS),
      cf: { cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return undefined;

    const type = (res.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!EMBEDDABLE_LOGO_TYPES.has(type)) return undefined;

    const declared = Number(res.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_LOGO_BYTES)
      return undefined;

    const bytes = new Uint8Array(await res.arrayBuffer());
    // Checked again against the real body: Content-Length can lie, or be absent
    // on a chunked response.
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_BYTES) {
      return undefined;
    }
    const mime = type === 'image/jpg' ? 'image/jpeg' : type;
    return `data:${mime};base64,${toBase64(bytes)}`;
  } catch {
    return undefined;
  }
}

/**
 * A crawler that asked for a card we could not draw still gets an image: the
 * platform's own 1200x630 card, which is what every other Greenput property
 * points at. Short `max-age` so a transient failure is not cached for long.
 */
function genericCardRedirect(): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: GP_GENERIC_SHARE_IMAGE,
      'Cache-Control': 'public, max-age=60',
    },
  });
}

interface AssetSpec {
  readonly kind: 'card' | 'mark';
  readonly width: number;
  readonly svg: (facts: ShareCardFacts, options: BrandSceneOptions) => string;
}

const ASSETS: Record<string, AssetSpec> = {
  'card.png': {
    kind: 'card',
    width: GP_SHARE_CARD_SIZE.width,
    svg: shareCardSvg,
  },
  'mark.png': {
    kind: 'mark',
    width: GP_MARK_ASSET_SIZE.width,
    svg: markAssetSvg,
  },
};

/**
 * The handler, separated from the entry point so a spec can drive it with
 * injected dependencies instead of a WASM rasterizer and a live font CDN.
 */
export async function handleBrandAsset(
  params: BrandAssetParams,
  env: Env,
  deps: BrandAssetDeps = {},
): Promise<Response> {
  const { slug, version: requestedVersion, asset: assetName } = params;

  const asset = ASSETS[assetName];
  if (!asset) return notFound('Brand asset');
  if (!VERSION_PATTERN.test(requestedVersion)) {
    return error('Invalid asset version', 400, 'VALIDATION_ERROR');
  }
  if (slug === '') return notFound('Workspace');

  const row = await env.DB.prepare(
    `SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE slug = ? LIMIT 1`,
  )
    .bind(slug)
    .first<WorkspaceRow>();

  if (!row) return notFound('Workspace');

  const facts = shareCardFactsFor(row);
  const canonicalVersion = brandAssetVersion(facts);
  const isCanonical = canonicalVersion === requestedVersion;

  // Keyed by the version computed from the row, NOT by the one in the path.
  // That is what stops a pre-rename URL from serving pre-rename bytes.
  const cacheUrl = `https://brand-assets.greenput.internal/${encodeURIComponent(
    slug,
  )}/${canonicalVersion}/${asset.kind}.png`;
  const cacheKey = new Request(cacheUrl, { method: 'GET' });
  const cache =
    deps.cache !== undefined
      ? deps.cache
      : typeof caches !== 'undefined'
        ? caches.default
        : null;

  let body: BodyInit | null = null;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) body = await hit.arrayBuffer();
  }

  if (body === null) {
    const embedded = await embedUploadedLogo(facts.logoUrl, deps);
    const options: BrandSceneOptions =
      embedded !== undefined ? { logoDataUri: embedded } : {};

    let rendered: Uint8Array | ArrayBuffer;
    try {
      const rasterize = deps.rasterize ?? defaultRasterize;
      rendered = await rasterize(asset.svg(facts, options), env, asset.width);
    } catch {
      // A font CDN outage, a WASM init failure, or a logo that decoded to
      // something resvg rejected. Never a 500 on a crawler's image fetch.
      return genericCardRedirect();
    }
    body =
      rendered instanceof Uint8Array
        ? (rendered.slice().buffer as ArrayBuffer)
        : rendered;

    if (cache) {
      // Stored `immutable` under the canonical key regardless of what the
      // caller asked for; the *response* below decides what the caller is told.
      const stored = new Response(body, {
        headers: { ...pngHeaders({ immutable: true }), Vary: 'Origin' },
      });
      const put = cache.put(cacheKey, stored);
      if (deps.waitUntil) deps.waitUntil(put);
      else await put;
    }
  }

  return new Response(body, {
    headers: {
      // `immutable` only when the URL genuinely describes these bytes. When it
      // does not — a crawler holding a pre-rename URL — the current card is
      // still served, but for five minutes rather than a year.
      ...pngHeaders(
        isCanonical ? { immutable: true } : { immutable: false, maxAge: 300 },
      ),
      // Public artwork, meant to be embedded from a contractor's own custom
      // domain. `applySecurityHeaders` defaults to `same-site` in production,
      // which would refuse exactly that; an explicit value wins there.
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Gp-Brand-Version': canonicalVersion,
      Vary: 'Origin',
    },
  });
}
