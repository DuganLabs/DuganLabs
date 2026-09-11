// /ecosystem renders @basenative/marketplace's package card (vendored at
// pages/vendor/basenative/marketplace/card.js). These tests assert the
// properties that make it safe to vendor: every data-bn name it emits is one
// the stylesheet actually declares a rule for, the heading level is a knob
// whose default matches upstream, and the SSR and client trees pass the same
// options.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read } from './helpers/css.mjs';
import { renderPackageCard } from '../pages/vendor/basenative/marketplace/card.js';

const PKG = {
  name: '@basenative/runtime',
  description: 'Signal-based reactivity.',
  version: '1.0.0',
  category: 'core',
  tags: ['signals', 'reactivity'],
  downloads: 0,
  repo: 'https://github.com/DuganLabs/BaseNative',
};

/** data-bn names the stylesheet declares a rule for. */
function declaredNames() {
  const css = read('pages/css/components.css');
  return new Set([...css.matchAll(/\[data-bn="([^"]+)"\]/g)].map((m) => m[1]));
}

function emittedNames(html) {
  return new Set([...html.matchAll(/data-bn="([^"]+)"/g)].map((m) => m[1]));
}

describe('markup contract', () => {
  // The org has shipped a component twice whose variant matched no rule and
  // rendered as unstyled text. Same class of bug: a data-bn name nothing
  // styles is invisible markup.
  it('every data-bn name it emits is declared in the stylesheet', () => {
    const declared = declaredNames();
    const undeclared = [...emittedNames(renderPackageCard(PKG))].filter((n) => !declared.has(n));
    assert.deepEqual(undeclared, [], 'data-bn names with no rule in components.css');
  });

  it('emits the names /ecosystem is built around', () => {
    const emitted = emittedNames(renderPackageCard(PKG));
    for (const name of ['pkg-card', 'pkg-header', 'pkg-name', 'pkg-category', 'pkg-desc', 'pkg-tags', 'pkg-tag', 'pkg-stats']) {
      assert.ok(emitted.has(name), `missing data-bn="${name}"`);
    }
  });

  it('carries no inline style attribute', () => {
    assert.ok(!renderPackageCard(PKG).includes('style='));
  });
});

describe('heading level', () => {
  it('defaults to upstream @basenative/marketplace behaviour (h4)', () => {
    assert.match(renderPackageCard(PKG), /<h4 data-bn="pkg-name">/);
  });

  it('honours an explicit level', () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      const html = renderPackageCard(PKG, { headingLevel: level });
      assert.match(html, new RegExp(`<h${level} data-bn="pkg-name">`));
      assert.match(html, new RegExp(`</h${level}>`));
    }
  });

  it('falls back to the default for values that are not a heading level', () => {
    for (const bad of [0, 7, -1, 2.5, 'three', null, undefined, {}]) {
      assert.match(
        renderPackageCard(PKG, { headingLevel: bad }),
        /<h4 data-bn="pkg-name">/,
        `headingLevel ${JSON.stringify(bad)} should fall back, not emit <h${bad}>`,
      );
    }
  });

  it('keeps the data-bn contract at every level', () => {
    // The level is presentation-adjacent; the contract consumers target is
    // the attribute, and it must not depend on the element name.
    for (const level of [1, 3, 4, 6]) {
      assert.ok(renderPackageCard(PKG, { headingLevel: level }).includes('data-bn="pkg-name"'));
    }
  });
});

describe('escaping', () => {
  const HOSTILE = '<img src=x onerror="window.pwned=1">';
  for (const field of ['name', 'description', 'category', 'version']) {
    it(`escapes ${field}`, () => {
      const html = renderPackageCard({ ...PKG, [field]: HOSTILE });
      assert.ok(!html.includes('<img'), `${field}: ${html}`);
    });
  }

  it('escapes tags and the repo URL', () => {
    const hostileUrl = 'https://x/"onmouseover="1';
    const html = renderPackageCard({ ...PKG, tags: [HOSTILE], repo: hostileUrl });
    assert.ok(!html.includes('<img'), html);
    // The property for an attribute value: it cannot close its own quote.
    assert.ok(!html.includes(hostileUrl), `repo interpolated raw: ${html}`);
    const href = html.match(/href="([^"]*)"/);
    assert.ok(href, html);
    assert.ok(!href[1].includes('"'), `href value breaks out of its quotes: ${href[1]}`);
  });
});

describe('both trees render the same card', () => {
  const worker = read('worker/index.js');
  const client = read('pages/js/ecosystem.js');

  it('both import the vendored component instead of copying it', () => {
    for (const [name, src] of [['worker/index.js', worker], ['pages/js/ecosystem.js', client]]) {
      assert.match(src, /marketplace\/card\.js'/, `${name} must import the vendored card`);
      assert.ok(
        !src.includes('data-bn="pkg-card"'),
        `${name} still builds package-card markup of its own`,
      );
    }
  });

  it('both pass the same heading level', () => {
    const level = (src) => {
      const m = src.match(/headingLevel:\s*(\d+)/);
      return m ? m[1] : null;
    };
    const workerLevel = level(worker);
    assert.ok(workerLevel, 'worker/index.js does not set a heading level');
    assert.equal(
      workerLevel,
      level(client),
      'SSR and client would render the package name at different heading levels',
    );
  });
});
