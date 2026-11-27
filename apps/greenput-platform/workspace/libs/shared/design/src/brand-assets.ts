/**
 * Brand asset addressing — the one definition shared by the Worker that
 * *advertises* a share card and the Worker that *serves* one.
 *
 * `apps/tenant-site` puts a URL in `og:image`. `apps/brand-assets` answers it
 * at `brand.greenput.com`. If those two ever computed the URL differently, the
 * micro-site would advertise a card that 404s, and nothing in either project's
 * own test suite would notice — each would be consistent with itself. So the
 * URL, the version token in it, and the exact facts the card is allowed to
 * draw all live here, and both sides import them.
 *
 * ## Why the URL carries a version
 *
 * A share card is fetched by crawlers and cached by platforms for a long time,
 * so it wants `Cache-Control: immutable`. `immutable` is only safe on a URL
 * whose *content cannot change* — which is what {@link brandAssetVersion}
 * buys: it is a hash of every string the card draws, so renaming a business,
 * moving town, changing trade or uploading a logo all produce a different URL.
 * The old URL is then referenced by nothing.
 *
 * That is half of "stop serving a stale card". The other half is in
 * `apps/brand-assets/src/routes/brand.ts`: it keys its cache by the version it computes
 * from the *current* row rather than by the version in the request, so even a
 * crawler that kept the pre-rename URL is answered with the post-rename card.
 *
 * ## Why the facts are a closed object
 *
 * {@link ShareCardFacts} is the complete input to the card scene — the scene
 * function takes this and nothing else. So a field cannot be drawn on the card
 * without being in this object, and it cannot be in this object without being
 * hashed into the version. In particular there is no `phone`, and there must
 * never be one: the number is already published on the micro-site and in its
 * LocalBusiness JSON-LD, but a share card is a syndication surface — refetched
 * by crawlers, cached by platforms, reposted with the page stripped away — and
 * `/api/auth/otp/recovery/start` refuses to text a recovery code to
 * `workspaces.phone` *because* it is public. How much further it spreads is
 * that guard's business. `brand-assets.spec.ts` asserts the key set exactly.
 */

import { displayTrade } from '@greenput/shared/utils';

import { generatedIdentityFor, type GpBusinessRef } from './brand-identity.js';

/**
 * 1200x630. Above Facebook's 600x315 floor, exactly the 1.91:1 its docs ask
 * for, inside the 2:1..1:1 window X requires for `summary_large_image`, and
 * unfurled by Slack and LinkedIn without a re-crop.
 */
export const GP_SHARE_CARD_SIZE = Object.freeze({ width: 1200, height: 630 });

/** The square mark asset — for an invoice, an email, and JSON-LD `logo`. */
export const GP_MARK_ASSET_SIZE = Object.freeze({ width: 512, height: 512 });

/**
 * The platform's own card, and the last resort — kept, not replaced. A
 * micro-site served from an environment with no reachable API (staging and
 * preview, which have no `api.` hostname) still needs *an* `og:image`, and one
 * that says "Greenput" is better than a bare text stub.
 */
export const GP_GENERIC_SHARE_IMAGE = 'https://app.greenput.com/og-image.png';

/**
 * Bumped by hand when the card *drawing* changes rather than its data.
 *
 * Without it, a redesign would leave every already-crawled card sitting in
 * platform and edge caches under a URL whose version token had not moved,
 * behind an `immutable` header, for a year.
 */
export const GP_BRAND_ASSET_REVISION = '1';

/** The `workspaces` columns a brand asset is derived from. */
export interface GpBrandAssetSource extends GpBusinessRef {
  readonly trade?: string | null;
  readonly city?: string | null;
  readonly state?: string | null;
  /** The contractor's *own* logo. Never written by the generator. */
  readonly logo_url?: string | null;
  readonly custom_hostname?: string | null;
  readonly custom_domain_status?: string | null;
}

/**
 * Everything a brand asset may draw. Closed on purpose — see the module note.
 */
export interface ShareCardFacts {
  readonly name: string;
  /** `displayTrade(workspaces.trade)`. */
  readonly trade: string;
  /** "Austin, TX", or `''`. */
  readonly area: string;
  /** The site's own hostname — always ASCII for a Greenput subdomain. */
  readonly host: string;
  /** From {@link generatedIdentityFor}. `''` when nothing is drawable. */
  readonly initials: string;
  readonly markBg: string;
  readonly markFg: string;
  /** GP-109: the treatment, its accent colourway, the tile shape and the
   *  treatment's orientation — the axes that keep two contractors apart. */
  readonly markTreatment: string;
  readonly markAccent: string;
  readonly markShape: string;
  readonly markOrientation: string;
  /** The contractor's uploaded logo, or `''`. */
  readonly logoUrl: string;
}

