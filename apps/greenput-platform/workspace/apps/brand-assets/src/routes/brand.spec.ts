import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  brandAssetUrls,
  brandAssetVersion,
  shareCardFactsFor,
  type GpBrandAssetSource,
} from '@greenput/shared/design';
import { BRAND_ASSET_CASES } from '../../../../libs/shared/design/src/brand-assets.fixtures';

import type { Env } from '../env';
import { handleRequest } from '../index';
import { handleBrandAsset, type BrandAssetDeps } from './brand';

const BRAND_ORIGIN = 'https://brand.greenput.com';

type Row = GpBrandAssetSource & { name: string };

const REED: Row = {
  name: 'Reed HVAC',
  slug: 'reed-hvac',
  trade: 'hvac',
  city: 'Austin',
  state: 'TX',
  logo_url: null,
  custom_hostname: null,
  custom_domain_status: null,
};

/**
 * A D1 stand-in over ONE mutable row, keyed by slug the way the real query is.
 *
 * Mutable on purpose: the rename tests change the row between two requests and
 * assert the second request does not serve the first one's bytes. A fixture that
 * could not change could not show that.
 */
function createEnv(rows: Record<string, Row | null>) {
  const sql: string[] = [];
  const env = {
    DB: {
      prepare: (query: string) => {
        sql.push(query);
        return {
          bind: (...args: unknown[]) => ({
            first: async () => rows[String(args[0])] ?? null,
          }),
        };
      },
    },
    ENVIRONMENT: 'test',
  } as unknown as Env;
  return { env, sql, rows };
}

/** A rasterizer stand-in that records the SVG it was asked to draw. */
function createRasterizer() {
  const svgs: string[] = [];
  const widths: number[] = [];
  const rasterize = vi.fn(async (svg: string, _env: Env, width: number) => {
    svgs.push(svg);
    widths.push(width);
    // A real 1x1 PNG header, so anything sniffing the bytes sees a PNG.
    return new Uint8Array([0x89, 0x50, 0x4e, 0x47, svgs.length]);
  });
  return { rasterize, svgs, widths };
}

/** An in-memory Cache API stand-in with the two methods the route uses. */
function createCache() {
  const store = new Map<string, ArrayBuffer>();
  return {
    store,
    cache: {
      match: async (key: Request) => {
        const hit = store.get(key.url);
        return hit ? new Response(hit) : undefined;
      },
      put: async (key: Request, res: Response) => {
        store.set(key.url, await res.arrayBuffer());
      },
    } as unknown as Cache,
  };
}

async function call(
  slug: string,
  version: string,
  asset: string,
  env: Env,
  deps: BrandAssetDeps,
): Promise<Response> {
  return handleBrandAsset({ slug, version, asset }, env, deps);
}

/** The whole Worker — real path parsing, real headers — with injected deps. */
async function fetchWorker(
  path: string,
  env: Env,
  deps: BrandAssetDeps,
  init?: RequestInit,
): Promise<Response> {
  return handleRequest(
    new Request(`${BRAND_ORIGIN}${path}`, init),
    env,
    undefined,
    deps,
  );
}

describe('GET /:slug/:version/:asset — refusals', () => {
  it('404s an unknown slug without rendering anything', async () => {
    const { env } = createEnv({});
    const { rasterize } = createRasterizer();
    const res = await call('nobody', 'deadbeef', 'card.png', env, {
      rasterize,
      cache: null,
    });
    expect(res.status).toBe(404);
    expect(rasterize).not.toHaveBeenCalled();
  });

  it('404s an asset name it does not serve', async () => {
    const { env } = createEnv({ 'reed-hvac': REED });
    const { rasterize } = createRasterizer();
    for (const asset of ['logo.svg', 'card.jpg', '../../index.js', '']) {
      const res = await call('reed-hvac', 'deadbeef', asset, env, {
        rasterize,
        cache: null,
      });
      expect(res.status, asset).toBe(404);
    }
    expect(rasterize).not.toHaveBeenCalled();
  });

  it('400s a version token that is not one we could have minted', async () => {
    const { env } = createEnv({ 'reed-hvac': REED });
    const { rasterize } = createRasterizer();
    for (const version of ['', 'xyz', 'ZZZZZZZZ', 'a'.repeat(64), '../..']) {
      const res = await call('reed-hvac', version, 'card.png', env, {
        rasterize,
        cache: null,
      });
      expect(res.status, version).toBe(400);
    }
    expect(rasterize).not.toHaveBeenCalled();
  });

  it('never asks the database for the phone number', async () => {
    const { env, sql } = createEnv({ 'reed-hvac': REED });
    const version = brandAssetVersion(shareCardFactsFor(REED));
    await call('reed-hvac', version, 'card.png', env, {
      rasterize: createRasterizer().rasterize,
      cache: null,
    });
    expect(sql).toHaveLength(1);
    expect(sql[0]).not.toContain('phone');
    expect(sql[0]).toContain('WHERE slug = ?');
  });
});

