/**
 * Structural contracts for the marketing stylesheet.
 *
 * These assert *properties* of the design system rather than its current
 * output, so they fail on the next regression instead of recording today's
 * bytes:
 *
 *   1. the page gutter is applied exactly once — `[data-bn-column]` owns it;
 *   2. every nav tap target is at least the site's own tap-size token;
 *   3. every button variant the pages emit is one `@basenative/platform`
 *      declares for `bn-button` (the published sheet also declares variants
 *      these pages do not emit; that is the package, not a local invention);
 *   4. the pages and the site chrome are composed from the shared surface
 *      and `@basenative/platform` — a hand-built imitation of a block the
 *      surface owns fails even when its output matches.
 *
 * The section list (1) and the variant list (3) are both *derived* from
 * templates.ts, so a section or a variant added tomorrow is covered without
 * anyone editing this file.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { siteStyles } from './styles.js';
import * as templates from './templates.js';

const require = createRequire(import.meta.url);

/**
 * Every page template, concatenated. Taken from the module's exports rather
 * than from the file on disk, so this asserts against the markup the worker
 * actually serves — and so a template added to templates.ts is picked up the
 * moment it is exported.
 */
const templatesSource = Object.values(templates)
  .filter((v): v is string => typeof v === 'string')
  .join('\n');

const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '');

/** The stylesheet exactly as it is served. */
const css = stripComments(siteStyles);

// ── CSS parsing helpers ───────────────────────────────────────────────────

/**
 * Split a selector list on top-level commas only, so the commas inside
 * `:is(a, b)` / `:where(…)` / `[attr="x,y"]` do not create phantom selectors.
 */
const splitSelectorList = (list: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let inBracket = false;
  let quote: string | null = null;
  let current = '';
  for (const ch of list) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === '[') inBracket = true;
    else if (ch === ']') inBracket = false;
    if (ch === ',' && depth === 0 && !inBracket) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
};

/** Collapse runs of whitespace so `li > a` and `li  >  a` compare equal. */
const normalizeSelector = (s: string): string =>
  s
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~])\s*/g, ' $1 ')
    .trim();

type Rule = { selectors: string[]; body: string };

/**
 * Every innermost rule in the stylesheet. The `[^{}]` bodies mean at-rule
 * wrappers (`@media`, `@layer`) are skipped and the rules nested inside them
 * are returned instead — which is what we want.
 */
const rules: Rule[] = (() => {
  const out: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    out.push({
      selectors: splitSelectorList(m[1]).map(normalizeSelector),
      body: m[2],
    });
  }
  return out;
})();

/** Every declaration body whose selector list contains `selector`, in order. */
const bodiesFor = (selector: string): string[] => {
  const want = normalizeSelector(selector);
  return rules.filter((r) => r.selectors.includes(want)).map((r) => r.body);
};

/** The last value declared for `prop` across the given bodies. */
const declaredValue = (bodies: string[], prop: string): string | null => {
  let last: string | null = null;
  for (const body of bodies) {
    const re = new RegExp(`(?:^|[;{}])\\s*${prop}\\s*:\\s*([^;}]+)`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) last = m[1].trim();
  }
  return last;
};

/** Resolve a `var(--x)` chain against the custom properties in the sheet. */
const resolveToken = (value: string): string => {
  let v = value.trim();
  for (let i = 0; i < 10 && v.includes('var('); i++) {
    const before = v;
    v = v.replace(
      /var\(\s*(--[\w-]+)\s*(?:,[^()]*)?\)/g,
      (whole, name: string) => {
        const decl = new RegExp(`${name}\\s*:\\s*([^;}]+)`).exec(css);
        return decl ? decl[1].trim() : whole;
      },
    );
    if (v === before) break;
  }
  return v;
};

const toPx = (value: string): number | null => {
  const v = resolveToken(value);
  const rem = /^([\d.]+)rem$/.exec(v);
  if (rem) return parseFloat(rem[1]) * 16;
  const px = /^([\d.]+)px$/.exec(v);
  if (px) return parseFloat(px[1]);
  return null;
};

