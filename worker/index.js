import { AutoRouter, cors, error } from 'itty-router';
import { marked } from 'marked';

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

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, content: raw };
  const meta = {};
  for (const line of match[1].split('\n')) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let val = line.slice(sep + 1).trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    }
    meta[key] = val;
  }
  return { meta, content: match[2] };
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

  const { meta, content } = parseFrontmatter(raw);
  const html = marked.parse(content);
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

  const { meta } = parseFrontmatter(body.content);
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

// ─── Export ───────────────────────────────────────────────

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API routes go through the router
    if (url.pathname.startsWith('/api/')) {
      const response = await router.fetch(request, env, ctx);
      return withSecurityHeaders(response);
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
