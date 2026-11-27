import { describe, expect, it } from 'vitest';
import { securityHeaders } from './security.js';

describe('securityHeaders', () => {
  it('locks the site down to same-origin by default', () => {
    const headers = securityHeaders();
    expect(headers['Content-Security-Policy']).toMatch(/default-src 'self'/);
    expect(headers['Content-Security-Policy']).toMatch(
      /frame-ancestors 'none'/,
    );
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('allows connect-src to Google Fonts and Cloudflare Insights so their own scripts stop tripping the CSP', () => {
    const csp = securityHeaders()['Content-Security-Policy'];
    expect(csp).toMatch(
      /connect-src 'self' https:\/\/fonts\.googleapis\.com https:\/\/static\.cloudflareinsights\.com/,
    );
  });

  it('does not list bluetooth in Permissions-Policy (Chromium does not recognise it)', () => {
    expect(securityHeaders()['Permissions-Policy']).not.toMatch(/bluetooth/);
  });

  it('adds the request nonce to script-src when given one, without dropping the fallback', () => {
    const csp = securityHeaders('deadbeef')['Content-Security-Policy'];
    expect(csp).toContain("'nonce-deadbeef'");
    expect(csp).toContain("'unsafe-inline'");
  });

  it('omits a nonce source when none is given', () => {
    expect(securityHeaders()['Content-Security-Policy']).not.toContain(
      'nonce-',
    );
  });
});
