import { beforeEach, describe, expect, it, vi } from 'vitest';
import { brandAssetVersion, shareCardFactsFor } from '@greenput/shared/design';

import type { Env } from './env';
import { clearRateLimitStore } from './lib/rate-limit';
import worker, { handleRequest } from './index';

const REED = {
  name: 'Reed HVAC',
  slug: 'reed-hvac',
  trade: 'hvac',
  city: 'Austin',
  state: 'TX',
  logo_url: null,
  custom_hostname: null,
  custom_domain_status: null,
};

function envWith(rows: Record<string, unknown>, environment = 'production') {
  return {
    DB: {
      prepare: () => ({
        bind: (...args: unknown[]) => ({
          first: async () => rows[String(args[0])] ?? null,
        }),
      }),
    },
    ENVIRONMENT: environment,
  } as unknown as Env;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const deps = { rasterize: vi.fn(async () => PNG), cache: null };
const VERSION = brandAssetVersion(shareCardFactsFor(REED));
const CARD = `/reed-hvac/${VERSION}/card.png`;

function req(path: string, init?: RequestInit, ip = '203.0.113.9'): Request {
  return new Request(`https://brand.greenput.com${path}`, {
    ...init,
    headers: { 'CF-Connecting-IP': ip, ...(init?.headers ?? {}) },
  });
}

let nextIp = 1;
function freshIp(): string {
  nextIp += 1;
  return `198.51.100.${nextIp}`;
}

describe('the brand-assets Worker', () => {
  beforeEach(() => {
    clearRateLimitStore();
    deps.rasterize.mockClear();
  });

  it('answers /health so a deploy can tell it is this Worker on the hostname', async () => {
    const res = await handleRequest(
      req('/health'),
      envWith({}),
      undefined,
      deps,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      worker: 'greenput-brand',
    });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
  });

  it('serves the card with the headers a crawler on any origin needs', async () => {
    const res = await handleRequest(
      req(CARD),
      envWith({ 'reed-hvac': REED }),
      undefined,
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe(
      'cross-origin',
    );
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Strict-Transport-Security')).toContain(
      'max-age=31536000',
    );
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it('answers HEAD with the headers and no body', async () => {
    const res = await handleRequest(
      req(CARD, { method: 'HEAD' }),
      envWith({ 'reed-hvac': REED }),
      undefined,
      deps,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.body).toBeNull();
  });

  it('refuses every other method without touching the database', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
      const res = await handleRequest(
        req(CARD, { method }),
        envWith({ 'reed-hvac': REED }),
        undefined,
        deps,
      );
      expect(res.status, method).toBe(405);
      expect(res.headers.get('Allow')).toBe('GET, HEAD');
    }
    expect(deps.rasterize).not.toHaveBeenCalled();
  });

  it('does not send HSTS outside production', async () => {
    const res = await handleRequest(
      req('/health'),
      envWith({}, 'staging'),
      undefined,
      deps,
    );
    expect(res.headers.get('Strict-Transport-Security')).toBeNull();
  });

  it('has a budget of its own — 120 a minute per client, then 429', async () => {
    const ip = freshIp();
    const env = envWith({ 'reed-hvac': REED });
    let refusedAt = -1;
    for (let i = 0; i < 130; i += 1) {
      const res = await handleRequest(
        req(CARD, undefined, ip),
        env,
        undefined,
        deps,
      );
      if (res.status === 429) {
        refusedAt = i;
        expect(res.headers.get('Retry-After')).toBeTruthy();
        break;
      }
    }
    expect(refusedAt).toBe(120);
    // Another client is unaffected.
    const other = await handleRequest(
      req(CARD, undefined, freshIp()),
      env,
      undefined,
      deps,
    );
    expect(other.status).toBe(200);
  });

  it('does not spend the budget on paths it will not serve', async () => {
    const ip = freshIp();
    const env = envWith({ 'reed-hvac': REED });
    for (let i = 0; i < 200; i += 1) {
      const res = await handleRequest(
        req('/nope', undefined, ip),
        env,
        undefined,
        deps,
      );
      expect(res.status).toBe(404);
    }
    const card = await handleRequest(
      req(CARD, undefined, ip),
      env,
      undefined,
      deps,
    );
    expect(card.status).toBe(200);
  });

  it('never leaks an exception to a crawler', async () => {
    const env = {
      DB: {
        prepare: () => {
          throw new Error('D1 is on fire');
        },
      },
      ENVIRONMENT: 'production',
    } as unknown as Env;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await worker.fetch(req(CARD), env, {
      waitUntil: () => undefined,
      passThroughOnException: () => undefined,
    } as unknown as ExecutionContext);
    spy.mockRestore();
    expect(res.status).toBe(500);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe(
      'cross-origin',
    );
  });
});