// ── derive the bands that wrap a column from the templates and chrome ────

const VOID_TAGS = new Set([
  'br',
  'img',
  'input',
  'meta',
  'link',
  'hr',
  'source',
  'path',
  'circle',
  'rect',
  'line',
  'use',
  'polyline',
  'polygon',
  'ellipse',
  'stop',
  'area',
  'base',
  'col',
  'embed',
  'track',
  'wbr',
  'defs',
]);

const sectionsWrappingAColumn = (markup: string): string[] => {
  const stack: { tag: string; name: string | null }[] = [];
  const found = new Set<string>();
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(markup))) {
    const [whole, tag, attrs, selfClose] = m;
    if (whole.startsWith('</')) {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].tag === tag) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    if (selfClose || VOID_TAGS.has(tag)) continue;
    const name = /data-bn="([^"]+)"/.exec(attrs)?.[1] ?? null;
    if (/(?:^|\s)data-bn-column(?:\s|$)/.test(attrs)) {
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name) {
          found.add(stack[k].name as string);
          break;
        }
      }
    }
    stack.push({ tag, name });
  }
  return [...found].sort();
};

const chromeSource = readFileSync(
  new URL('./chrome.ts', import.meta.url),
  'utf8',
);
const CONTAINER_SECTIONS = sectionsWrappingAColumn(
  `${templatesSource}\n${chromeSource}`,
);

const INLINE_PADDING_PROPS = [
  'padding-inline',
  'padding-inline-start',
  'padding-inline-end',
  'padding-left',
  'padding-right',
];

// ── the page spine ────────────────────────────────────────────────────────

/**
 * The rules that declare an inline gutter, i.e. `padding-inline` (or one of
 * its longhands, or the `padding` shorthand, which always sets the inline
 * sides too). Returned as selector lists.
 */
const gutterOwners = (): Rule[] =>
  rules.filter((r) =>
    [...INLINE_PADDING_PROPS, 'padding'].some(
      (prop) => declaredValue([r.body], prop) !== null,
    ),
  );

/**
 * The spine: the selector list of the one rule that reads --page-gutter.
 * Derived from the stylesheet rather than hardcoded here, so adding a member
 * to that rule extends every assertion below without editing this file — and
 * so moving a member OUT of it fails loudly.
 */
const SPINE: string[] = (() => {
  const owners = rules.filter(
    (r) =>
      (declaredValue([r.body], 'padding-inline') ?? '') ===
      'var(--page-gutter)',
  );
  return owners.flatMap((r) => r.selectors);
})();

