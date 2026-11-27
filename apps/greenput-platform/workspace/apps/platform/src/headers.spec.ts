import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const platformPublic = resolve(__dirname, '../public');
const workspacePublic = resolve(__dirname, '../../../public');

describe('platform Cloudflare Pages _headers and _redirects', () => {
  it('lives in apps/platform/public (not workspace root public)', () => {
    expect(existsSync(resolve(platformPublic, '_headers'))).toBe(true);
    expect(existsSync(resolve(platformPublic, '_redirects'))).toBe(true);
    expect(existsSync(resolve(workspacePublic, '_headers'))).toBe(false);
    expect(existsSync(resolve(workspacePublic, '_redirects'))).toBe(false);
  });

  it('ships SPA fallback in _redirects', () => {
    const redirects = readFileSync(
      resolve(platformPublic, '_redirects'),
      'utf8',
    ).trim();
    expect(redirects).toBe('/* /index.html 200');
  });

  it('enforces hardened CSP without wildcard workers.dev or script unsafe-inline, and preserves bfcache', () => {
    const headers = readFileSync(resolve(platformPublic, '_headers'), 'utf8');
    expect(headers).not.toContain('*.workers.dev');
    expect(headers).not.toContain('no-store');
    expect(headers).toContain("frame-ancestors 'none'");
    expect(headers).toContain('usb=()');
    expect(headers).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(headers).toContain('https://api.greenput.com');
    expect(headers).toContain('https://greenput-api.greenput.workers.dev');
    expect(headers).toContain('Cache-Control: no-cache, must-revalidate');
  });
});
