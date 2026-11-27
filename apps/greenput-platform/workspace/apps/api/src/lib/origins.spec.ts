import { describe, expect, it } from 'vitest';
import { appOrigin, tenantOrigin } from './origins';

describe('appOrigin', () => {
  it('echoes a known platform Origin so a preview link opens on that preview', () => {
    expect(
      appOrigin(
        { ENVIRONMENT: 'production' },
        'https://abc123.greenput-app.pages.dev',
      ),
    ).toBe('https://abc123.greenput-app.pages.dev');
    expect(
      appOrigin({ ENVIRONMENT: 'production' }, 'https://app.greenput.com'),
    ).toBe('https://app.greenput.com');
  });

  it('never echoes an Origin it does not serve — that would be a phishing link', () => {
    expect(
      appOrigin({ ENVIRONMENT: 'production' }, 'https://evil.example'),
    ).toBe('https://app.greenput.com');
    expect(
      appOrigin({ ENVIRONMENT: 'production' }, 'https://api.greenput.com'),
    ).toBe('https://app.greenput.com');
    expect(
      appOrigin({ ENVIRONMENT: 'production' }, 'https://acme.greenput.com'),
    ).toBe('https://app.greenput.com');
  });

  it('falls back to the environment canonical origin, production for preview', () => {
    expect(appOrigin({ ENVIRONMENT: 'production' }, null)).toBe(
      'https://app.greenput.com',
    );
    expect(appOrigin({ ENVIRONMENT: 'staging' }, undefined)).toBe(
      'https://app.greenput.site',
    );
    expect(appOrigin({ ENVIRONMENT: 'development' }, null)).toBe(
      'http://localhost:4200',
    );
    expect(appOrigin({ ENVIRONMENT: 'preview' }, null)).toBe(
      'https://app.greenput.com',
    );
  });
});

describe('tenantOrigin', () => {
  it('is the slug subdomain on the environment domain', () => {
    expect(tenantOrigin({ ENVIRONMENT: 'production' }, { slug: 'demo' })).toBe(
      'https://demo.greenput.com',
    );
    expect(tenantOrigin({ ENVIRONMENT: 'staging' }, { slug: 'demo' })).toBe(
      'https://demo.greenput.site',
    );
  });

  it('is the custom domain only once it is active', () => {
    expect(
      tenantOrigin(
        { ENVIRONMENT: 'production' },
        {
          slug: 'demo',
          custom_hostname: 'www.demo.example',
          custom_domain_status: 'active',
        },
      ),
    ).toBe('https://www.demo.example');
    expect(
      tenantOrigin(
        { ENVIRONMENT: 'production' },
        {
          slug: 'demo',
          custom_hostname: 'www.demo.example',
          custom_domain_status: 'verifying',
        },
      ),
    ).toBe('https://demo.greenput.com');
  });

  it('is null when the workspace has no slug', () => {
    expect(tenantOrigin({ ENVIRONMENT: 'production' }, { slug: null })).toBe(
      null,
    );
  });
});
