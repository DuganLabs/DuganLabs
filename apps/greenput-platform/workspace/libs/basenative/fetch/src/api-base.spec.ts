import { describe, it, expect } from 'vitest';
import { resolveGreenPutApiBase } from './api-base.js';

describe('resolveGreenPutApiBase', () => {
  it('returns the production API host for app.greenput.com', () => {
    expect(resolveGreenPutApiBase({ hostname: 'app.greenput.com' })).toBe(
      'https://api.greenput.com',
    );
  });

  it('returns the production API host for any *.greenput.com subdomain', () => {
    expect(resolveGreenPutApiBase({ hostname: 'admin.greenput.com' })).toBe(
      'https://api.greenput.com',
    );
  });

  it('returns the staging API host for *.greenput.site', () => {
    expect(resolveGreenPutApiBase({ hostname: 'pr-42.greenput.site' })).toBe(
      'https://api.greenput.site',
    );
  });

  it('returns the workers preview host for *.pages.dev', () => {
    expect(resolveGreenPutApiBase({ hostname: 'demo-pr-1.pages.dev' })).toBe(
      'https://greenput-api.greenput.workers.dev',
    );
  });

  it('returns empty string for localhost', () => {
    expect(resolveGreenPutApiBase({ hostname: 'localhost' })).toBe('');
  });

  it('returns empty string for blank hostname', () => {
    expect(resolveGreenPutApiBase({ hostname: '' })).toBe('');
  });

  it('reads window.location.hostname when no override is given', () => {
    expect(resolveGreenPutApiBase()).toBe('');
  });
});