/** The keys of {@link ShareCardFacts}, in hash order. The spec pins this. */
export const SHARE_CARD_FACT_KEYS: readonly (keyof ShareCardFacts)[] =
  Object.freeze([
    'area',
    'host',
    'initials',
    'logoUrl',
    'markAccent',
    'markBg',
    'markFg',
    'markOrientation',
    'markShape',
    'markTreatment',
    'name',
    'trade',
  ]);

/** The micro-site's own origin — a live custom domain, else the subdomain. */
export function tenantHostFor(source: GpBrandAssetSource): string {
  if (
    source.custom_domain_status === 'active' &&
    source.custom_hostname != null &&
    source.custom_hostname !== ''
  ) {
    return source.custom_hostname;
  }
  const slug = String(source.slug ?? '');
  return slug === '' ? 'greenput.com' : `${slug}.greenput.com`;
}

export function shareCardFactsFor(source: GpBrandAssetSource): ShareCardFacts {
  const identity = generatedIdentityFor(source);
  const city = String(source.city ?? '').trim();
  const state = String(source.state ?? '').trim();
  return {
    name: String(source.name ?? '').trim(),
    trade: displayTrade(String(source.trade ?? '')),
    area: city && state ? `${city}, ${state}` : city,
    host: tenantHostFor(source),
    initials: identity.initials,
    markBg: identity.variant.bg,
    markFg: identity.variant.fg,
    markTreatment: identity.treatment,
    markAccent: identity.accent.bg,
    markShape: identity.shape,
    markOrientation: String(identity.orientation),
    logoUrl: String(source.logo_url ?? '').trim(),
  };
}

/**
 * FNV-1a over the facts. Duplicated from `brand-identity.ts` on purpose: these
 * two hashes must be able to change independently — repainting the palette must
 * not have to bust every card URL, and bumping the card revision must not
 * repaint anybody's mark.
 */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Eight lowercase hex characters identifying this exact card content.
 *
 * Serialised through `SHARE_CARD_FACT_KEYS` rather than `Object.keys` so the
 * token does not depend on property insertion order, and length-prefixed so
 * `{name: 'ab', trade: 'c'}` and `{name: 'a', trade: 'bc'}` cannot hash alike.
 */
export function brandAssetVersion(facts: ShareCardFacts): string {
  const parts: string[] = [`r${GP_BRAND_ASSET_REVISION}`];
  for (const key of SHARE_CARD_FACT_KEYS) {
    const value = String(facts[key] ?? '');
    parts.push(`${key}:${value.length}:${value}`);
  }
  return fnv1a32(parts.join('')).toString(16).padStart(8, '0');
}

/** Shape of the two absolute URLs, or `null` when no brand origin is known. */
export interface BrandAssetUrls {
  readonly cardUrl: string;
  readonly markUrl: string;
  readonly version: string;
}

/**
 * Normalise the brand-assets origin (`https://brand.greenput.com` in
 * production; empty in staging and preview, which have no such hostname).
 * Returns `''` for anything that is not an absolute `https:`/`http:` origin —
 * an unset binding, a stray slash, a `javascript:` URL someone put in a
 * `[vars]` block — so a caller can only ever emit an absolute URL or no URL at
 * all.
 */
export function normaliseBrandOrigin(raw: string | null | undefined): string {
  const value = String(raw ?? '').trim();
  if (value === '') return '';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return '';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  return url.origin;
}

/**
 * The two brand asset URLs for a workspace, or `null` when they cannot be
 * addressed — no brand origin configured, or a workspace with no slug (nothing
 * to key the route on; five rows in `greenput` are in that state).
 *
 * The slug is percent-encoded even though `workspaceSlugCandidates` can only
 * produce `[a-z0-9-]`: these URLs are built from a database row, and a row is
 * not a proof about a function.
 */
export function brandAssetUrls(
  brandOrigin: string | null | undefined,
  source: GpBrandAssetSource,
  facts: ShareCardFacts = shareCardFactsFor(source),
): BrandAssetUrls | null {
  const origin = normaliseBrandOrigin(brandOrigin);
  const slug = String(source.slug ?? '').trim();
  if (origin === '' || slug === '') return null;
  const version = brandAssetVersion(facts);
  const base = `${origin}/${encodeURIComponent(slug)}/${version}`;
  return {
    cardUrl: `${base}/card.png`,
    markUrl: `${base}/mark.png`,
    version,
  };
}
