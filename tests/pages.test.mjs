// Page-level structure that a browser would otherwise be the only thing to
// catch: the document outline, the skip link, and outbound links the public
// cannot follow. Where a page's real content is rendered rather than written
// into the shell, the renderers are spliced in so the outline under test is
// the one a visitor gets.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read } from './helpers/css.mjs';
import { renderPostsList } from '../pages/js/post-view.js';
import { renderPackageCard } from '../pages/vendor/basenative/marketplace/card.js';

const SAMPLE_POSTS = [
  { slug: 'a', title: 'A post', date: '2026-04-20', tags: ['x'], excerpt: 'One.' },
  { slug: 'b', title: 'Another post', date: '2026-03-02', tags: [], excerpt: 'Two.' },
];

const SAMPLE_PACKAGES = [
  { name: '@basenative/runtime', description: 'Signals.', version: '1.0.0', category: 'core', tags: ['signals'], downloads: 0 },
  { name: '@basenative/router', description: 'Routing.', version: '1.0.0', category: 'core', tags: ['routing'], downloads: 0 },
];

// Kept in step with pages/js/ecosystem.js and worker/index.js by
// tests/package-card.test.mjs, which asserts those two agree.
const PKG_HEADING_LEVEL = Number(
  read('pages/js/ecosystem.js').match(/headingLevel:\s*(\d+)/)[1],
);

/** The shells, with the content the renderers put into them at runtime. */
function pages() {
  return {
    'index.html': read('pages/index.html'),
    '404.html': read('pages/404.html'),
    'blog.html': read('pages/blog.html').replace(
      '<p id="posts-loading">Loading posts...</p>',
      renderPostsList(SAMPLE_POSTS),
    ),
    'blog-post.html': read('pages/blog-post.html').replace(
      '<p id="post-loading">Loading post...</p>',
      '<header class="post-header"><h1 class="post-header-title">A post</h1></header><div class="prose"><h2>A section</h2></div>',
    ),
    'ecosystem.html': read('pages/ecosystem.html').replace(
      '<p class="eco-empty">Loading packages...</p>',
      SAMPLE_PACKAGES.map((p) => renderPackageCard(p, { headingLevel: PKG_HEADING_LEVEL })).join(''),
    ),
  };
}

const PAGES = pages();

function headings(html) {
  return [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => ({
    level: Number(m[1]),
    text: m[2].replace(/<[^>]*>/g, '').trim(),
  }));
}

describe('document outline', () => {
  for (const [name, html] of Object.entries(PAGES)) {
    it(`${name} has exactly one h1`, () => {
      const h1s = headings(html).filter((h) => h.level === 1);
      assert.equal(h1s.length, 1, `expected 1 h1, found ${h1s.length}: ${JSON.stringify(h1s)}`);
    });

    it(`${name}'s h1 is the page heading, not the site wordmark`, () => {
      const h1 = headings(html).find((h) => h.level === 1);
      assert.notEqual(
        h1.text,
        'DuganLabs',
        'the wordmark is the site name and appears on every page; it cannot be what each page announces itself as',
      );
    });

    it(`${name} never skips a heading level`, () => {
      const levels = headings(html).map((h) => h.level);
      const skips = [];
      for (let i = 1; i < levels.length; i++) {
        if (levels[i] > levels[i - 1] + 1) {
          skips.push(`h${levels[i - 1]} → h${levels[i]}`);
        }
      }
      assert.deepEqual(skips, [], `heading levels: ${levels.join(',')}`);
    });
  }
});

describe('skip link', () => {
  for (const [name, html] of Object.entries(PAGES)) {
    it(`${name} opens its body with a skip link`, () => {
      const body = html.slice(html.indexOf('<body'));
      const firstElement = body.match(/<body[^>]*>\s*((?:<!--[\s\S]*?-->\s*)*<[^>]+>)/);
      assert.ok(firstElement, `could not find the first element in ${name}'s body`);
      assert.match(
        firstElement[1],
        /class="skip-link"/,
        'the skip link has to be the first focusable thing on the page to be reachable',
      );
    });

    it(`${name}'s skip link points at a target that exists and can take focus`, () => {
      const href = html.match(/class="skip-link"\s+href="#([^"]+)"/);
      assert.ok(href, `${name} has no skip link href`);
      const target = new RegExp(`id="${href[1]}"[^>]*`).exec(html);
      assert.ok(target, `${name} has no element with id="${href[1]}"`);
      assert.match(
        target[0],
        /tabindex="-1"/,
        'the target needs tabindex="-1" or focus stays on the body after the jump',
      );
    });
  }
});

describe('outbound links', () => {
  // Repositories that are private on GitHub. An anonymous visitor gets a 404
  // from these, so the public site must not link them. Delete an entry the
  // day its repository goes public — that is the fix, this is the guard.
  const PRIVATE_REPOS = [
    'https://github.com/DuganLabs/GreenPut',
    'https://github.com/DuganLabs/PendingBusiness',
  ];

  for (const [name, html] of Object.entries(PAGES)) {
    it(`${name} links no repository the public cannot open`, () => {
      const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
      const dead = hrefs.filter((href) =>
        PRIVATE_REPOS.some((repo) => href === repo || href.startsWith(repo + '/')),
      );
      assert.deepEqual(dead, [], `${name} links a private repository`);
    });
  }

  it('says so where a source link was dropped for being private', () => {
    // Silence would read as "this project has no source"; the card should
    // account for the missing link rather than just omit it.
    const html = PAGES['index.html'];
    const cards = html.split('<div class="project-card"');
    const privateCards = cards.filter((c) => /<h3>(GreenPut|PendingBusiness)<\/h3>/.test(c));
    assert.equal(privateCards.length, 2, 'expected the two private-source project cards');
    for (const card of privateCards) {
      assert.match(card, /class="links-note"/, 'private-source card should state the state');
    }
  });
});

describe('inline styles', () => {
  for (const [name, html] of Object.entries(PAGES)) {
    it(`${name} ships no style attribute and no inline <style> block`, () => {
      // BaseNative axiom 2: all CSS lives in cascade layers. Inline styles
      // also re-download on every page view instead of being cached.
      const styleAttrs = [...html.matchAll(/<[^>]+\sstyle="/g)].length;
      assert.equal(styleAttrs, 0, `${name} carries ${styleAttrs} style attributes`);
      assert.ok(!/<style[\s>]/.test(html), `${name} carries an inline <style> block`);
    });
  }
});
