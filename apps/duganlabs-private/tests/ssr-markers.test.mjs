// The Worker server-renders by string-replacing markers in the static
// shells (worker/index.js: renderBlogPage, renderEcosystemPage,
// renderPostPage). String.replace on a string that is not present is a
// no-op — it does not throw, it does not warn, it just leaves the shell
// alone. So a marker that stops matching ships a page reading "Loading
// posts..." forever, and nothing in CI notices.
//
// These tests pull every marker literal out of the Worker and assert the
// shell it is aimed at actually contains it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read } from './helpers/css.mjs';

const WORKER = read('worker/index.js');

/** The body of a named function declaration, up to its closing brace. */
function functionBody(name) {
  const start = WORKER.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `worker/index.js has no function ${name}`);
  let depth = 0;
  let i = WORKER.indexOf('{', start);
  const from = i;
  for (; i < WORKER.length; i++) {
    if (WORKER[i] === '{') depth++;
    else if (WORKER[i] === '}') {
      depth--;
      if (depth === 0) return WORKER.slice(from, i + 1);
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

/**
 * The first argument of every `.replace('…', …)` in a chunk of source.
 * Only single-quoted literals — a marker built from a template or a
 * variable is not a literal this test can check, and none exist today.
 */
function markers(src) {
  return [...src.matchAll(/\.replace\(\s*'((?:[^'\\]|\\.)*)'/g)]
    .map((m) => m[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
}

// Which shell each SSR function renders into.
const RENDERERS = [
  ['renderBlogPage', 'pages/blog.html'],
  ['renderEcosystemPage', 'pages/ecosystem.html'],
  ['renderPostPage', 'pages/blog-post.html'],
];

describe('SSR markers exist in the shell they target', () => {
  for (const [fn, shellPath] of RENDERERS) {
    const found = markers(functionBody(fn));
    const shell = read(shellPath);

    it(`${fn} replaces at least one marker`, () => {
      assert.ok(found.length > 0, `no .replace('…') literals found in ${fn} — did it stop using string replacement?`);
    });

    for (const marker of found) {
      it(`${shellPath} contains ${JSON.stringify(marker.slice(0, 60))}`, () => {
        assert.ok(
          shell.includes(marker),
          `${fn} replaces a string ${shellPath} does not contain, so that replacement is a silent no-op`,
        );
      });
    }
  }
});

describe('the SSR handshake', () => {
  // The Worker marks the container it filled with data-ssr="1"; the client
  // script sees that and leaves the DOM alone. If the Worker stops setting
  // it the client re-fetches and repaints over server-rendered content; if
  // the client stops reading it, it does the same.
  const CONTRACT = [
    ['pages/js/blog.js', 'posts-list'],
    ['pages/js/blog-post.js', 'post-article'],
    ['pages/js/ecosystem.js', 'eco-grid'],
  ];

  for (const [client, id] of CONTRACT) {
    it(`${client} checks data-ssr on #${id}`, () => {
      const src = read(client);
      assert.match(src, new RegExp(`getElementById\\('${id}'\\)`));
      assert.match(src, /dataset\.ssr === '1'/, `${client} must honour the SSR flag`);
    });

    it(`worker/index.js sets data-ssr on #${id}`, () => {
      const setter = new RegExp(`id="${id}"[^']*data-ssr="1"`);
      assert.match(WORKER, setter, `nothing in the Worker marks #${id} as server-rendered`);
    });
  }
});