describe('page gutter', () => {
  // The whole point of the token: one name, read in one place.
  it('is a single named token', () => {
    expect(
      /--page-gutter\s*:/.test(css),
      '--page-gutter is not declared — the gutter has no single owner',
    ).toBe(true);
    expect(toPx('var(--page-gutter)')).not.toBeNull();
  });

  it('has exactly one rule that reads --page-gutter', () => {
    const readers = rules.filter((r) =>
      [...INLINE_PADDING_PROPS, 'padding'].some((prop) =>
        (declaredValue([r.body], prop) ?? '').includes('var(--page-gutter)'),
      ),
    );
    expect(
      readers.length,
      `${readers.length} rules read --page-gutter; the spine must be declared once`,
    ).toBe(1);
  });

  it('the spine is the shared column', () => {
    // Guards the derivation: without this every assertion below would pass
    // vacuously if the spine rule were renamed out from under them.
    expect(SPINE).toEqual(['[data-bn-column]']);
  });

  // The property that broke three times: two wrappers that each compute their
  // own inset agree only by coincidence. A spine member takes its gutter from
  // the spine rule and from nowhere else.
  it.each(SPINE)('%s takes its gutter only from the spine rule', (member) => {
    const others = gutterOwners().filter(
      (r) =>
        r.selectors.includes(member) &&
        (declaredValue([r.body], 'padding-inline') ?? '') !==
          'var(--page-gutter)',
    );
    expect(
      others.map((r) => r.selectors.join(', ')),
      `${member} gets an inline gutter from a second rule as well as the spine`,
    ).toEqual([]);
  });

  // Same for the centring half. `max-inline-size` + `margin-inline: auto`
  // without the matching padding is what put the footer's copyright row 64px
  // left of the brand at 1280.
  it.each(SPINE)('%s is centred only by the spine rule', (member) => {
    const bodies = rules
      .filter((r) => r.selectors.includes(member))
      .filter(
        (r) =>
          (declaredValue([r.body], 'padding-inline') ?? '') !==
          'var(--page-gutter)',
      )
      .map((r) => r.body);
    for (const prop of ['max-inline-size', 'margin-inline']) {
      expect(
        declaredValue(bodies, prop),
        `${member} declares ${prop} outside the spine rule`,
      ).toBeNull();
    }
  });

  it('covers every band the pages wrap a column in', () => {
    // Guards the derivation itself: if the walker silently stops finding
    // columns, the per-section assertions below would all vacuously pass.
    // Page bands moved onto the v4 shell and no longer wrap a data-bn
    // column. The retired chrome still does, and the sheet still has to
    // leave those bands unguttered.
    expect(CONTAINER_SECTIONS).toEqual(
      expect.arrayContaining(['bn-topbar', 'bn-site-footer']),
    );
    expect(CONTAINER_SECTIONS).not.toContain('bn-section');
  });

  // The property: a full-bleed band that wraps the column must not add a
  // gutter of its own, or its content is inset twice and stops lining up with
  // the hero, the nav and the footer.
  it.each(CONTAINER_SECTIONS)(
    '[data-bn="%s"] adds no inline padding of its own',
    (section) => {
      const bodies = bodiesFor(`[data-bn="${section}"]`);
      expect(
        bodies.length,
        `no rule found for [data-bn="${section}"]`,
      ).toBeGreaterThan(0);

      for (const prop of INLINE_PADDING_PROPS) {
        expect(
          declaredValue(bodies, prop),
          `[data-bn="${section}"] declares ${prop}, but the page-spine rule already owns the gutter`,
        ).toBeNull();
      }

      // The `padding` shorthand always sets the inline sides too, so it is
      // never safe here — use `padding-block`.
      expect(
        declaredValue(bodies, 'padding'),
        `[data-bn="${section}"] uses the \`padding\` shorthand, which sets the inline sides as well; use \`padding-block\` so the spine keeps the sole gutter`,
      ).toBeNull();
    },
  );
});

// ── unresolvable custom properties ────────────────────────────────────────

describe('custom properties', () => {
  /** Every --name referenced by a var() anywhere in the served sheet. */
  const referenced = new Set<string>();
  for (const m of css.matchAll(/var\(\s*(--[\w-]+)\s*(,|\))/g)) {
    // A var() with a fallback can survive its name being undeclared.
    if (m[2] === ',') continue;
    referenced.add(m[1]);
  }
  const declared = new Set<string>();
  for (const m of css.matchAll(/(--[\w-]+)\s*:/g)) declared.add(m[1]);

  // The property --brand-hue broke: `hsl(var(--brand-hue) 60% 96%)` with no
  // declaration anywhere makes the whole `background` invalid at
  // computed-value time, so four of /features' five placeholder tiles
  // rendered as empty transparent boxes — silently, with no console error.
  // It is the same failure the hero's gutter hit. A var() that cannot
  // resolve and has no fallback is a bug wherever it appears.
  it('every var() without a fallback names a declared property', () => {
    const missing = [...referenced].filter((n) => !declared.has(n)).sort();
    expect(
      missing,
      `referenced with no declaration and no fallback: ${missing.join(', ')} — each one silently voids its whole declaration`,
    ).toEqual([]);
  });
});

