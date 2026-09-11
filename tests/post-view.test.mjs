// The blog has two view trees (the Worker's SSR and the browser's). They
// diverged on escaping: the Worker escaped all five interpolations, the client
// escaped none, and a post title containing markup executed in the browser.
// These tests assert the property — no field can carry markup through — and
// that there is still only one renderer for both trees to share.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read } from './helpers/css.mjs';
import {
  escapeHtml, renderPostCard, renderPostsList, renderPostHeader,
} from '../pages/js/post-view.js';

const HOSTILE = '<img src=x onerror="window.pwned=1">';

const BASE_POST = {
  slug: 'a-post',
  title: 'A post',
  date: '2026-04-20',
  tags: ['one', 'two'],
  excerpt: 'An excerpt.',
};

const FIELDS = ['slug', 'title', 'date', 'excerpt'];

describe('escapeHtml', () => {
  it('neutralises every character that can open markup or break an attribute', () => {
    const escaped = escapeHtml(`<&">'`);
    for (const char of ['<', '>', '"', "'"]) {
      assert.ok(!escaped.includes(char), `${char} survived escaping: ${escaped}`);
    }
    assert.ok(escaped.includes('&amp;'), 'ampersand must be escaped first');
  });

  it('accepts non-string values without throwing', () => {
    assert.equal(escapeHtml(42), '42');
    assert.equal(escapeHtml(null), 'null');
  });
});

describe('renderPostCard', () => {
  for (const field of FIELDS) {
    it(`escapes ${field}`, () => {
      const html = renderPostCard({ ...BASE_POST, [field]: HOSTILE });
      // The property: the payload never reaches the output as itself. It may
      // appear as text, escaped — that is the point — so the check is that
      // the verbatim string, and any tag it could have opened, are absent.
      assert.ok(!html.includes(HOSTILE), `${field} interpolated raw: ${html}`);
      assert.ok(!html.includes('<img'), `${field} produced live markup: ${html}`);
      assert.ok(html.includes('&lt;img'), `${field} should appear escaped: ${html}`);
    });
  }

  it('escapes tags', () => {
    const html = renderPostCard({ ...BASE_POST, tags: [HOSTILE] });
    assert.ok(!html.includes('<img'), html);
    assert.ok(html.includes('&lt;img'), html);
  });

  it('emits no element outside the ones the stylesheet declares', () => {
    const css = read('pages/css/components.css');
    const html = renderPostCard(BASE_POST);
    const classes = [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
    assert.ok(classes.length > 0, 'card should carry classes rather than inline styles');
    for (const cls of classes) {
      assert.ok(css.includes('.' + cls), `.${cls} is used but never declared in components.css`);
    }
  });

  it('carries no inline style attribute', () => {
    assert.ok(!renderPostCard(BASE_POST).includes('style='), 'inline styles are against axiom 2');
  });

  it('omits optional fields rather than rendering empty elements', () => {
    const html = renderPostCard({ slug: 's', title: 'T' });
    assert.ok(!html.includes('<time'), html);
    assert.ok(!html.includes('post-card-tags'), html);
    assert.ok(!html.includes('post-card-excerpt'), html);
  });
});

describe('renderPostsList', () => {
  it('renders one card per post', () => {
    const html = renderPostsList([BASE_POST, { ...BASE_POST, slug: 'b' }]);
    assert.equal(html.match(/class="post-card"/g).length, 2);
  });

  it('has an empty state', () => {
    assert.match(renderPostsList([]), /No posts yet/);
  });
});

describe('renderPostHeader', () => {
  it('escapes the title', () => {
    const html = renderPostHeader({ ...BASE_POST, title: HOSTILE });
    assert.ok(!html.includes('<img'), html);
  });

  it('makes the post title the page heading', () => {
    // /blog/:slug has no other <h1>; the markdown body's own headings start
    // at <h2>, so the post title has to be the level above them.
    const html = renderPostHeader(BASE_POST);
    assert.match(html, /<h1[^>]*>/);
  });
});

describe('one renderer, both trees', () => {
  const sources = {
    'worker/index.js': read('worker/index.js'),
    'pages/js/blog.js': read('pages/js/blog.js'),
    'pages/js/blog-post.js': read('pages/js/blog-post.js'),
  };

  for (const [name, src] of Object.entries(sources)) {
    it(`${name} imports the shared renderer`, () => {
      assert.match(src, /from '[^']*post-view\.js'/, `${name} must import post-view.js`);
    });

    it(`${name} contains no second copy of the post markup`, () => {
      assert.ok(
        !src.includes('class="post-card"'),
        `${name} builds post-card markup of its own; that is how the two trees drifted`,
      );
    });
  }
});
