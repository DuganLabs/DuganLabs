import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { read } from './helpers/css.mjs';

function makeKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key, type) {
      if (!store.has(key)) return null;
      const val = store.get(key);
      return type === 'json' ? JSON.parse(val) : val;
    },
    async put(key, val) {
      store.set(key, String(val));
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

function makeAssets() {
  const pages = {
    '/blog.html': read('pages/blog.html'),
    '/blog-post.html': read('pages/blog-post.html'),
    '/ecosystem.html': read('pages/ecosystem.html'),
    '/404.html': read('pages/404.html'),
  };
  return {
    async fetch(req) {
      const p = new URL(req.url).pathname;
      const html = pages[p];
      if (!html) return new Response('Not found', { status: 404 });
      return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    },
  };
}

function makeEnv(overrides = {}) {
  return {
    BLOG: makeKv(),
    REGISTRY: makeKv(),
    ASSETS: makeAssets(),
    ...overrides,
  };
}

describe('duganlabs-private worker API access control & CORS', () => {
  it('fails closed (403) on POST /api/posts when Access config is missing', async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      new Request('https://private.duganlabs.com/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'test', content: '# Hi' }),
      }),
      env,
      {},
    );
    assert.equal(res.status, 403);
    assert.equal(env.BLOG.store.size, 0);
  });

  it('fails closed (403) on DELETE /api/posts/:slug when no Access JWT is supplied', async () => {
    const env = makeEnv({
      BLOG: makeKv({
        'post:keep': '---\ntitle: Keep\n---\nBody',
        'posts:index': JSON.stringify([{ slug: 'keep', title: 'Keep', date: '2026-01-01', minutes: 1 }]),
      }),
      ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
      ACCESS_AUD: 'aud-123',
      OWNER_EMAILS: 'owner@example.com',
    });
    const res = await worker.fetch(
      new Request('https://private.duganlabs.com/api/posts/keep', { method: 'DELETE' }),
      env,
      {},
    );
    assert.equal(res.status, 403);
    assert.equal(env.BLOG.store.has('post:keep'), true);
  });

  it('never honours DEV_ACCESS_EMAIL on non-localhost hostnames', async () => {
    const env = makeEnv({ DEV_ACCESS_EMAIL: 'dev@example.com' });
    const res = await worker.fetch(
      new Request('https://private.duganlabs.com/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'test', content: '# Hi' }),
      }),
      env,
      {},
    );
    assert.equal(res.status, 403);
    assert.equal(env.BLOG.store.size, 0);
  });

  it('allows POST and DELETE on localhost when DEV_ACCESS_EMAIL is set', async () => {
    const env = makeEnv({ DEV_ACCESS_EMAIL: 'dev@example.com' });
    const postRes = await worker.fetch(
      new Request('http://localhost/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'local-test', content: '---\ntitle: Local\n---\nHello' }),
      }),
      env,
      {},
    );
    assert.equal(postRes.status, 200);
    assert.equal(env.BLOG.store.has('post:local-test'), true);

    const delRes = await worker.fetch(
      new Request('http://localhost/api/posts/local-test', { method: 'DELETE' }),
      env,
      {},
    );
    assert.equal(delRes.status, 200);
    assert.equal(env.BLOG.store.has('post:local-test'), false);
  });

  it('does not emit wildcard Access-Control-Allow-Origin headers', async () => {
    const env = makeEnv();
    for (const url of [
      'https://private.duganlabs.com/api/health',
      'https://private.duganlabs.com/api/posts',
      'https://private.duganlabs.com/api/ecosystem',
    ]) {
      const res = await worker.fetch(
        new Request(url, { headers: { Origin: 'https://evil.example' } }),
        env,
        {},
      );
      assert.equal(res.headers.get('access-control-allow-origin'), null, url);
    }
  });
});

describe('duganlabs-private SSR $-pattern replacement safety', () => {
  it('preserves literal $&, $\', $` and $$ in blog post SSR without corrupting the shell', async () => {
    const tricky = "Price $$100 and JS pattern $& and $' and $` stay intact";
    const postMd = ['---', 'title: ' + tricky, 'excerpt: ' + tricky, 'date: 2026-11-26', '---', '', tricky, ''].join('\n');
    const env = makeEnv({
      BLOG: makeKv({
        'post:dollars': postMd,
        'posts:index': JSON.stringify([
          { slug: 'dollars', title: tricky, excerpt: tricky, date: '2026-11-26', tags: [], minutes: 1 },
        ]),
      }),
    });

    const postRes = await worker.fetch(new Request('https://private.duganlabs.com/blog/dollars'), env, {});
    assert.equal(postRes.status, 200);
    const postHtml = await postRes.text();
    assert.ok(postHtml.includes('Price $$100'), 'double dollar preserved');
    assert.ok(!postHtml.includes('<p id="post-loading">Loading post...</p>'), '$& did not re-inject placeholder');
    assert.equal(postHtml.match(/<!doctype html>/gi)?.length, 1, 'shell not duplicated');

    const blogRes = await worker.fetch(new Request('https://private.duganlabs.com/blog'), env, {});
    assert.equal(blogRes.status, 200);
    const blogHtml = await blogRes.text();
    assert.ok(!blogHtml.includes('<p id="posts-loading">Loading posts...</p>'), '$& did not re-inject blog placeholder');
    assert.equal(blogHtml.match(/<!doctype html>/gi)?.length, 1, 'blog shell not duplicated');
  });

  it('preserves literal $& and $\' in ecosystem SSR without corrupting the shell', async () => {
    const env = makeEnv({
      REGISTRY: makeKv({
        'packages:list': JSON.stringify([
          {
            name: '@basenative/test',
            description: "Regex $& and $' and $$ tokens",
            version: '1.0.0',
            category: 'core',
            tags: ['test'],
            downloads: 0,
            repo: 'https://github.com/DuganLabs/BaseNative',
          },
        ]),
      }),
    });
    const res = await worker.fetch(new Request('https://private.duganlabs.com/ecosystem'), env, {});
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Regex $&amp;'), '$& preserved');
    assert.ok(!html.includes('<p class="eco-empty">Loading packages...</p>'), '$& did not re-inject eco placeholder');
    assert.equal(html.match(/<!doctype html>/gi)?.length, 1, 'ecosystem shell not duplicated');
  });
});
