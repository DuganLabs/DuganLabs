// The blog has two view trees (the Worker's SSR and the browser's). They
// diverged on escaping: the Worker escaped all five interpolations, the client
// escaped none, and a post title containing markup executed in the browser.
// These tests assert the property — no field can carry markup through — and
// that there is still only one renderer for both trees to share.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read } from './helpers/css.mjs';
import {
  escapeHtml, formatDate, renderPostCard, renderPostsList, renderPostHeader,
  renderPostNav, neighbours,
} from '../pages/js/post-view.js';

const HOSTILE = '<img src=x onerror="window.pwned=1">';

const BASE_POST = {
  slug: 'a-post',
  title: 'A post',
  date: '2026-04-20',
  tags: ['one', 'two'],
  excerpt: 'An excerpt.',
  minutes: 4,
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

  it('carries no inline style attribute', () => {
    assert.ok(!renderPostCard(BASE_POST).includes('style='), 'inline styles are against axiom 2');
  });

  it('omits optional fields rather than rendering empty elements', () => {
    const html = renderPostCard({ slug: 's', title: 'T' });
    assert.ok(!html.includes('<time'), html);
    assert.ok(!html.includes('tag-list'), html);
    assert.ok(!html.includes('post-card-excerpt'), html);
    // No date and no reading time means no meta row at all — not an empty
    // <p> and not a stray separator with nothing on either side of it.
    assert.ok(!html.includes('post-card-meta'), html);
    assert.ok(!html.includes('meta-sep'), html);
  });

  it('omits the reading time when the index entry has none', () => {
    // Posts indexed before /blog showed a reading time carry no `minutes`.
    const html = renderPostCard({ slug: 's', title: 'T', date: '2026-04-20' });
    assert.ok(!html.includes('min read'), html);
    assert.ok(!html.includes('meta-sep'), 'a separator with one side missing');
    assert.ok(html.includes('<time'), html);
  });

  it('gives the date a machine-readable datetime and a readable body', () => {
    const html = renderPostCard(BASE_POST);
    assert.match(html, /<time class="meta-date" datetime="2026-04-20">20 Apr 2026<\/time>/);
  });

  it('links the title rather than wrapping the whole card in an anchor', () => {
    // A card that is itself one <a> gives a screen reader a link named after
    // the title, the date, the excerpt and every tag run together.
    const html = renderPostCard(BASE_POST);
    assert.match(html, /<article class="post-card">/);
    assert.equal(html.match(/<a /g).length, 1, 'exactly one link per card');
    assert.match(html, /class="post-card-link" href="\/blog\/a-post"/);
  });
});

describe('formatDate', () => {
  it('renders an ISO date as something a reader reads', () => {
    assert.equal(formatDate('2026-04-15'), '15 Apr 2026');
    assert.equal(formatDate('2026-12-01'), '1 Dec 2026');
  });

  it('is not locale-dependent', () => {
    // SSR runs in workerd and the client fallback runs in the visitor's
    // browser. toLocaleDateString would let those two disagree, and the
    // client re-render would silently rewrite the server's text.
    const code = read('pages/js/post-view.js')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const api of ['toLocaleDateString', 'toLocaleString', 'Intl.']) {
      assert.ok(!code.includes(api), `${api} lets the server and the client disagree about the same date`);
    }
  });

  it('passes through anything that is not an ISO date', () => {
    assert.equal(formatDate('someday'), 'someday');
    assert.equal(formatDate(''), '');
    assert.equal(formatDate(undefined), '');
  });
});

describe('renderPostsList', () => {
  it('renders one card per post', () => {
    const html = renderPostsList([BASE_POST, { ...BASE_POST, slug: 'b' }]);
    assert.equal(html.match(/class="post-card"/g).length, 2);
  });

  it('says how many posts there are', () => {
    assert.match(renderPostsList([BASE_POST, { ...BASE_POST, slug: 'b' }]), /2 posts/);
    assert.match(renderPostsList([BASE_POST]), /1 post</, 'singular, not "1 posts"');
  });

  it('has an empty state', () => {
    const html = renderPostsList([]);
    assert.match(html, /No posts yet/);
    // Designed, not a bare sentence: a heading, an explanation, and
    // somewhere to go instead.
    assert.match(html, /class="empty-state"/);
    assert.match(html, /class="empty-state-actions"/);
    assert.ok(!html.includes('post-count'), 'no "0 posts" over an empty state');
  });
});

describe('renderPostNav', () => {
  const INDEX = [
    { slug: 'c', title: 'Newest' },
    { slug: 'b', title: 'Middle' },
    { slug: 'a', title: 'Oldest' },
  ];

  it('finds both neighbours in a newest-first index', () => {
    assert.deepEqual(neighbours(INDEX, 'b'), { newer: INDEX[0], older: INDEX[2] });
  });

  it('has no newer post at the top of the index and no older at the bottom', () => {
    assert.equal(neighbours(INDEX, 'c').newer, null);
    assert.equal(neighbours(INDEX, 'a').older, null);
  });

  it('returns nothing for a slug the index does not contain', () => {
    assert.deepEqual(neighbours(INDEX, 'nope'), {});
    assert.equal(renderPostNav(neighbours(INDEX, 'nope')), '');
  });

  it('renders nothing at all rather than an empty bar', () => {
    assert.equal(renderPostNav({}), '');
    assert.equal(renderPostNav(), '');
  });

  it('holds the empty half of the row when there is only one neighbour', () => {
    // Otherwise an "Older post" link slides left into the column where
    // "Newer post" would have been.
    const html = renderPostNav(neighbours(INDEX, 'c'));
    assert.match(html, /post-nav-blank/);
    assert.match(html, /data-dir="older"/);
  });

  it('escapes the neighbour titles and slugs', () => {
    const html = renderPostNav({ newer: { slug: HOSTILE, title: HOSTILE }, older: null });
    assert.ok(!html.includes('<img'), html);
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

  it('gives the way back to the index a real target, not a bare link in a <p>', () => {
    assert.match(renderPostHeader(BASE_POST), /<a class="back-link" href="\/blog">/);
  });
});

// Every fragment, not just the card: a class the stylesheet has no rule for
// renders as unstyled text, and the org has shipped that twice.
describe('every fragment is styled by a rule that exists', () => {
  const css = read('pages/css/components.css');
  const fragments = {
    'renderPostCard': renderPostCard(BASE_POST),
    'renderPostCard (bare)': renderPostCard({ slug: 's', title: 'T' }),
    'renderPostsList': renderPostsList([BASE_POST]),
    'renderPostsList (empty)': renderPostsList([]),
    'renderPostHeader': renderPostHeader(BASE_POST),
    'renderPostNav': renderPostNav({ newer: BASE_POST, older: null }),
  };

  for (const [name, html] of Object.entries(fragments)) {
    it(`${name} emits no class the stylesheet does not declare`, () => {
      const classes = [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/));
      assert.ok(classes.length > 0, `${name} should carry classes rather than inline styles`);
      for (const cls of classes) {
        assert.ok(css.includes('.' + cls), `.${cls} is used but never declared in components.css`);
      }
    });

    it(`${name} carries no inline style attribute`, () => {
      assert.ok(!html.includes('style='), `${name}: inline styles are against axiom 2`);
    });
  }
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