describe('nav tap targets', () => {
  const tapMin = toPx('var(--gp-tap-min)');

  it('the shared tap token resolves to at least 44px', () => {
    expect(tapMin, '--gp-tap-min did not resolve to a length').not.toBeNull();
    expect(tapMin as number).toBeGreaterThanOrEqual(44);
  });

  // The property: the phone's only route into the navigation, and every link
  // in the drawer it opens, is at least the target size this stylesheet
  // already applies to the skip link and the footer.
  const TARGETS: ReadonlyArray<readonly [string, readonly string[]]> = [
    [
      '[data-bn="bn-rail"] > a:not([data-bn="bn-button"])',
      ['min-block-size', 'min-inline-size'],
    ],
    [
      '[data-bn="bn-tab-bar"][data-placement="floating"] [data-bn="bn-tab"]',
      ['min-block-size'],
    ],
    ['[data-bn="bn-brand"]', ['min-block-size']],
  ];

  it.each(TARGETS.map(([s, p]) => [s, p] as [string, readonly string[]]))(
    '%s is at least the tap minimum',
    (selector, props) => {
      const bodies = bodiesFor(selector);
      expect(bodies.length, `no rule found for ${selector}`).toBeGreaterThan(0);
      for (const prop of props) {
        const value = declaredValue(bodies, prop);
        expect(value, `${selector} declares no ${prop}`).not.toBeNull();
        const px = toPx(value as string);
        expect(
          px,
          `${selector} ${prop}: "${value}" does not resolve to a length`,
        ).not.toBeNull();
        expect(
          px as number,
          `${selector} ${prop} resolves to ${px}px, below the ${tapMin}px tap minimum`,
        ).toBeGreaterThanOrEqual(tapMin as number);
      }
    },
  );
});

// ── button variant contract ───────────────────────────────────────────────

/** Variants the templates emit, both static and bound. */
const emittedVariants = (): string[] => {
  const out = new Set<string>();
  // Static: data-variant="primary"
  for (const m of templatesSource.matchAll(
    /(?<![:\w-])data-variant="([^"{}]+)"/g,
  )) {
    out.add(m[1].trim());
  }
  // Bound: :data-variant="cond ? 'primary' : 'ghost'" — take the string
  // literals out of the expression.
  for (const m of templatesSource.matchAll(/:data-variant="([^"]*)"/g)) {
    for (const lit of m[1].matchAll(/'([^']+)'/g)) out.add(lit[1].trim());
  }
  return [...out].sort();
};