describe('the canonical URL', () => {
  let version: string;
  beforeEach(() => {
    version = brandAssetVersion(shareCardFactsFor(REED));
  });

  it('serves an immutable PNG and names the version it drew', async () => {
    const { env } = createEnv({ 'reed-hvac': REED });
    const { rasterize, widths } = createRasterizer();
    const res = await call('reed-hvac', version, 'card.png', env, {
      rasterize,
      cache: null,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    expect(res.headers.get('X-Gp-Brand-Version')).toBe(version);
    // Public artwork, embeddable from a contractor's own custom domain.
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe(
      'cross-origin',
    );
    expect(res.headers.get('Vary')).toBe('Origin');
    expect(widths).toEqual([1200]);
    expect(new Uint8Array(await res.arrayBuffer()).slice(0, 4)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
  });

  it('rasterizes the mark at 512', async () => {
    const { env } = createEnv({ 'reed-hvac': REED });
    const { rasterize, widths } = createRasterizer();
    const res = await call('reed-hvac', version, 'mark.png', env, {
      rasterize,
      cache: null,
    });
    expect(res.status).toBe(200);
    expect(widths).toEqual([512]);
  });

  it('renders once and serves the cache after that', async () => {
    const { env } = createEnv({ 'reed-hvac': REED });
    const { rasterize } = createRasterizer();
    const { cache, store } = createCache();
    await call('reed-hvac', version, 'card.png', env, { rasterize, cache });
    await call('reed-hvac', version, 'card.png', env, { rasterize, cache });
    expect(rasterize).toHaveBeenCalledTimes(1);
    expect(store.size).toBe(1);
  });

  it('keys the card and the mark separately', async () => {
    const { env } = createEnv({ 'reed-hvac': REED });
    const { rasterize } = createRasterizer();
    const { cache, store } = createCache();
    await call('reed-hvac', version, 'card.png', env, { rasterize, cache });
    await call('reed-hvac', version, 'mark.png', env, { rasterize, cache });
    expect(rasterize).toHaveBeenCalledTimes(2);
    expect(store.size).toBe(2);
  });

  it('never draws the phone number', async () => {
    const withPhone = {
      ...REED,
      ...({ phone: '+15125550142' } as Record<string, unknown>),
    } as Row;
    const { env } = createEnv({ 'reed-hvac': withPhone });
    const { rasterize, svgs } = createRasterizer();
    await call(
      'reed-hvac',
      brandAssetVersion(shareCardFactsFor(withPhone)),
      'card.png',
      env,
      { rasterize, cache: null },
    );
    expect(svgs[0]).not.toContain('5125550142');
    expect(svgs[0]).not.toContain('+1');
  });
});

describe('a renamed business stops serving its old card', () => {
  it('gives the pre-rename URL the post-rename card, and stops calling it immutable', async () => {
    // THE test for this feature. A platform that cached only the URL and
    // refetches it must not be handed the old bytes.
    const state = createEnv({ 'reed-hvac': { ...REED } });
    const { rasterize, svgs } = createRasterizer();
    const { cache } = createCache();

    const v1 = brandAssetVersion(shareCardFactsFor(REED));
    const first = await call('reed-hvac', v1, 'card.png', state.env, {
      rasterize,
      cache,
    });
    expect(first.headers.get('Cache-Control')).toContain('immutable');
    expect(svgs[0]).toContain('Reed HVAC');

    // The contractor renames their business. Nothing else changes — same slug,
    // same row, same cache, same URL in every crawler's index.
    state.rows['reed-hvac'] = { ...REED, name: 'Reed Heating & Air' };
    const v2 = brandAssetVersion(
      shareCardFactsFor(state.rows['reed-hvac'] as Row),
    );
    expect(v2).not.toBe(v1);

    const stale = await call('reed-hvac', v1, 'card.png', state.env, {
      rasterize,
      cache,
    });
    expect(stale.status).toBe(200);
    // Re-rendered from the current row, not served from the v1 cache entry.
    expect(rasterize).toHaveBeenCalledTimes(2);
    expect(svgs[1]).toContain('Reed Heating &amp; Air');
    expect(svgs[1]).not.toContain('>Reed HVAC<');
    expect(stale.headers.get('X-Gp-Brand-Version')).toBe(v2);
    // And it is no longer immutable, because the URL no longer describes it.
    expect(stale.headers.get('Cache-Control')).not.toContain('immutable');
    expect(stale.headers.get('Cache-Control')).toContain('max-age=300');

    // The new canonical URL is immutable and shares the v2 cache entry.
    const fresh = await call('reed-hvac', v2, 'card.png', state.env, {
      rasterize,
      cache,
    });
    expect(fresh.headers.get('Cache-Control')).toContain('immutable');
    expect(rasterize).toHaveBeenCalledTimes(2);
  });

  it('invalidates on an uploaded logo, a move and a trade change too', async () => {
    for (const changed of [
      { logo_url: 'https://cdn.example/l.png' },
      { city: 'Dallas' },
      { trade: 'plumbing' },
      { custom_hostname: 'reedhvac.com', custom_domain_status: 'active' },
    ]) {
      const state = createEnv({ 'reed-hvac': { ...REED } });
      const { rasterize } = createRasterizer();
      const { cache } = createCache();
      const v1 = brandAssetVersion(shareCardFactsFor(REED));
      await call('reed-hvac', v1, 'card.png', state.env, { rasterize, cache });
      state.rows['reed-hvac'] = { ...REED, ...changed };
      const stale = await call('reed-hvac', v1, 'card.png', state.env, {
        rasterize,
        cache,
      });
      expect(rasterize, JSON.stringify(changed)).toHaveBeenCalledTimes(2);
      expect(stale.headers.get('Cache-Control')).not.toContain('immutable');
    }
  });
});

describe('the contractor’s own uploaded logo', () => {
  const withLogo: Row = { ...REED, logo_url: 'https://cdn.example/logo.png' };
  let version: string;
  beforeEach(() => {
    version = brandAssetVersion(shareCardFactsFor(withLogo));
  });

  function pngResponse(bytes: number, type = 'image/png'): Response {
    return new Response(new Uint8Array(bytes).fill(0x41), {
      status: 200,
      headers: { 'content-type': type, 'content-length': String(bytes) },
    });
  }

  it('embeds it as a data URI when it passes every guard', async () => {
    const { env } = createEnv({ 'reed-hvac': withLogo });
    const { rasterize, svgs } = createRasterizer();
    const fetchLogo = vi.fn(async () => pngResponse(64));
    await call('reed-hvac', version, 'card.png', env, {
      rasterize,
      cache: null,
      fetchLogo,
    });
    expect(fetchLogo).toHaveBeenCalledWith(
      'https://cdn.example/logo.png',
      expect.objectContaining({ redirect: 'follow' }),
    );
    expect(svgs[0]).toContain('<image');
    expect(svgs[0]).toContain('href="data:image/png;base64,');
  });

  it.each([
    ['a non-200', async () => new Response('nope', { status: 404 })],
    ['an SVG', async () => pngResponse(64, 'image/svg+xml')],
    ['HTML', async () => pngResponse(64, 'text/html')],
    ['an empty body', async () => pngResponse(0)],
    ['an oversize body', async () => pngResponse(600 * 1024)],
    [
      'a lying Content-Length',
      async () =>
        new Response(new Uint8Array(600 * 1024), {
          headers: { 'content-type': 'image/png', 'content-length': '10' },
        }),
    ],
    [
      'a network error',
      async () => {
        throw new Error('ECONNRESET');
      },
    ],
    [
      'a timeout',
      async () => {
        throw new DOMException('aborted', 'TimeoutError');
      },
    ],
  ])('draws the generated tile instead of %s', async (_label, fetchLogo) => {
    const { env } = createEnv({ 'reed-hvac': withLogo });
    const { rasterize, svgs } = createRasterizer();
    const res = await call('reed-hvac', version, 'card.png', env, {
      rasterize,
      cache: null,
      fetchLogo: fetchLogo as BrandAssetDeps['fetchLogo'],
    });
    // A card is never failed over a logo.
    expect(res.status).toBe(200);
    expect(svgs[0]).not.toContain('<image');
    expect(svgs[0]).toContain('Reed HVAC');
  });

  it.each([
    'http://cdn.example/logo.png',
    'https://127.0.0.1/logo.png',
    'https://10.0.0.5/logo.png',
    'https://[::1]/logo.png',
    'https://localhost/logo.png',
    'https://metadata/logo.png',
    'https://router.local/logo.png',
    'file:///etc/passwd',
    'not a url at all',
  ])('never dereferences %s', async (logoUrl) => {
    const row: Row = { ...REED, logo_url: logoUrl };
    const { env } = createEnv({ 'reed-hvac': row });
    const { rasterize, svgs } = createRasterizer();
    const fetchLogo = vi.fn(async () => pngResponse(64));
    const res = await call(
      'reed-hvac',
      brandAssetVersion(shareCardFactsFor(row)),
      'card.png',
      env,
      { rasterize, cache: null, fetchLogo },
    );
    expect(fetchLogo).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(svgs[0]).not.toContain('<image');
  });
});

describe('when the render itself fails', () => {
  it('redirects to the generic Greenput card rather than 500ing a crawler', async () => {
    const { env } = createEnv({ 'reed-hvac': REED });
    const res = await call(
      'reed-hvac',
      brandAssetVersion(shareCardFactsFor(REED)),
      'card.png',
      env,
      {
        rasterize: async () => {
          throw new Error('font CDN unreachable');
        },
        cache: null,
      },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(
      'https://app.greenput.com/og-image.png',
    );
    // Short, so a transient outage is not cached for a year.
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
  });

  it('caches nothing when the render failed', async () => {
    const { env } = createEnv({ 'reed-hvac': REED });
    const { cache, store } = createCache();
    await call(
      'reed-hvac',
      brandAssetVersion(shareCardFactsFor(REED)),
      'card.png',
      env,
      {
        rasterize: async () => {
          throw new Error('boom');
        },
        cache,
      },
    );
    expect(store.size).toBe(0);
  });
});

describe('producer and consumer, from the one fixture table', () => {
  // The URL is built here EXACTLY as apps/tenant-site builds it for og:image
  // (same function, same table — see brand-assets.fixtures.ts) and then routed
  // through the real Worker entry point. Neither side gets to be green on its
  // own idea of the URL shape.
  it.each(
    BRAND_ASSET_CASES.filter((c) => c.addressable).map(
      (c) => [c.label, c] as const,
    ),
  )(
    '%s: the og:image URL resolves to that tenant’s card',
    async (_label, c) => {
      const urls = brandAssetUrls(BRAND_ORIGIN, c.workspace);
      expect(urls).not.toBeNull();
      expect(new URL(urls?.cardUrl ?? '').origin).toBe(BRAND_ORIGIN);
      const path = new URL(urls?.cardUrl ?? '').pathname;

      const slug = String(c.workspace.slug);
      const { env } = createEnv({ [slug]: c.workspace as Row });
      const { rasterize, svgs } = createRasterizer();
      // The REAL entry point — real path pattern, real decoding — with the
      // rasterizer injected so the suite needs neither WASM nor the font CDN.
      const res = await fetchWorker(path, env, { rasterize, cache: null });

      expect(res.status, path).toBe(200);
      expect(res.headers.get('X-Gp-Brand-Version')).toBe(c.version);
      expect(res.headers.get('Cache-Control')).toContain('immutable');
      expect(res.headers.get('Content-Type')).toBe('image/png');
      // The card the crawler is handed is this tenant's, not a neighbour's.
      expect(svgs).toHaveLength(1);
      expect(svgs[0]).toContain(
        c.workspace.custom_domain_status === 'active'
          ? String(c.workspace.custom_hostname)
          : `${slug}.greenput.com`,
      );
    },
  );

  it('404s a card URL built for a workspace that is not in the database', async () => {
    const c = BRAND_ASSET_CASES[0];
    const urls = brandAssetUrls(BRAND_ORIGIN, c.workspace);
    const { env } = createEnv({});
    const res = await fetchWorker(
      new URL(String(urls?.cardUrl)).pathname,
      env,
      { rasterize: createRasterizer().rasterize, cache: null },
    );
    expect(res.status).toBe(404);
  });

  it('404s any other path shape', async () => {
    const { env } = createEnv({ 'reed-hvac': REED });
    const { rasterize } = createRasterizer();
    for (const path of [
      '/',
      '/reed-hvac',
      '/reed-hvac/deadbeef',
      '/reed-hvac/deadbeef/card.png/extra',
      '/api/public/brand/reed-hvac/deadbeef/card.png',
      '/%E0%A4%A/deadbeef/card.png',
    ]) {
      const res = await fetchWorker(path, env, { rasterize, cache: null });
      expect(res.status, path).toBe(404);
    }
    expect(rasterize).not.toHaveBeenCalled();
  });
});
