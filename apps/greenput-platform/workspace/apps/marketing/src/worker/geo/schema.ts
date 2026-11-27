/**
 * schema.org JSON-LD for the marketing site.
 *
 * Organization and WebSite are the entity, identical on every page.
 * FAQPage, HowTo, Service, and BreadcrumbList are built from the same
 * objects the visible page renders. LocalBusiness is intentionally
 * absent. OPERATOR_MAILING_ADDRESS is empty, and it is not copied into
 * schema. See entity.ts.
 */

import {
  CANONICAL_NAME,
  CANONICAL_ONE_SENTENCE,
  OPERATOR_LEGAL_NAME,
  CANONICAL_SAME_AS,
  CANONICAL_URL,
  ORGANIZATION_ID,
  WEBSITE_ID,
} from './entity.js';
import type {
  GuideFaq,
  GuideHowTo,
  GuidePage,
  GuideService,
} from './guides.js';

export interface JsonLd {
  readonly [key: string]: unknown;
}

export function organizationLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: CANONICAL_NAME,
    legalName: OPERATOR_LEGAL_NAME,
    url: CANONICAL_URL,
    logo: `${CANONICAL_URL}/favicon.svg`,
    description: CANONICAL_ONE_SENTENCE,
    sameAs: [...CANONICAL_SAME_AS],
  };
}

export function websiteLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    name: CANONICAL_NAME,
    url: CANONICAL_URL,
    description: CANONICAL_ONE_SENTENCE,
    publisher: { '@id': ORGANIZATION_ID },
  };
}

/** The contractor offer on /pricing. No price: none is published. */
export function pricingServiceLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'Greenput — outcome-tracked lead delivery for trade contractors',
    serviceType:
      'Quote-to-payment platform for residential trade contractors: quoting, booking, scheduling, invoicing and payment',
    provider: { '@id': ORGANIZATION_ID },
    url: `${CANONICAL_URL}/pricing`,
    description:
      'Greenput charges one price per delivered lead — a booked job placed into a contractor’s schedule — set by vertical and service. Every delivered lead is tracked to its outcome: quoted, scheduled, completed, paid. No subscription tiers. Outbound SMS is paid from a prepaid balance that tops up from the card on file; sign-in codes are not charged to the workspace; Cloudflare request volume is not billed. The fee is charged at booking: at booking, the contractor pays the per-lead price, one flat price per booked job. Confirmation after booking locks the job details; it is never the billing gate. Dollar rates for leads are not published.',
    audience: {
      '@type': 'BusinessAudience',
      audienceType:
        'Residential trade contractors — electricians, plumbers, HVAC techs, roofers',
    },
    areaServed: 'US',
  };
}

export function faqLd(faqs: readonly GuideFaq[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: { '@type': 'Answer', text: faq.answer },
    })),
  };
}

export function howToLd(howTo: GuideHowTo, pageUrl: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: howTo.name,
    description: howTo.description,
    url: pageUrl,
    step: howTo.steps.map((step, index) => ({
      '@type': 'HowToStep',
      position: index + 1,
      name: step.name,
      text: step.text,
    })),
  };
}

export function guideServiceLd(service: GuideService, pageUrl: string): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: service.name,
    serviceType: service.serviceType,
    description: service.description,
    url: pageUrl,
    provider: { '@id': ORGANIZATION_ID },
    ...(service.areaServed
      ? {
          areaServed: {
            '@type': 'AdministrativeArea',
            name: service.areaServed,
          },
        }
      : {}),
  };
}

export function breadcrumbLd(guide: GuidePage): JsonLd {
  const crumbs = [
    { name: 'Home', path: '/' },
    { name: 'Guides', path: '/guides' },
    ...(guide.path === '/guides' ? [] : [{ name: guide.h1, path: guide.path }]),
  ];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: crumb.name,
      item: `${CANONICAL_URL}${crumb.path === '/' ? '' : crumb.path}`,
    })),
  };
}

export function guideJsonLd(guide: GuidePage): JsonLd[] {
  const pageUrl = `${CANONICAL_URL}${guide.path}`;
  const blocks: JsonLd[] = [breadcrumbLd(guide)];
  if (guide.faqs.length > 0) blocks.push(faqLd(guide.faqs));
  if (guide.howTo) blocks.push(howToLd(guide.howTo, pageUrl));
  if (guide.service) blocks.push(guideServiceLd(guide.service, pageUrl));
  return blocks;
}

/** Escape `<` so a string cannot close the surrounding script tag. */
export function serializeJsonLd(block: JsonLd): string {
  return JSON.stringify(block).replace(/</g, '\\u003c');
}
