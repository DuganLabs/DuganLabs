import { describe, it, expect } from 'vitest';
import { applySecurityHeaders } from './security';
import type { Env } from '../env';

function makeEnv(environment: string): Env {
  return {
    ENVIRONMENT: environment,
    DB: {} as D1Database,
    SESSIONS: {} as KVNamespace,
  };
}

function makeResponse(contentType = 'application/json'): Response {
  return new Response('{}', {
    status: 200,
    headers: { 'Content-Type': contentType },
  });
}

describe('applySecurityHeaders', () => {
  describe('production', () => {
    const env = makeEnv('production');

    it('sets HSTS header', () => {
      const res = applySecurityHeaders(makeResponse(), env);
      expect(res.headers.get('Strict-Transport-Security')).toContain(
        'max-age=31536000',
      );
    });

    it('sets Cross-Origin-Resource-Policy to same-site', () => {
      const res = applySecurityHeaders(makeResponse(), env);
      expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('same-site');
    });

    it('does not set Cross-Origin-Embedder-Policy', () => {
      const res = applySecurityHeaders(makeResponse(), env);
      expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBeNull();
    });

    it('keeps a CORP value a handler chose for itself', () => {
      // Public artwork meant to be embedded from a contractor's own custom
      // domain needs `cross-origin`, and `same-site` is exactly what a browser
      // refuses there. The blanket `set` used to overwrite the route's own
      // header on the way out, so the value the route chose never shipped —
      // found while the share card was still served from this Worker.
      const res = applySecurityHeaders(
        new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          headers: {
            'Content-Type': 'image/png',
            'Cross-Origin-Resource-Policy': 'cross-origin',
          },
        }),
        env,
      );
      expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe(
        'cross-origin',
      );
    });

    it('leaves a PNG response cacheable — no-store is for JSON only', () => {
      const res = applySecurityHeaders(
        new Response(new Uint8Array([1]), {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=31536000, immutable',
          },
        }),
        env,
      );
      expect(res.headers.get('Cache-Control')).toBe(
        'public, max-age=31536000, immutable',
      );
    });

    it('sets CSP with api.greenput.com in connect-src', () => {
      const res = applySecurityHeaders(makeResponse(), env);
      const csp = res.headers.get('Content-Security-Policy') ?? '';
      expect(csp).toContain('https://api.greenput.com');
    });

    it('CSP connect-src includes fonts.gstatic.com for service worker font caching', () => {
      const res = applySecurityHeaders(makeResponse(), env);
      const csp = res.headers.get('Content-Security-Policy') ?? '';
      expect(csp).toContain('https://fonts.gstatic.com');
    });

    it('sets no-store cache for JSON responses', () => {
      const res = applySecurityHeaders(makeResponse(), env);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    });
  });

  describe('preview', () => {
    const env = makeEnv('preview');

    it('sets Cross-Origin-Resource-Policy to cross-origin', () => {
      const res = applySecurityHeaders(makeResponse(), env);
      expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe(
        'cross-origin',
      );
    });

    it('does not set HSTS', () => {
      const res = applySecurityHeaders(makeResponse(), env);
      expect(res.headers.get('Strict-Transport-Security')).toBeNull();
    });
  });

  it('sets X-Frame-Options to DENY', () => {
    const res = applySecurityHeaders(makeResponse(), makeEnv('production'));
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('sets X-Content-Type-Options to nosniff', () => {
    const res = applySecurityHeaders(makeResponse(), makeEnv('production'));
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sets Referrer-Policy to strict-origin-when-cross-origin', () => {
    const res = applySecurityHeaders(makeResponse(), makeEnv('production'));
    expect(res.headers.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin',
    );
  });

  it('sets Permissions-Policy denying camera, microphone, geolocation', () => {
    const res = applySecurityHeaders(makeResponse(), makeEnv('production'));
    const policy = res.headers.get('Permissions-Policy') ?? '';
    expect(policy).toContain('camera=()');
    expect(policy).toContain('microphone=()');
    expect(policy).toContain('geolocation=()');
  });

  it('sets Cross-Origin-Opener-Policy to same-origin', () => {
    const res = applySecurityHeaders(makeResponse(), makeEnv('production'));
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
  });

  it('does not set Cache-Control for non-JSON responses', () => {
    const htmlRes = new Response('<html></html>', {
      headers: { 'Content-Type': 'text/html' },
    });
    const res = applySecurityHeaders(htmlRes, makeEnv('production'));
    expect(res.headers.get('Cache-Control')).toBeNull();
  });

  it('preserves response status and body', () => {
    const original = new Response('{"ok":true}', {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
    const res = applySecurityHeaders(original, makeEnv('production'));
    expect(res.status).toBe(201);
  });

  describe('non-production (development)', () => {
    const env = makeEnv('development');

    it('does not set HSTS', () => {
      const res = applySecurityHeaders(makeResponse(), env);
      expect(res.headers.get('Strict-Transport-Security')).toBeNull();
    });

    it('sets Cross-Origin-Resource-Policy to cross-origin', () => {
      const res = applySecurityHeaders(makeResponse(), env);
      expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe(
        'cross-origin',
      );
    });

    it('CSP connect-src includes workers.dev', () => {
      const res = applySecurityHeaders(makeResponse(), env);
      const csp = res.headers.get('Content-Security-Policy') ?? '';
      expect(csp).toContain('workers.dev');
    });

    it('CSP connect-src includes fonts.gstatic.com', () => {
      const res = applySecurityHeaders(makeResponse(), env);
      const csp = res.headers.get('Content-Security-Policy') ?? '';
      expect(csp).toContain('https://fonts.gstatic.com');
    });
  });

  it('HSTS includes includeSubDomains in production', () => {
    const res = applySecurityHeaders(makeResponse(), makeEnv('production'));
    const hsts = res.headers.get('Strict-Transport-Security') ?? '';
    expect(hsts).toContain('includeSubDomains');
  });

  it('HSTS includes preload in production', () => {
    const res = applySecurityHeaders(makeResponse(), makeEnv('production'));
    const hsts = res.headers.get('Strict-Transport-Security') ?? '';
    expect(hsts).toContain('preload');
  });

  it('CSP has frame-ancestors none', () => {
    const res = applySecurityHeaders(makeResponse(), makeEnv('production'));
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('CSP has upgrade-insecure-requests', () => {
    const res = applySecurityHeaders(makeResponse(), makeEnv('production'));
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('Permissions-Policy also denies payment and usb', () => {
    const res = applySecurityHeaders(makeResponse(), makeEnv('production'));
    const policy = res.headers.get('Permissions-Policy') ?? '';
    expect(policy).toContain('payment=()');
    expect(policy).toContain('usb=()');
  });

  it('preserves existing Content-Type header', () => {
    const original = new Response('{}', {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
    const res = applySecurityHeaders(original, makeEnv('production'));
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });
});