/** Variants `@basenative/platform` declares for `bn-button`. */
const platformButtonVariants = (): string[] => {
  const source = readFileSync(
    require.resolve('@basenative/platform/components.css'),
    'utf8',
  );
  const out = new Set<string>();
  const re = /\[data-bn=(['"])bn-button\1\]\[data-variant=\1([^'"]+)\1\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.add(m[2]);
  return [...out].sort();
};

describe('button variant contract', () => {
  const emitted = emittedVariants();
  const upstream = platformButtonVariants();

  it('marketing templates no longer emit bn-button variants', () => {
    // v4 links use a variant attribute styled by gp4.css. A data-variant
    // here would be an unstyled platform button.
    expect(emitted).toEqual([]);
    expect(templatesSource).not.toContain('data-bn="bn-button"');
  });

  it('@basenative/platform declares a non-empty bn-button variant set', () => {
    expect(upstream.length).toBeGreaterThan(0);
  });

  // A variant that matches no published rule renders as unstyled text.
  // The published sheet also declares variants these pages do not emit
  // (glass, borderless); those stay in the package and are not dead
  // weight for GreenPut to delete.
  it('every emitted variant is a published bn-button variant', () => {
    const undeclared = emitted.filter((v) => !upstream.includes(v));
    expect(
      undeclared,
      `emitted but not in @basenative/platform (${upstream.join(' | ')}): ${undeclared.join(', ')}`,
    ).toEqual([]);
  });
});

// ── Real design-system usage ──────────────────────────────────────────────
//
// The contracts above derive from the templates' *output*, which a
// hand-built imitation satisfies just as well as the real components —
// that is how the site ran for months on ~160 hand-written data-bn blocks
// that merely mimicked the DS. These tests close that hole: they read
// the source files, so a page that regresses to hand-writing a block a
// DS component owns fails here even if its output still looks right.
import { renderMarketingPage } from './index.js';

const templatesFileSource = readFileSync(
  require.resolve('./templates.ts'),
  'utf8',
);
const chromeFileSource = readFileSync(require.resolve('./chrome.ts'), 'utf8');

describe('real design-system usage', () => {
  it('templates.ts is the v4 document shell', () => {
    expect(templatesFileSource).toContain('href="/css/gp4.css"');
    expect(templatesFileSource).toContain('color-scheme" content="light"');
    expect(templatesFileSource).not.toContain('prefers-color-scheme');
    expect(templatesFileSource).not.toContain('/css/styles.css');
    expect(templatesFileSource).not.toContain("from '@greenput/shared/design'");
    expect(templatesFileSource).not.toContain("from '@basenative/components'");
    for (const fn of [
      'renderPageHero',
      'renderPlanCards',
      'renderFaqList',
      'renderInfoCard',
      'renderHero(',
      'renderPricingCards(',
      'renderFeatureCard(',
      'renderStatCard(',
      'renderFaq(',
    ]) {
      expect(templatesFileSource).not.toContain(fn);
    }
  });

  it('chrome.ts composes the platform tab bar and buttons', () => {
    expect(chromeFileSource).toContain("from '@basenative/platform'");
    expect(chromeFileSource).toContain('renderFloatingTabs');
    expect(chromeFileSource).toContain('data-bn="bn-symbol"');
    expect(chromeFileSource).toContain('renderBnButton');
    for (const fn of [
      'renderSiteHeader',
      'renderSiteFooter',
      'renderAppShell',
    ]) {
      expect(chromeFileSource).not.toContain(fn);
    }
  });

  it('no hand-built duplicates of retired blocks remain in templates.ts', () => {
    for (const literal of [
      '<section data-bn="hero"',
      '<section data-bn="page-hero"',
      '<li data-bn="pricing-card"',
      '<div data-bn="faq-item"',
      '<div data-bn="stat-card"',
      '<article data-bn="feature-card"',
      '<li data-bn="feature-card"',
      'data-bn="nav-toggle-input"',
      '<header data-bn="site-header"',
      '<footer data-bn="site-footer"',
      '<div',
      '<span',
    ]) {
      expect(templatesFileSource).not.toContain(literal);
    }
  });

  it('rendered pages carry the v4 shell', () => {
    const pricing = renderMarketingPage('pricing', 'dsnonce');
    expect(pricing).toContain('id="pricing-heading"');
    expect(pricing).toContain('data-gp4="1"');
    expect(pricing).toContain('/css/gp4.css');
    expect(pricing).not.toContain('data-bn="bn-topbar"');
    expect(pricing).not.toContain('/css/styles.css');
    expect(pricing).not.toContain('prefers-color-scheme');
    expect(pricing).toContain('data-featured');
    expect(pricing).toContain('Core revenue model');
    for (const route of ['ai', 'investors']) {
      const html = renderMarketingPage(route, 'dsnonce');
      expect(html).toContain(`id="${route}-heading"`);
      expect(html).toContain('data-gp4="1"');
      expect(html).not.toContain('data-bn="bn-topbar"');
    }
    const home = renderMarketingPage('home', 'dsnonce');
    expect(home).toContain('data-gp4="1"');
    expect(home).toContain('/css/gp4.css');
    expect(home).not.toContain('data-bn="bn-topbar"');
    expect(home).not.toContain('/css/styles.css');
  });

  it('the stylesheet is the shared surface, with glass and no page selectors', () => {
    expect(css).toMatch(/--page-gutter\s*:/);
    expect(css).toContain('backdrop-filter: saturate(180%) blur(30px)');
    expect(css).toContain('--gp-font-system');
    expect(css).toContain('var(--gp-primary)');
    for (const retired of [
      'tech-scores',
      '[data-bn="hero"]',
      '[data-bn="nav-toggle"]',
      '[data-bn="site-header"]',
    ]) {
      expect(css).not.toContain(retired);
    }
  });
});
