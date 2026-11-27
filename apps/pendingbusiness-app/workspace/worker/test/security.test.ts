import { describe, it, expect } from 'vitest';
import { applySecurityHeaders } from '../src/middleware/security.js';

function passthrough(body: BodyInit | null = null, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

describe('applySecurityHeaders', () => {
  it('sets every required hardening header', () => {
    const res = applySecurityHeaders(passthrough());
    const required = [
      'Content-Security-Policy',
      'Strict-Transport-Security',
      'X-Frame-Options',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'Permissions-Policy',
      'Cross-Origin-Opener-Policy',
      'X-Robots-Tag',
    ];
    for (const h of required) {
      expect(res.headers.get(h), h).toBeTruthy();
    }
  });

  it('CSP denies framing (frame-ancestors none)', () => {
    const res = applySecurityHeaders(passthrough());
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });

  it('CSP does not allow unsafe-inline for styles', () => {
    const res = applySecurityHeaders(passthrough());
    const csp = res.headers.get('Content-Security-Policy') ?? '';
    const styleSrc = csp
      .split(';')
      .map(d => d.trim())
      .find(d => d.startsWith('style-src'));
    expect(styleSrc).toBeTruthy();
    expect(styleSrc, `style-src directive: ${styleSrc}`).not.toMatch(/unsafe-inline/);
  });

  it('CSP does not allow unsafe-eval or unsafe-inline for scripts', () => {
    const csp = applySecurityHeaders(passthrough()).headers.get('Content-Security-Policy') ?? '';
    expect(csp).not.toMatch(/script-src[^;]*unsafe-(inline|eval)/);
  });

  it('CSP allows only the Plaid CDN and the Cloudflare Insights beacon as third-party script sources', () => {
    const csp = applySecurityHeaders(passthrough()).headers.get('Content-Security-Policy') ?? '';
    const scriptSrc = csp
      .split(';')
      .map(d => d.trim())
      .find(d => d.startsWith('script-src'));
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).toContain('https://cdn.plaid.com');
    expect(scriptSrc).toContain('https://static.cloudflareinsights.com');
  });

  it('CSP carries a fresh nonce on script-src for every response', () => {
    const csp1 = applySecurityHeaders(passthrough()).headers.get('Content-Security-Policy') ?? '';
    const csp2 = applySecurityHeaders(passthrough()).headers.get('Content-Security-Policy') ?? '';
    const nonceOf = (csp: string): string => {
      const m = /'nonce-([^']+)'/.exec(csp);
      expect(m, csp).toBeTruthy();
      return m![1]!;
    };
    const [n1, n2] = [nonceOf(csp1), nonceOf(csp2)];
    expect(n1.length).toBeGreaterThan(0);
    expect(n1).not.toBe(n2);
  });

  it('HSTS preloads with includeSubDomains and a long max-age', () => {
    const hsts = applySecurityHeaders(passthrough()).headers.get('Strict-Transport-Security') ?? '';
    expect(hsts).toMatch(/preload/);
    expect(hsts).toMatch(/includeSubDomains/);
    const maxAge = /max-age=(\d+)/.exec(hsts)?.[1];
    expect(Number(maxAge)).toBeGreaterThanOrEqual(31_536_000);
  });

  it('Permissions-Policy disables high-risk browser features', () => {
    const pp = applySecurityHeaders(passthrough()).headers.get('Permissions-Policy') ?? '';
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'usb']) {
      expect(pp, feature).toContain(`${feature}=()`);
    }
  });

  it('omits bluetooth, which is not a recognized Permissions-Policy feature', () => {
    const pp = applySecurityHeaders(passthrough()).headers.get('Permissions-Policy') ?? '';
    expect(pp).not.toContain('bluetooth');
  });

  it('adds Cache-Control: private, no-store to JSON (API) responses', () => {
    const json = passthrough(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
    const res = applySecurityHeaders(json);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('does not override Cache-Control on non-JSON (static asset) responses', () => {
    const html = passthrough('<!doctype html>', {
      headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=3600' },
    });
    const res = applySecurityHeaders(html);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
  });

  it('preserves the original status and body', async () => {
    const res = applySecurityHeaders(
      passthrough('{"x":1}', { status: 418, headers: { 'Content-Type': 'application/json' } }),
    );
    expect(res.status).toBe(418);
    expect(await res.text()).toBe('{"x":1}');
  });
});
