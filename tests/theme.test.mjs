// Theme switching writes an inline color-scheme on <html>, and an inline
// style can only be replaced by another inline style. Setting it on one
// branch only is what left color-scheme:light stuck on a dark page, so these
// tests assert the property: every path that changes the theme sets it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { read } from './helpers/css.mjs';

const PAGES = ['index.html', 'blog.html', 'blog-post.html', 'ecosystem.html', '404.html'];

describe('pre-paint theme script', () => {
  for (const page of PAGES) {
    const html = read('pages/' + page);

    it(`${page} sets data-theme before first paint`, () => {
      assert.match(html, /document\.documentElement\.setAttribute\('data-theme'/);
    });

    it(`${page} sets color-scheme unconditionally, not only for one theme`, () => {
      const script = html.match(/<script>([\s\S]*?)<\/script>/);
      assert.ok(script, `${page} has no pre-paint script`);
      const body = script[1];
      assert.match(body, /style\.colorScheme\s*=/, 'the pre-paint script must set color-scheme');
      assert.ok(
        !/if\s*\([^)]*\)\s*document\.documentElement\.style\.colorScheme/.test(body),
        'a conditional color-scheme leaves the other theme with a stale value',
      );
    });
  }
});

describe('applyTheme', () => {
  const app = read('pages/js/app.js');
  const applyTheme = app.match(/function applyTheme\([\s\S]*?\n\}/)[0];

  it('sets color-scheme from the theme rather than a literal', () => {
    const assignment = applyTheme.match(/style\.colorScheme\s*=\s*([^;]+);/);
    assert.ok(assignment, 'applyTheme must set documentElement.style.colorScheme');
    assert.ok(
      !/['"]/.test(assignment[1]),
      `applyTheme assigns a fixed value (${assignment[1].trim()}); it has to follow the theme`,
    );
  });

  it('keeps data-theme, color-scheme and storage in one place', () => {
    for (const expected of [/setAttribute\('data-theme'/, /localStorage\.setItem/]) {
      assert.match(applyTheme, expected);
    }
  });
});

describe('view transitions do not swallow in-page anchors', () => {
  it('same-page fragment links are left to the browser', () => {
    // Without this the skip link navigates to location.pathname, dropping the
    // fragment and reloading the page instead of moving focus.
    const app = read('pages/js/app.js');
    const handler = app.match(/function enableViewTransitions\(\)[\s\S]*?\n\}/)[0];
    assert.match(handler, /url\.hash/, 'the click handler must opt out of same-page fragments');
  });
});
