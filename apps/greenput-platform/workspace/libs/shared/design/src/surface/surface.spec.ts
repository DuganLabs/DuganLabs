import { describe, expect, it } from 'vitest';
import {
  SURFACE_CSS,
  renderFloatingTabs,
  renderInfoCard,
  renderInsetRow,
  renderMetric,
  renderPageHero,
} from './surface.js';

describe('surface', () => {
  it('keeps metric labels on one centered line with no uppercase tracking', () => {
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-metric"\] small \{[^}]*text-align:\s*center/,
    );
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-metric"\] small \{[^}]*white-space:\s*nowrap/,
    );
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-metric"\] small \{[^}]*text-transform:\s*none/,
    );
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-metric"\] small \{[^}]*letter-spacing:\s*0/,
    );
    expect(SURFACE_CSS).not.toMatch(
      /\[data-bn="bn-metric"\] small \{[^}]*uppercase/,
    );
  });

  it('paints liquid glass: blur, one elevation, and the leaf accent', () => {
    expect(SURFACE_CSS).toContain('backdrop-filter: saturate(180%) blur(30px)');
    expect(SURFACE_CSS).toContain('box-shadow: var(--gp-shadow-glass)');
    expect(SURFACE_CSS).toContain('var(--gp-primary)');
    expect(SURFACE_CSS).not.toContain('SF Pro');
    expect(SURFACE_CSS).toContain('@layer components');
  });

  it('keeps capsule controls from inheriting a link underline', () => {
    expect(SURFACE_CSS).toMatch(
      /a\[data-bn="bn-button"\][\s\S]*?text-decoration-line:\s*none/,
    );
  });

  it('sets a heavy large title, one faint glow, and a neutral card', () => {
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-large-title"\] \{[^}]*font-weight:\s*700/,
    );
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-large-title"\] \{[^}]*font-size:\s*min\(var\(--gp-text-display\), 9\.2cqi\)/,
    );
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-large-title"\] \{[^}]*text-wrap:\s*balance/,
    );
    expect(SURFACE_CSS).toContain('container-type: inline-size');
    expect(SURFACE_CSS).toContain('padding-block: var(--gp-card-inset)');
    expect(SURFACE_CSS).toContain('padding-inline: var(--gp-card-inset)');
    expect(SURFACE_CSS).not.toMatch(
      /\[data-bn="bn-panel"\] \{[^}]*padding-block:\s*0\.2rem/,
    );
    expect(
      SURFACE_CSS.match(/background-image:\s*var\(--gp-hero-glow\)/g),
    ).toHaveLength(1);
    expect(SURFACE_CSS).toContain('body::before');
    expect(SURFACE_CSS).not.toContain('#hero::after');
    expect(SURFACE_CSS).not.toContain('::after');
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-info-card"\],\s*\[data-bn="bn-panel"\] \{[^}]*background-image:\s*none/,
    );
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-info-card"\],\s*\[data-bn="bn-panel"\] \{[^}]*overflow:\s*hidden/,
    );
    expect(SURFACE_CSS).not.toContain('[aria-current="page"]::before');
  });

  it('hides phone rail links with a selector that beats the show rule', () => {
    expect(SURFACE_CSS).toMatch(
      /@media \(max-width:\s*1023px\)\s*\{[\s\S]*?\[data-bn="bn-rail"\] > a:not\(\[data-bn="bn-brand"\]\) \{\s*display:\s*none/,
    );
    expect(SURFACE_CSS).toContain(
      'padding-block-start: var(--gp-stack-section)',
    );
    expect(SURFACE_CSS).not.toContain('padding-block-start: 0');
    expect(SURFACE_CSS).toContain('block-size: var(--gp-toolbar-h)');
    expect(SURFACE_CSS).toContain('block-size: var(--gp-toolbar-control)');
    expect(SURFACE_CSS).toContain(
      'padding-block-end: calc(\n        var(--gp-capsule-h) + max(var(--gp-capsule-inset), env(safe-area-inset-bottom, 0px))\n      )',
    );
    expect(SURFACE_CSS).toContain('[data-bn="bn-page"]');
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-topbar"\] > \[data-bn="bn-rail"\]\[data-bn-column\] > \* \{[^}]*align-self:\s*center/,
    );
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-topbar"\] > \[data-bn="bn-rail"\]\[data-bn-column\] > \* \{[^}]*margin-block:\s*0/,
    );
    expect(SURFACE_CSS).toContain('background: var(--gp-button-fill)');
    expect(SURFACE_CSS).toContain('color: var(--gp-button-fg)');
    const topbar = SURFACE_CSS.match(/\[data-bn="bn-topbar"\] \{[^}]*\}/)?.[0];
    expect(topbar).toContain('background: var(--gp-capsule-fill)');
    expect(topbar).toContain('blur(var(--gp-capsule-blur))');
    expect(topbar).toContain('box-shadow: var(--gp-shadow-glass)');
    expect(topbar).not.toContain('border-block-end');
    expect(SURFACE_CSS).toContain('block-size: var(--gp-control-h)');
    expect(SURFACE_CSS).toContain('padding-block: var(--gp-stack-section)');
    expect(SURFACE_CSS).toContain('blur(var(--gp-capsule-blur))');
    expect(SURFACE_CSS).toContain('inline-size: var(--gp-tab-icon)');
    expect(SURFACE_CSS).toContain('stroke-width: var(--gp-tab-stroke)');
    expect(SURFACE_CSS).toContain(
      '[data-bn="bn-tab-bar"][data-placement="floating"] [data-bn="bn-tab"][aria-current="page"]',
    );
    expect(SURFACE_CSS).toContain(
      ':root [data-bn="bn-panel"] [data-bn="bn-inset-list"]',
    );
  });

  it('renders a floating tab with a symbol above the label', () => {
    const html = renderFloatingTabs({
      id: 'site-tabs',
      label: 'Primary',
      tabs: [
        {
          label: 'Home',
          href: '/',
          current: true,
          symbol: '<svg data-bn="bn-symbol" aria-hidden="true"></svg>',
        },
      ],
    });
    expect(html).toContain(
      '<nav data-bn="bn-tab-bar" data-placement="floating"',
    );
    expect(html).toContain('data-bn="bn-symbol"');
    expect(html).toContain('<small>Home</small>');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('<span');
    expect(html).not.toContain('<div');
  });

  it('lays metric tiles in two columns and trails an inset badge', () => {
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-metrics"\] \{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-inset-row"\] > \[data-bn="bn-badge"\] \{[^}]*margin-inline-start:\s*auto/,
    );
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-badge"\] \{[^}]*background:\s*var\(--bn-plat-color-fills-tertiary\)/,
    );
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-badge"\] \{[^}]*color:\s*var\(--gp-good-ink\)/,
    );
    expect(SURFACE_CSS).not.toContain('background: var(--gp-green-300)');
    expect(SURFACE_CSS).toMatch(
      /:is\(\[data-bn="bn-panel"\], \[data-bn="bn-info-card"\]\) \[data-bn="bn-metric"\] \{[^}]*background:\s*transparent/,
    );
    expect(SURFACE_CSS).toMatch(
      /:root :is\(\[data-bn="bn-panel"\], \[data-bn="bn-info-card"\]\) \[data-bn="bn-inset-row"\] \{[^}]*padding-inline:\s*0/,
    );
    expect(SURFACE_CSS).toMatch(
      /:root :is\(\[data-bn="bn-panel"\], \[data-bn="bn-info-card"\]\) \[data-bn="bn-inset-row"\] \{[^}]*border-block-end-color:\s*var\(--gp-rule\)/,
    );
    const row = renderInsetRow('New', '8');
    expect(row).toContain('<li data-bn="bn-inset-row">');
    expect(row).toContain('<p>New</p>');
    expect(row).toContain('<b data-bn="bn-badge">8</b>');
    expect(row).not.toContain('<div');
    expect(row).not.toContain('<span');
  });

  it('groups inset rows with a hairline and balances card counts', () => {
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-inset-row"\] \{[^}]*border-radius:\s*0/,
    );
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-inset-row"\] \{[^}]*box-shadow:\s*none/,
    );
    expect(SURFACE_CSS).toMatch(
      /:nth-child\(6\):last-child\)[\s\S]*?repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(SURFACE_CSS).toContain('border-radius: var(--gp-radius-full)');
    expect(SURFACE_CSS).toContain('margin-block-start: var(--gp-stack-title)');
    expect(SURFACE_CSS).toContain(
      'margin-block-start: var(--gp-stack-actions)',
    );
    expect(SURFACE_CSS).not.toContain('min-block-size: calc(100svh - 6.75rem)');
    const card = renderInfoCard({
      title: 'Customer Portal',
      text: 'A portal',
      badge: 'Coming soon',
    });
    expect(card).toContain(
      '<h3>Customer Portal</h3><b data-bn="bn-badge">Coming soon</b>',
    );
    expect(card).not.toContain('·');
  });

  it('keeps lead type at least as large as body copy', () => {
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-lead"\] \{[^}]*font-size:\s*var\(--gp-text-lg\)/,
    );
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-note"\] \{[^}]*font-size:\s*var\(--gp-text-sm\)/,
    );
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-section"\] h2,\s*\[data-bn="bn-cta"\] h2 \{[^}]*font-size:\s*var\(--gp-text-2xl\)/,
    );
    expect(SURFACE_CSS).toMatch(
      /\[data-bn-column\] > p:not\([\s\S]*?\) \{[^}]*font-size:\s*var\(--gp-text-base\)/,
    );
    expect(SURFACE_CSS).not.toMatch(
      /\[data-bn="bn-lead"\] \{[^}]*font-size:\s*0\.9375rem/,
    );
    expect(SURFACE_CSS).toMatch(
      /blockquote\[data-bn="bn-panel"\] \{\s*margin:\s*0/,
    );
  });

  it('wraps icons in a fixed tile instead of a custom element', () => {
    expect(SURFACE_CSS).toMatch(
      /\[data-bn="bn-icon-tile"\] \{[^}]*inline-size:\s*2rem/,
    );
    expect(SURFACE_CSS).not.toContain('svg[data-bn="bn-icon-tile"]');
    const card = renderInfoCard({
      title: 'Leads',
      text: 'Tracked',
      iconSvg: '<svg viewBox="0 0 24 24"></svg>',
    });
    expect(card).toContain('<b data-bn="bn-icon-tile"');
    expect(card).not.toMatch(/<bn-icon-tile/);
    expect(card).not.toContain('<svg data-bn="bn-icon-tile"');
  });

  it('keeps gradient, shadow, radius, and z-index on the token scale', () => {
    const start = SURFACE_CSS.indexOf('@layer components');
    const layer = SURFACE_CSS.slice(start).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(layer).not.toMatch(/gradient\s*\(/);
    const values = (prop: string): string[] => {
      const found: string[] = [];
      const re = new RegExp(`(?:^|[;{])\\s*${prop}\\s*:\\s*([^;]+)`, 'g');
      for (const match of layer.matchAll(re)) {
        found.push((match[1] ?? '').replace(/\s+/g, ' ').trim());
      }
      return found;
    };
    expect(values('box-shadow').length).toBeGreaterThan(0);
    for (const value of values('box-shadow')) {
      expect(value, value).toMatch(/^(?:none|var\(--gp-shadow-[\w-]+\))$/);
    }
    expect(values('border-radius').length).toBeGreaterThan(0);
    for (const value of values('border-radius')) {
      expect(value, value).toMatch(/^(?:0|var\(--gp-radius-[\w-]+\))$/);
    }
    expect(values('z-index').length).toBeGreaterThan(0);
    for (const value of values('z-index')) {
      expect(value, value).toMatch(/^(?:auto|var\(--gp-z-[\w-]+\))$/);
    }
  });

  it('uses one accent on icon tiles', () => {
    const tile = SURFACE_CSS.match(/\[data-bn="bn-icon-tile"\] \{[^}]*\}/)?.[0];
    expect(tile).toBeDefined();
    expect(tile).toContain('var(--gp-primary)');
    expect(tile).toContain('var(--gp-primary-text)');
    expect(tile).not.toMatch(/--gp-(?:red|amber|blue|orange|yellow|good|bad)/);
  });

  it('renders heroes and metrics without div or span', () => {
    const hero = renderPageHero({
      id: 'hero',
      headingHtml: 'Title',
      lead: 'Lead',
    });
    const metric = renderMetric('100', 'Best practices');
    for (const html of [hero, metric]) {
      expect(html).not.toContain('<div');
      expect(html).not.toContain('<span');
      expect(html).not.toContain('style=');
    }
    expect(metric).toContain('<small>Best practices</small>');
    expect(metric).toContain('data-bn="bn-metric"');
  });
});
