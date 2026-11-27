import { describe, it, expect } from 'vitest';
import { RequestCustomDomainSchema } from './custom-domain';

describe('RequestCustomDomainSchema', () => {
  it('accepts a subdomain', () => {
    const result = RequestCustomDomainSchema.safeParse({
      hostname: 'www.acmeelectric.com',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a bare apex domain', () => {
    const result = RequestCustomDomainSchema.safeParse({
      hostname: 'acmeelectric.com',
    });
    expect(result.success).toBe(true);
  });

  it('lowercases and trims the hostname', () => {
    const result = RequestCustomDomainSchema.safeParse({
      hostname: '  WWW.AcmeElectric.COM  ',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.hostname).toBe('www.acmeelectric.com');
    }
  });

  it('rejects a URL with a scheme', () => {
    const result = RequestCustomDomainSchema.safeParse({
      hostname: 'https://www.acmeelectric.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a hostname with a path', () => {
    const result = RequestCustomDomainSchema.safeParse({
      hostname: 'www.acmeelectric.com/contact',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a hostname with a port', () => {
    const result = RequestCustomDomainSchema.safeParse({
      hostname: 'www.acmeelectric.com:8080',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a single-label hostname (no dot)', () => {
    const result = RequestCustomDomainSchema.safeParse({ hostname: 'acme' });
    expect(result.success).toBe(false);
  });

  it('rejects a Greenput-owned subdomain', () => {
    const result = RequestCustomDomainSchema.safeParse({
      hostname: 'acme.greenput.com',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a Greenput-owned staging subdomain', () => {
    const result = RequestCustomDomainSchema.safeParse({
      hostname: 'acme.greenput.site',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a label starting or ending with a hyphen', () => {
    expect(
      RequestCustomDomainSchema.safeParse({ hostname: '-acme.com' }).success,
    ).toBe(false);
    expect(
      RequestCustomDomainSchema.safeParse({ hostname: 'acme-.com' }).success,
    ).toBe(false);
  });

  it('rejects a hostname over 255 chars', () => {
    const label = 'a'.repeat(63);
    const result = RequestCustomDomainSchema.safeParse({
      hostname: `${label}.${label}.${label}.${label}.com`,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing hostname field', () => {
    const result = RequestCustomDomainSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
