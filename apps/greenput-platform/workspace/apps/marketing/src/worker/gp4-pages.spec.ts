import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_USAGE_THRESHOLD_CENTS,
  DEFAULT_USAGE_TOPUP_CENTS,
  TWILIO_US_SMS_SEGMENT_MICRO_USD,
} from '@greenput/shared/notifications';
import { renderMarketingPage } from './index.js';
import { operatorByline } from './geo/entity.js';

const sms = (TWILIO_US_SMS_SEGMENT_MICRO_USD / 1_000_000).toFixed(4);
const topUp = DEFAULT_USAGE_TOPUP_CENTS / 100;
const threshold = DEFAULT_USAGE_THRESHOLD_CENTS / 100;

const cssPath = resolve(__dirname, '..', '..', 'assets', 'css', 'gp4.css');
const fontPath = resolve(__dirname, '..', '..', 'assets', 'fonts', 'Inter.ttf');

describe('v4 marketing pages', () => {
  it('ships one shared stylesheet, scoped so it cannot restyle other routes, and one Inter file', () => {
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toContain('@scope (html[data-gp4="1"])');
    expect(css).toContain("url('/fonts/Inter.ttf')");
    const outside = css.slice(0, css.indexOf('@scope'));
    expect(outside).toContain('@font-face');
    expect(outside).not.toMatch(/\b(html|body|h1|a|button)\s*\{/);
    expect(statSync(fontPath).size).toBeGreaterThan(100_000);
    const home = renderMarketingPage('home', 'gp4nonce');
    const pricing = renderMarketingPage('pricing', 'gp4nonce');
    expect(home).toContain('href="/css/gp4.css"');
    expect(home).toContain('href="/fonts/Inter.ttf"');
    expect(home).not.toContain('/css/styles.css');
    expect(pricing).toContain('href="/css/gp4.css"');
    expect(pricing).toContain('data-gp4="1"');
    expect(pricing).not.toContain('/css/styles.css');
    expect(pricing).not.toContain('data-bn="bn-topbar"');
    expect(pricing).not.toContain('prefers-color-scheme');
    expect(css).not.toContain('prefers-color-scheme');
    expect(css).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?body > nav \{\s*display: block/,
    );
  });

  it('keeps the live nav and footer links, and leaves investors out of the header', () => {
    for (const route of [
      'home',
      'features',
      'about',
      'contact',
      'pricing',
      'technology',
      'ai',
      'investors',
      'guides',
      'privacy',
      'terms',
    ] as const) {
      const html = renderMarketingPage(route, 'gp4nonce');
      expect(html).toContain('data-gp4="1"');
      for (const href of [
        '/features',
        '/ai',
        '/pricing',
        '/about',
        '/technology',
        '/contact',
        '/guides',
        '/investors',
        '/privacy',
        '/terms',
        'https://app.greenput.com/login',
        'https://app.greenput.com/onboarding',
        'https://github.com/DuganLabs',
      ]) {
        expect(html, href).toContain(`href="${href}"`);
      }
      const header = html.slice(
        html.indexOf('<header'),
        html.indexOf('</header>'),
      );
      expect(header).not.toContain('href="/investors"');
      expect(html).toContain('popover="auto"');
      expect(html).not.toContain('type="checkbox"');
      expect(html).toContain(operatorByline());
      expect(html).not.toContain('Warren');
      expect(html).not.toContain('7 Ninos');
    }
  });

  it('leads pricing, technology, ai, guides, and investors with one real screen', () => {
    for (const route of [
      'pricing',
      'technology',
      'ai',
      'guides',
      'investors',
    ] as const) {
      const html = renderMarketingPage(route, 'gp4nonce');
      const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
      const firstEnd = main.indexOf('</section>');
      const hero = main.slice(0, firstEnd);
      expect(hero, route).toContain('fetchpriority="high"');
      expect(hero, route).toContain('width="1600"');
      expect(hero, route).toContain('height="1000"');
      expect(hero, route).toContain('decoding="async"');
      expect(hero, route).not.toMatch(
        /fetchpriority="high"[^>]*loading="lazy"|loading="lazy"[^>]*fetchpriority="high"/,
      );
      const images = [...html.matchAll(/<img\b[^>]*>/g)].map(
        (match) => match[0],
      );
      expect(images.length, route).toBeGreaterThan(0);
      const eager = images.filter((img) =>
        img.includes('fetchpriority="high"'),
      );
      expect(eager, route).toHaveLength(1);
      for (const img of images) {
        expect(img, route).toContain('width="1600"');
        expect(img, route).toContain('height="1000"');
        expect(img, route).toMatch(/alt="[^"]+"/);
        if (!img.includes('fetchpriority="high"')) {
          expect(img, route).toContain('loading="lazy"');
          expect(img, route).not.toContain('fetchpriority=');
        }
      }
    }
    const article = renderMarketingPage('guide-wall-connector', 'gp4nonce');
    expect(article).not.toContain('/screens/');
    for (const route of ['privacy', 'terms', 'home'] as const) {
      const html = renderMarketingPage(route, 'gp4nonce');
      if (route === 'home') {
        expect(html).toContain('/screens/leads.webp');
      } else {
        expect(html, route).not.toContain('/screens/');
      }
    }
  });

  it('does not publish invented dashboard stats or a homeowner price range', () => {
    const home = renderMarketingPage('home', 'gp4nonce');
    expect(home).not.toContain('$12,400');
    expect(home).not.toContain('Leads This Month');
    expect(home).not.toContain('$850');
    expect(home).toContain(`$${sms}`);
    expect(home).toContain(`$${topUp} top-up`);
    expect(home).toContain(`$${threshold}`);
    expect(home).toContain(
      'At booking, the contractor pays the per-lead price',
    );
  });
});
