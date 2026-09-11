import { AutoRouter, cors, error } from 'itty-router';
import { parse, parseFrontmatter } from './vendor/basenative/markdown/markdown.js';

const { preflight, corsify } = cors({ origin: '*' });

const SECURITY_HEADERS = {
  // script-src / connect-src additions allow Cloudflare Web Analytics, which the
  // zone auto-injects (https://static.cloudflareinsights.com/beacon.min.js) and
  // which posts metrics to https://cloudflareinsights.com. No nonce: 'unsafe-inline'
  // already permits inline scripts, so a nonce would need removing unsafe-inline and
  // threading a per-request nonce into every inline <script> across 5 HTML pages for
  // no net security gain while unsafe-inline remains — skipped, see PR body.
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://cloudflareinsights.com",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Branded 404: fetch the static 404 page from ASSETS and return it with a
// real 404 status, instead of letting the Assets binding's blank 404 (or a
// soft-200 "not found" shell) reach the client.
async function notFound(env, origin, requestHeaders) {
  const asset = await env.ASSETS.fetch(new Request(new URL('/404.html', origin), { headers: requestHeaders }));
  return new Response(asset.body, {
    status: 404,
    statusText: 'Not Found',
    headers: asset.headers,
  });
}

const router = AutoRouter({ before: [preflight], finally: [corsify] });

// ─── Health ───────────────────────────────────────────────

router.get('/api/health', () => ({ status: 'ok', service: 'duganlabs' }));

// ─── Blog API ─────────────────────────────────────────────

// Frontmatter: extends @basenative/markdown's parseFrontmatter with array support for tags
function parseBlogFrontmatter(raw) {
  const { meta, content } = parseFrontmatter(raw);
  // Parse bracketed array values (e.g., tags: [a, b, c])
  for (const [key, val] of Object.entries(meta)) {
    if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  return { meta, content };
}

async function getPostsIndex(env) {
  const index = await env.BLOG.get('posts:index', 'json');
  if (!index) return [];
  return index.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

router.get('/api/posts', async (request, env) => getPostsIndex(env));

router.get('/api/posts/:slug', async (request, env) => {
  const slug = request.params.slug;
  const raw = await env.BLOG.get(`post:${slug}`, 'text');
  if (!raw) return error(404, 'Post not found');

  const { meta, content } = parseBlogFrontmatter(raw);
  const html = parse(content);
  return {
    slug,
    title: meta.title || slug,
    date: meta.date || null,
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    excerpt: meta.excerpt || content.slice(0, 160).replace(/\n/g, ' '),
    html,
  };
});

router.post('/api/posts', async (request, env) => {
  const body = await request.json();
  if (!body.slug || !body.content) {
    return error(400, 'slug and content are required');
  }
  const slug = body.slug.replace(/[^a-z0-9-]/g, '');
  await env.BLOG.put(`post:${slug}`, body.content);

  const { meta } = parseBlogFrontmatter(body.content);
  const index = (await env.BLOG.get('posts:index', 'json')) || [];
  const existing = index.findIndex(p => p.slug === slug);
  const entry = {
    slug,
    title: meta.title || slug,
    date: meta.date || new Date().toISOString().split('T')[0],
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    excerpt: meta.excerpt || body.content.slice(0, 160).replace(/\n/g, ' '),
  };
  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.push(entry);
  }
  await env.BLOG.put('posts:index', JSON.stringify(index));
  return entry;
});

router.delete('/api/posts/:slug', async (request, env) => {
  const slug = request.params.slug;
  await env.BLOG.delete(`post:${slug}`);
  const index = (await env.BLOG.get('posts:index', 'json')) || [];
  const filtered = index.filter(p => p.slug !== slug);
  await env.BLOG.put('posts:index', JSON.stringify(filtered));
  return { ok: true };
});

// ─── Ecosystem / Marketplace Registry ─────────────────────

// Default packages seeded into KV — the BaseNative ecosystem
const DEFAULT_PACKAGES = [
  { name: '@basenative/runtime', description: 'Signal-based reactivity — signal(), computed(), effect(), hydrate(). ~120 lines, zero deps.', version: '1.0.0', category: 'core', tags: ['signals', 'reactivity', 'hydration'], downloads: 0, repo: 'https://github.com/DuganLabs/BaseNative' },
  { name: '@basenative/server', description: 'SSR engine — render(), renderToStream(), @if/@for/@switch directives, @defer streaming.', version: '1.0.0', category: 'core', tags: ['ssr', 'streaming', 'templates'], downloads: 0, repo: 'https://github.com/DuganLabs/BaseNative' },
  { name: '@basenative/router', description: 'SSR-aware path routing with view transitions and signal-based navigation state.', version: '1.0.0', category: 'core', tags: ['routing', 'spa', 'ssr'], downloads: 0, repo: 'https://github.com/DuganLabs/BaseNative' },
  { name: '@basenative/components', description: '15+ semantic UI components — buttons, forms, tables, dialogs, trees, virtual lists.', version: '1.0.0', category: 'ui', tags: ['components', 'ui', 'accessible'], downloads: 0, repo: 'https://github.com/DuganLabs/BaseNative' },
  { name: '@basenative/forms', description: 'Signal-based form state, field validation, schema adapters (Zod), multi-step wizards.', version: '1.0.0', category: 'forms', tags: ['forms', 'validation', 'wizard'], downloads: 0, repo: 'https://github.com/DuganLabs/BaseNative' },
  { name: '@basenative/auth', description: 'Session management, RBAC, password hashing, OAuth providers.', version: '1.0.0', category: 'auth', tags: ['auth', 'session', 'rbac'], downloads: 0, repo: 'https://github.com/DuganLabs/BaseNative' },
  { name: '@basenative/db', description: 'Query builder with SQLite, Postgres, and D1 adapters. Parameterized queries only.', version: '1.0.0', category: 'data', tags: ['database', 'sql', 'd1'], downloads: 0, repo: 'https://github.com/DuganLabs/BaseNative' },
  { name: '@basenative/middleware', description: 'Pipeline, CORS, rate-limit, CSRF protection, platform adapters.', version: '1.0.0', category: 'server', tags: ['middleware', 'cors', 'csrf'], downloads: 0, repo: 'https://github.com/DuganLabs/BaseNative' },
  { name: '@basenative/fetch', description: 'Signal-based resource fetching with cache, retry, and SSR preloading.', version: '1.0.0', category: 'data', tags: ['fetch', 'cache', 'signals'], downloads: 0, repo: 'https://github.com/DuganLabs/BaseNative' },
  { name: '@basenative/realtime', description: 'SSE + WebSocket + channel manager for real-time communication.', version: '1.0.0', category: 'realtime', tags: ['websocket', 'sse', 'realtime'], downloads: 0, repo: 'https://github.com/DuganLabs/BaseNative' },
  { name: '@basenative/i18n', description: 'ICU messages, locale detection, @t directive for template-level translation.', version: '1.0.0', category: 'i18n', tags: ['i18n', 'translation', 'locale'], downloads: 0, repo: 'https://github.com/DuganLabs/BaseNative' },
  { name: '@basenative/markdown', description: 'Zero-dep markdown parser — headings, lists, code blocks, tables, footnotes, frontmatter.', version: '1.0.0', category: 'content', tags: ['markdown', 'parser', 'content'], downloads: 0, repo: 'https://github.com/DuganLabs/BaseNative' },
  { name: '@basenative/flags', description: 'Feature flags with percentage rollouts via Cloudflare KV edge cache.', version: '1.0.0', category: 'infra', tags: ['feature-flags', 'edge', 'kv'], downloads: 0, repo: 'https://github.com/DuganLabs/BaseNative' },
  { name: '@basenative/marketplace', description: 'Component marketplace — registry client, installer, theme manager.', version: '1.0.0', category: 'ecosystem', tags: ['marketplace', 'registry', 'installer'], downloads: 0, repo: 'https://github.com/DuganLabs/BaseNative' },
  { name: '@basenative/cli', description: 'Project scaffolding via `npx create-basenative` — templates, generators, dev server.', version: '1.0.0', category: 'tooling', tags: ['cli', 'scaffold', 'generator'], downloads: 0, repo: 'https://github.com/DuganLabs/BaseNative' },
];

async function getPackages(env) {
  // Try KV first, fall back to defaults
  let packages = await env.REGISTRY.get('packages:list', 'json');
  if (!packages) {
    packages = DEFAULT_PACKAGES;
    await env.REGISTRY.put('packages:list', JSON.stringify(packages));
  }
  return packages;
}

function computeCategoryCounts(packages) {
  const categoryMap = {};
  for (const pkg of packages) {
    const cat = pkg.category || 'other';
    categoryMap[cat] = (categoryMap[cat] || 0) + 1;
  }
  return Object.entries(categoryMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
}

router.get('/api/ecosystem', async (request, env) => {
  const packages = await getPackages(env);

  const url = new URL(request.url);
  const category = url.searchParams.get('category');
  const q = url.searchParams.get('q')?.toLowerCase();

  let filtered = packages;
  if (category) {
    filtered = filtered.filter(p => p.category === category);
  }
  if (q) {
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  return { packages: filtered, total: filtered.length };
});

router.get('/api/ecosystem/categories', async (request, env) => {
  const packages = await getPackages(env);
  return computeCategoryCounts(packages);
});

// ─── Export ───────────────────────────────────────────────

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const SITE_ORIGIN = 'https://duganlabs.com';

/**
 * Where /compare went. The page asserts measurable facts about BaseNative's
 * source, so it now lives in that repository, where a build step derives each
 * number and fails if the page and the code disagree.
 */
const COMPARE_DESTINATION = 'https://basenative.com/compare';

async function buildSitemap(env) {
  // /compare is deliberately absent: it is a 301 to BaseNative now, and listing
  // a redirect in a sitemap asks crawlers to index a URL that is not canonical.
  const staticUrls = [
    { loc: `${SITE_ORIGIN}/`, changefreq: 'weekly', priority: '1.0' },
    { loc: `${SITE_ORIGIN}/blog`, changefreq: 'weekly', priority: '0.9' },
    { loc: `${SITE_ORIGIN}/ecosystem`, changefreq: 'weekly', priority: '0.8' },
  ];
  const posts = (await env.BLOG.get('posts:index', 'json')) || [];
  const postUrls = posts.map(p => ({
    loc: `${SITE_ORIGIN}/blog/${p.slug}`,
    lastmod: p.date || undefined,
    changefreq: 'monthly',
    priority: '0.7',
  }));
  const urls = [...staticUrls, ...postUrls];
  const body = urls.map(u => {
    const parts = [`    <loc>${escapeXml(u.loc)}</loc>`];
    if (u.lastmod) parts.push(`    <lastmod>${escapeXml(u.lastmod)}</lastmod>`);
    if (u.changefreq) parts.push(`    <changefreq>${u.changefreq}</changefreq>`);
    if (u.priority) parts.push(`    <priority>${u.priority}</priority>`);
    return `  <url>\n${parts.join('\n')}\n  </url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

// ─── SSR: render real content into the static shells ───────
// These mirror the markup the client-side pages/js/blog.js and
// pages/js/ecosystem.js build, so non-JS clients (and first paint
// for everyone) get the real content instead of "Loading…".

function renderPostCardHtml(p) {
  return `
    <a href="/blog/${escapeXml(p.slug)}" class="post-card" style="display:block;text-decoration:none;color:inherit;padding:var(--space-4);border:1px solid var(--surface-3);border-radius:var(--radius-2);margin-bottom:var(--space-3);">
      <h3 style="margin:0 0 var(--space-1)">${escapeXml(p.title)}</h3>
      ${p.date ? `<time style="color:var(--text-muted);font-size:var(--text-sm)">${escapeXml(p.date)}</time>` : ''}
      ${p.tags?.length ? `<p style="margin:var(--space-1) 0 0;font-size:var(--text-sm);color:var(--text-secondary)">${p.tags.map(t => `#${escapeXml(t)}`).join(' ')}</p>` : ''}
      ${p.excerpt ? `<p style="margin:var(--space-2) 0 0;color:var(--text-secondary)">${escapeXml(p.excerpt)}</p>` : ''}
    </a>`;
}

function renderPostsListHtml(posts) {
  if (!posts.length) return '<p>No posts yet. Check back soon.</p>';
  return posts.map(renderPostCardHtml).join('');
}

function renderPackageCardHtml(pkg) {
  const tags = (pkg.tags || []).map(t => `<span data-bn="pkg-tag">${escapeXml(t)}</span>`).join('');
  const repoLink = pkg.repo
    ? `<a href="${escapeXml(pkg.repo)}" target="_blank" rel="noopener">${escapeXml(pkg.name)}</a>`
    : escapeXml(pkg.name);
  return `<article data-bn="pkg-card">
  <div data-bn="pkg-header">
    <h4 data-bn="pkg-name">${repoLink}</h4>
    ${pkg.category ? `<span data-bn="pkg-category">${escapeXml(pkg.category)}</span>` : ''}
  </div>
  ${pkg.description ? `<p data-bn="pkg-desc">${escapeXml(pkg.description)}</p>` : ''}
  ${tags ? `<div data-bn="pkg-tags">${tags}</div>` : ''}
  <div data-bn="pkg-stats">
    ${pkg.version ? `<span>v${escapeXml(pkg.version)}</span>` : ''}
  </div>
</article>`;
}

function renderPackagesGridHtml(packages) {
  if (!packages.length) return '<p class="eco-empty">No packages found.</p>';
  return packages.map(renderPackageCardHtml).join('');
}

function renderCategoryButtonsHtml(categories) {
  return categories.map(cat =>
    `<button class="eco-cat-btn" aria-pressed="false" data-category="${escapeXml(cat.name)}">${escapeXml(cat.name)} (${cat.count})</button>`
  ).join('');
}

async function renderBlogPage(env, shellResponse) {
  const posts = await getPostsIndex(env);
  let html = await shellResponse.text();
  html = html
    .replace('<section id="posts-list" aria-label="blog posts">', '<section id="posts-list" aria-label="blog posts" data-ssr="1">')
    .replace('<p id="posts-loading">Loading posts...</p>', renderPostsListHtml(posts));
  const headers = new Headers(shellResponse.headers);
  headers.delete('content-length');
  return new Response(html, { status: shellResponse.status, headers });
}

async function renderEcosystemPage(env, shellResponse) {
  const packages = await getPackages(env);
  const categories = computeCategoryCounts(packages);
  let html = await shellResponse.text();
  html = html
    .replace('<section class="eco-grid" id="eco-grid" aria-label="Package listing">', '<section class="eco-grid" id="eco-grid" aria-label="Package listing" data-ssr="1">')
    .replace('<p class="eco-empty">Loading packages...</p>', renderPackagesGridHtml(packages))
    .replace(
      '<button class="eco-cat-btn" aria-pressed="true" data-category="">All</button>',
      `<button class="eco-cat-btn" aria-pressed="true" data-category="">All</button>${renderCategoryButtonsHtml(categories)}`
    )
    .replace(
      '<p class="eco-count" id="eco-count"></p>',
      `<p class="eco-count" id="eco-count">${packages.length} package${packages.length !== 1 ? 's' : ''}</p>`
    );
  const headers = new Headers(shellResponse.headers);
  headers.delete('content-length');
  return new Response(html, { status: shellResponse.status, headers });
}

// SSR a single post into the blog-post.html shell: swap in the real
// <title>, meta description, canonical link, Open Graph / Twitter tags,
// and the rendered article body — marking the article data-ssr="1" so
// pages/js/blog-post.js knows to leave the DOM alone (mirrors renderBlogPage
// / renderEcosystemPage above). Returns null when the slug doesn't exist so
// the caller can serve a real 404 instead of a 200 shell.
async function renderPostPage(env, slug, shellResponse) {
  const raw = await env.BLOG.get(`post:${slug}`, 'text');
  if (!raw) return null;

  const { meta, content } = parseBlogFrontmatter(raw);
  const title = meta.title || slug;
  const date = meta.date || null;
  const tags = Array.isArray(meta.tags) ? meta.tags : [];
  const description = meta.excerpt || content.slice(0, 160).replace(/\n/g, ' ');
  const html = parse(content);
  const pageTitle = `${title} — DuganLabs`;
  const url = `https://duganlabs.com/blog/${slug}`;

  const articleHtml = `
    <header style="margin-bottom:var(--space-6)">
      <p style="margin:0 0 var(--space-2)"><a href="/blog">&larr; Back to blog</a></p>
      <h2 style="margin:0 0 var(--space-2)">${escapeXml(title)}</h2>
      ${date ? `<time style="color:var(--text-muted);font-size:var(--text-sm)">${escapeXml(date)}</time>` : ''}
      ${tags.length ? `<p style="margin:var(--space-1) 0 0;font-size:var(--text-sm);color:var(--text-secondary)">${tags.map(t => `#${escapeXml(t)}`).join(' ')}</p>` : ''}
    </header>
    <div class="prose" data-ssr="1">${html}</div>`;

  let out = await shellResponse.text();
  out = out
    .replace('<title id="page-title">Post — DuganLabs</title>', `<title id="page-title">${escapeXml(pageTitle)}</title>`)
    .replace('<meta name="description" content="DuganLabs blog post">', `<meta name="description" content="${escapeXml(description)}">`)
    .replace('<link rel="canonical" id="canonical-link" href="https://duganlabs.com/blog">', `<link rel="canonical" id="canonical-link" href="${escapeXml(url)}">`)
    .replace('<meta property="og:title" id="og-title" content="Post — DuganLabs">', `<meta property="og:title" id="og-title" content="${escapeXml(pageTitle)}">`)
    .replace('<meta property="og:description" id="og-description" content="DuganLabs blog post">', `<meta property="og:description" id="og-description" content="${escapeXml(description)}">`)
    .replace('<meta property="og:url" id="og-url" content="https://duganlabs.com/blog">', `<meta property="og:url" id="og-url" content="${escapeXml(url)}">`)
    .replace('<meta name="twitter:title" id="twitter-title" content="Post — DuganLabs">', `<meta name="twitter:title" id="twitter-title" content="${escapeXml(pageTitle)}">`)
    .replace('<meta name="twitter:description" id="twitter-description" content="DuganLabs blog post">', `<meta name="twitter:description" id="twitter-description" content="${escapeXml(description)}">`)
    .replace('<article id="post-article">', '<article id="post-article" data-ssr="1">')
    .replace('<p id="post-loading">Loading post...</p>', articleHtml);

  const headers = new Headers(shellResponse.headers);
  headers.delete('content-length');
  return new Response(out, { status: 200, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Sitemap (dynamic — pulls blog posts from KV)
    if (url.pathname === '/sitemap.xml') {
      const xml = await buildSitemap(env);
      return withSecurityHeaders(new Response(xml, {
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': 'public, max-age=3600',
        },
      }));
    }

    // API routes go through the router
    if (url.pathname.startsWith('/api/')) {
      const response = await router.fetch(request, env, ctx);
      return withSecurityHeaders(response);
    }

    // The framework comparison moved to the BaseNative site. It makes measurable
    // claims about that repository's source — runtime size, dependency count,
    // API surface — and those are derived and CI-verified there, so they cannot
    // go stale the way they did while the page lived here. Permanent, so the
    // inbound links and bookmarks still pointing at this path transfer instead
    // of 404ing.
    if (url.pathname === '/compare' || url.pathname === '/compare/') {
      return withSecurityHeaders(
        Response.redirect(`${COMPARE_DESTINATION}${url.search}`, 301),
      );
    }

    // SSR: serve ecosystem page with the package grid rendered server-side
    if (url.pathname === '/ecosystem' || url.pathname === '/ecosystem/') {
      const ecoPage = await env.ASSETS.fetch(new Request(new URL('/ecosystem.html', url.origin), { headers: request.headers }));
      const rendered = await renderEcosystemPage(env, ecoPage);
      return withSecurityHeaders(rendered);
    }

    // SSR: serve blog index with the post list rendered server-side
    if (url.pathname === '/blog' || url.pathname === '/blog/') {
      const blogPage = await env.ASSETS.fetch(new Request(new URL('/blog.html', url.origin), { headers: request.headers }));
      const rendered = await renderBlogPage(env, blogPage);
      return withSecurityHeaders(rendered);
    }
    // SSR: serve a single blog post with its content rendered server-side.
    // A missing slug returns a real 404 (branded 404 page, HTTP 404) instead
    // of a 200 "Post not found." shell.
    if (url.pathname.startsWith('/blog/')) {
      const slug = url.pathname.replace(/^\/blog\//, '').replace(/\/$/, '');
      const postPage = await env.ASSETS.fetch(new Request(new URL('/blog-post.html', url.origin), { headers: request.headers }));
      const rendered = slug ? await renderPostPage(env, slug, postPage) : null;
      if (!rendered) {
        return withSecurityHeaders(await notFound(env, url.origin, request.headers));
      }
      return withSecurityHeaders(rendered);
    }

    // Everything else served from static assets with security headers.
    // A 404 from the Assets binding (unknown path) gets the branded 404
    // page instead of the binding's blank fallback.
    const assetResponse = await env.ASSETS.fetch(new Request(request.url, { headers: request.headers }));
    if (assetResponse.status === 404) {
      return withSecurityHeaders(await notFound(env, url.origin, request.headers));
    }
    return withSecurityHeaders(assetResponse);
  },
};
