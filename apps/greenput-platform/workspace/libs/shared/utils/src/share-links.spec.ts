import { describe, expect, it } from 'vitest';
import {
  ACCEPT_INVITE_PATH,
  DEPOSIT_PATH,
  INVOICE_PATH,
  PROPOSAL_PATH,
  inviteShareLink,
  invoiceShareLink,
  proposalShareLink,
  appDocumentHref,
  isPublicDocumentPath,
  publicSiteOrigin,
  referenceTenantOrigin,
  tenantDomainForEnvironment,
  tenantDomainForHostname,
} from './share-links';

describe('public document paths', () => {
  it('recognises quote, proposal, and invoice, and nothing beside them', () => {
    expect(isPublicDocumentPath('/quote')).toBe(true);
    expect(isPublicDocumentPath('/quote/s/abc')).toBe(true);
    expect(isPublicDocumentPath('/proposal')).toBe(true);
    expect(isPublicDocumentPath('/proposal/e1')).toBe(true);
    expect(isPublicDocumentPath('/invoice/')).toBe(true);
    expect(isPublicDocumentPath('/invoices')).toBe(false);
    expect(isPublicDocumentPath('/pricing')).toBe(false);
  });

  it('sends the app host to the apex and leaves every other host alone', () => {
    expect(appDocumentHref('app.greenput.com', '/quote', '')).toBe(
      'https://greenput.com/quote',
    );
    expect(appDocumentHref('app.greenput.site', '/invoice/abc', '?x=1')).toBe(
      'https://greenput.site/invoice/abc?x=1',
    );
    expect(appDocumentHref('greenput.com', '/quote', '')).toBeNull();
    expect(appDocumentHref('app.greenput.com', '/dashboard', '')).toBeNull();
    expect(referenceTenantOrigin('app.greenput.site')).toBe(
      'https://demo.greenput.site',
    );
  });
});

describe('publicSiteOrigin', () => {
  it('is the slug subdomain by default', () => {
    expect(publicSiteOrigin({ slug: 'rivertown' }, 'greenput.com')).toBe(
      'https://rivertown.greenput.com',
    );
    expect(publicSiteOrigin({ slug: 'rivertown' }, 'greenput.site')).toBe(
      'https://rivertown.greenput.site',
    );
  });

  it('prefers an ACTIVE custom domain and ignores a pending one', () => {
    expect(
      publicSiteOrigin(
        {
          slug: 'rivertown',
          customHostname: 'www.rivertown.example',
          customDomainStatus: 'active',
        },
        'greenput.com',
      ),
    ).toBe('https://www.rivertown.example');
    expect(
      publicSiteOrigin(
        {
          slug: 'rivertown',
          customHostname: 'www.rivertown.example',
          customDomainStatus: 'pending',
        },
        'greenput.com',
      ),
    ).toBe('https://rivertown.greenput.com');
  });

  it('is null for a workspace with no slug — there is no address to share', () => {
    expect(publicSiteOrigin({ slug: null }, 'greenput.com')).toBeNull();
    expect(publicSiteOrigin({}, 'greenput.com')).toBeNull();
  });
});

describe('tenant domain', () => {
  it('is greenput.site only for staging', () => {
    expect(tenantDomainForEnvironment('staging')).toBe('greenput.site');
    expect(tenantDomainForEnvironment('production')).toBe('greenput.com');
    expect(tenantDomainForEnvironment('development')).toBe('greenput.com');
    expect(tenantDomainForEnvironment(undefined)).toBe('greenput.com');
  });

  it('follows the platform hostname', () => {
    expect(tenantDomainForHostname('app.greenput.site')).toBe('greenput.site');
    expect(tenantDomainForHostname('app.greenput.com')).toBe('greenput.com');
    expect(tenantDomainForHostname('localhost')).toBe('greenput.com');
  });
});

describe('share links', () => {
  const origin = 'https://rivertown.greenput.com';

  it('builds the invoice URL on the invoice path and puts it in the message', () => {
    const link = invoiceShareLink(origin, 'tok-1', {
      businessName: 'Rivertown Electric',
      customerFirstName: 'Alex',
      jobTitle: 'Panel upgrade',
    });
    expect(link.url).toBe(`${origin}${INVOICE_PATH}tok-1`);
    expect(link.message).toBe(
      'Hi Alex, here is your invoice from Rivertown Electric for Panel upgrade. You can view or print it here: https://rivertown.greenput.com/invoice/tok-1',
    );
    expect(link.expiresAt).toBeUndefined();
  });

  it('reads without a customer name or title', () => {
    const link = invoiceShareLink(origin, 'tok-1', {
      businessName: 'Rivertown Electric',
    });
    expect(link.message).toMatch(
      /^here is your invoice from Rivertown Electric\. /,
    );
  });

  // WS-0 (PRD v1.5, FR-0.2): there is deliberately no deposit share
  // link. The builder that produced "Please add your card for the
  // refundable $… deposit here: <origin>/deposit/<token>" was removed
  // with the revoked deposit model (2026-10-20) — no outbound message
  // may carry deposit copy or a deposit link. DEPOSIT_PATH survives
  // only so the tenant Worker can recognise an old link and answer it
  // with a plain not-found.
  it('keeps DEPOSIT_PATH as a recogniser only — no builder uses it', () => {
    expect(DEPOSIT_PATH).toBe('/deposit/');
    expect(isPublicDocumentPath('/deposit/tok-2')).toBe(false);
    const builders = [invoiceShareLink, proposalShareLink, inviteShareLink];
    for (const build of builders) {
      expect(build.name.toLowerCase()).not.toContain('deposit');
    }
  });

  it('no share-link message mentions a deposit', () => {
    const messages = [
      invoiceShareLink(origin, 'tok-1', {
        businessName: 'Rivertown Electric',
        customerFirstName: 'Alex',
        jobTitle: 'Panel upgrade',
      }).message,
      proposalShareLink(origin, 'est-1', {
        businessName: 'Rivertown Electric',
        customerFirstName: 'Alex',
        title: '200A Panel Upgrade',
      }).message,
    ];
    for (const message of messages) {
      expect(message.toLowerCase()).not.toContain('deposit');
      expect(message).not.toContain(DEPOSIT_PATH);
    }
  });

  it('builds the proposal URL on the proposal path', () => {
    const link = proposalShareLink(origin, 'est-1', {
      businessName: 'Rivertown Electric',
      customerFirstName: 'Alex',
      title: '200A Panel Upgrade',
    });
    expect(link.url).toBe(`${origin}${PROPOSAL_PATH}est-1`);
    expect(link.message).toBe(
      'Hi Alex, here is your quote from Rivertown Electric for 200A Panel Upgrade: https://rivertown.greenput.com/proposal/est-1',
    );
  });

  it('builds the invite URL on the platform origin and says it is single-use', () => {
    const link = inviteShareLink('https://app.greenput.com', 'tok-9', {
      businessName: 'Rivertown Electric',
      inviteeFirstName: 'Bea',
      expiresAt: '2026-09-20T12:00:00.000Z',
    });
    expect(link.url).toBe(`https://app.greenput.com${ACCEPT_INVITE_PATH}tok-9`);
    expect(link.expiresAt).toBe('2026-09-20T12:00:00.000Z');
    expect(link.message).toContain(
      'Hi Bea, you have been invited to join Rivertown Electric',
    );
    expect(link.message).toContain(link.url);
    expect(link.message).toContain('works once and expires on September 20');
  });
});
