import { AutoRouter, cors, error } from 'itty-router';
import { parse, parseFrontmatter } from './vendor/basenative/markdown/markdown.js';

const { preflight, corsify } = cors({ origin: '*' });

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'",
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

router.get('/api/posts', async (request, env) => {
  const index = await env.BLOG.get('posts:index', 'json');
  if (!index) return [];
  return index.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
});

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
  { name: '@basenative/marketplace', description: 'Community component marketplace — registry client, installer, theme manager.', version: '1.0.0', category: 'ecosystem', tags: ['marketplace', 'registry', 'community'], downloads: 0, repo: 'https://github.com/DuganLabs/BaseNative' },
  { name: '@basenative/cli', description: 'Project scaffolding via `npx create-basenative` — templates, generators, dev server.', version: '1.0.0', category: 'tooling', tags: ['cli', 'scaffold', 'generator'], downloads: 0, repo: 'https://github.com/DuganLabs/BaseNative' },
];

router.get('/api/ecosystem', async (request, env) => {
  // Try KV first, fall back to defaults
  let packages = await env.REGISTRY.get('packages:list', 'json');
  if (!packages) {
    packages = DEFAULT_PACKAGES;
    await env.REGISTRY.put('packages:list', JSON.stringify(packages));
  }

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
  let packages = await env.REGISTRY.get('packages:list', 'json');
  if (!packages) packages = DEFAULT_PACKAGES;

  const categoryMap = {};
  for (const pkg of packages) {
    const cat = pkg.category || 'other';
    categoryMap[cat] = (categoryMap[cat] || 0) + 1;
  }

  return Object.entries(categoryMap)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
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

async function buildSitemap(env) {
  const staticUrls = [
    { loc: `${SITE_ORIGIN}/`, changefreq: 'weekly', priority: '1.0' },
    { loc: `${SITE_ORIGIN}/blog`, changefreq: 'weekly', priority: '0.9' },
    { loc: `${SITE_ORIGIN}/ecosystem`, changefreq: 'weekly', priority: '0.8' },
    { loc: `${SITE_ORIGIN}/compare`, changefreq: 'monthly', priority: '0.8' },
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

    // SPA routing: serve compare page
    if (url.pathname === '/compare' || url.pathname === '/compare/') {
      const comparePage = await env.ASSETS.fetch(new Request(new URL('/compare.html', url.origin), { headers: request.headers }));
      return withSecurityHeaders(comparePage);
    }

    // SPA routing: serve ecosystem page
    if (url.pathname === '/ecosystem' || url.pathname === '/ecosystem/') {
      const ecoPage = await env.ASSETS.fetch(new Request(new URL('/ecosystem.html', url.origin), { headers: request.headers }));
      return withSecurityHeaders(ecoPage);
    }

    // SPA routing: serve blog pages for /blog paths
    if (url.pathname === '/blog' || url.pathname === '/blog/') {
      const blogPage = await env.ASSETS.fetch(new Request(new URL('/blog.html', url.origin), { headers: request.headers }));
      return withSecurityHeaders(blogPage);
    }
    if (url.pathname.startsWith('/blog/')) {
      const postPage = await env.ASSETS.fetch(new Request(new URL('/blog-post.html', url.origin), { headers: request.headers }));
      return withSecurityHeaders(postPage);
    }

    // Everything else served from static assets with security headers
    const assetResponse = await env.ASSETS.fetch(new Request(request.url, { headers: request.headers }));
    return withSecurityHeaders(assetResponse);
  },
};
