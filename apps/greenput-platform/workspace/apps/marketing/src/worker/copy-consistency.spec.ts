/**
 * Copy-consistency contracts for the marketing site (GP-045).
 *
 * The same product claim lives in several files — the meta description, the
 * page lead, the FAQ, the structured data derived from the FAQ, and the
 * site-wide CTA — and nothing else cross-checks them. These tests assert the
 * *relationships* between those copies rather than their current wording, so
 * they fail on the next contradiction instead of recording today's bytes:
 *
 *   1. /pricing's search snippet is the page's own abstract, not a generic
 *      SaaS template ("Start free", "upgrade");
 *   2. the FAQ cannot deny the self-service signup the header links to, and
 *      every `Get Started` CTA still goes to that signup;
 *   3. no link into /pricing promises per-vertical *rates* while the page
 *      carries no dollar figure (phrased as the implication, so adding real
 *      rates later satisfies it without editing this file);
 *   4. the FAQPage JSON-LD on /pricing is exactly the FAQ the page renders.
 *
 * The anchor and link lists are derived from templates.ts the way
 * design-contract.spec.ts derives its section list, so a CTA added tomorrow
 * is covered without anyone editing this file.
 */
import { describe, expect, it } from 'vitest';
import { renderMarketingPage } from './index.js';
import { pricingContext } from './page-data.js';
import * as templates from './templates.js';

const ONBOARDING_URL = 'https://app.greenput.com/onboarding';

/**
 * Every page template, concatenated — taken from the module's exports so a
 * template added to templates.ts is covered the moment it is exported.
 */
const templatesSource = Object.values(templates)
  .filter((v): v is string => typeof v === 'string')
  .join('\n');

/** The /pricing document exactly as the worker serves it (nonce is opaque). */
const pricingHtml = renderMarketingPage('pricing', 'testnonce');

/** Undo the renderer's HTML escaping so rendered text compares to source copy. */
const decodeEntities = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const attr = (html: string, tag: RegExp): string => {
  const m = tag.exec(html);
  if (!m) throw new Error(`expected ${tag} in rendered HTML`);
  return decodeEntities(m[1]);
};

/** `<a …>Get Started</a>` anchors across every template, with their hrefs. */
const getStartedHrefs = (): string[] =>
  [...templatesSource.matchAll(/<a\s+([^>]*)>\s*Get Started\s*<\/a>/g)].map(
    (m) => {
      const href = /href="([^"]*)"/.exec(m[1]);
      if (!href) throw new Error(`Get Started anchor without href: ${m[0]}`);
      return href[1];
    },
  );

/** The text of every link into /pricing, across every template. */
const pricingLinkTexts = (): string[] =>
  [
    ...templatesSource.matchAll(/<a\s+href="\/pricing"[^>]*>([\s\S]*?)<\/a>/g),
  ].map((m) => m[1].replace(/\s+/g, ' ').trim());

describe('marketing copy consistency (GP-045)', () => {
  describe('/pricing meta description', () => {
    const description = attr(
      pricingHtml,
      /<meta name="description" content="([^"]*)"/,
    );

    it('is the abstract that lives with the page copy, not a template typed elsewhere', () => {
      expect(description).toBe(pricingContext.description);
      expect(
        attr(pricingHtml, /<meta property="og:description" content="([^"]*)"/),
      ).toBe(pricingContext.description);
    });

    it('describes the product the page describes (no subscription, no free tier)', () => {
      expect(description).toContain('No subscription tiers');
      expect(description).not.toMatch(/start free/i);
      expect(description).not.toMatch(/upgrade/i);
      expect(description).not.toMatch(/free trial/i);
      expect(description.length).toBeLessThanOrEqual(160);
    });
  });

  describe('self-service signup', () => {
    const hrefs = getStartedHrefs();

    it('is linked from the site-wide Get Started CTA', () => {
      expect(hrefs.length).toBeGreaterThan(0);
    });

    it('is where every Get Started CTA points', () => {
      for (const href of hrefs) expect(href).toBe(ONBOARDING_URL);
    });

    it('is not denied by the pricing FAQ while the site links to it', () => {
      const siteLinksSignup = templatesSource.includes(
        'app.greenput.com/onboarding',
      );
      const faqDeniesSignup = pricingContext.faqs.some((faq) =>
        /no self-service/i.test(faq.answer),
      );
      // Implication: links-to-signup ⇒ FAQ does not deny it. Either half can
      // change, but not one without the other.
      expect(siteLinksSignup && faqDeniesSignup).toBe(false);
    });

    it('is described by the "How do I get started?" answer', () => {
      const faq = pricingContext.faqs.find(
        (f) => f.question === 'How do I get started?',
      );
      expect(faq).toBeDefined();
      expect(faq?.answer).toContain('app.greenput.com');
    });
  });

  describe('links into /pricing', () => {
    it('do not promise per-vertical rates unless the page carries a dollar figure', () => {
      const pageHasRates = JSON.stringify(pricingContext).includes('$');
      const texts = pricingLinkTexts();
      expect(texts.length).toBeGreaterThan(0);
      for (const text of texts) {
        // Implication: promises rates ⇒ page has rates.
        expect(/per-vertical rates/i.test(text) && !pageHasRates).toBe(false);
      }
    });
  });

  describe('/pricing FAQPage structured data', () => {
    const payloads = [
      ...pricingHtml.matchAll(
        /<script type="application\/ld\+json" nonce="testnonce">([\s\S]*?)<\/script>/g,
      ),
    ].map((m) => JSON.parse(m[1]) as { '@type': string });
    const faqPage = payloads.find((p) => p['@type'] === 'FAQPage') as
      | {
          mainEntity: Array<{
            name: string;
            acceptedAnswer: { text: string };
          }>;
        }
      | undefined;

    it('is emitted exactly once', () => {
      expect(payloads.filter((p) => p['@type'] === 'FAQPage')).toHaveLength(1);
    });

    it('carries exactly the FAQ the page renders — same questions, same answers, same order', () => {
      expect(
        faqPage?.mainEntity.map((q) => ({
          question: q.name,
          answer: q.acceptedAnswer.text,
        })),
      ).toEqual(pricingContext.faqs);
    });

    it('matches the visible FAQ, not just the data it was built from', () => {
      const visible = [
        ...pricingHtml.matchAll(
          /<summary>(?:<svg[\s\S]*?<\/svg>)?([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>/g,
        ),
      ].map((m) => ({
        question: decodeEntities(m[1].trim()),
        answer: decodeEntities(m[2].trim()),
      }));
      expect(visible).toEqual(
        faqPage?.mainEntity.map((q) => ({
          question: q.name,
          answer: q.acceptedAnswer.text,
        })),
      );
    });
  });
});
