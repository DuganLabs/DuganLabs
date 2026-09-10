import { signal, effect } from './signals.js';

// The worker server-renders the post into #post-article before it ever
// reaches the browser (see worker/index.js renderPostPage). When that
// happened, the article carries data-ssr="1" and already has the real
// title/description/canonical/OG tags and rendered body, so there's
// nothing left for the client to fetch or render — doing so anyway would
// just flash "Loading post..." over content that's already there. Only
// fall back to the client-side fetch when the page was served without
// going through the worker's SSR path (e.g. `wrangler dev` hitting this
// page directly without the route match, or an SSR failure).
const articleEl = document.getElementById('post-article');
const isSSR = articleEl?.dataset.ssr === '1';

if (!isSSR) {
  const post = signal(null);
  const loading = signal(true);
  const errorMsg = signal('');

  const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const BASE = isDev ? 'http://localhost:8787/api' : '/api';

  const getSlug = () => {
    const path = location.pathname.replace(/\/$/, '');
    const parts = path.split('/');
    return parts[parts.length - 1];
  };

  const loadPost = async () => {
    const slug = getSlug();
    if (!slug) {
      errorMsg.set('No post slug in URL');
      loading.set(false);
      return;
    }
    try {
      const res = await fetch(`${BASE}/posts/${slug}`);
      if (!res.ok) {
        errorMsg.set(res.status === 404 ? 'Post not found.' : 'Failed to load post.');
        loading.set(false);
        return;
      }
      post.set(await res.json());
    } catch {
      errorMsg.set('Failed to load post.');
    } finally {
      loading.set(false);
    }
  };

  effect(() => {
    const article = document.getElementById('post-article');
    if (!article) return;

    if (loading()) {
      article.innerHTML = '<p>Loading post...</p>';
      return;
    }

    const err = errorMsg();
    if (err) {
      article.innerHTML = `<p>${err}</p><p><a href="/blog">&larr; Back to blog</a></p>`;
      return;
    }

    const p = post();
    if (!p) return;

    document.title = `${p.title} — DuganLabs`;
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = document.title;

    const canonical = document.getElementById('canonical-link');
    if (canonical) canonical.setAttribute('href', `https://duganlabs.com/blog/${p.slug}`);

    article.innerHTML = `
      <header style="margin-bottom:var(--space-6)">
        <p style="margin:0 0 var(--space-2)"><a href="/blog">&larr; Back to blog</a></p>
        <h2 style="margin:0 0 var(--space-2)">${p.title}</h2>
        ${p.date ? `<time style="color:var(--text-muted);font-size:var(--text-sm)">${p.date}</time>` : ''}
        ${p.tags?.length ? `<p style="margin:var(--space-1) 0 0;font-size:var(--text-sm);color:var(--text-secondary)">${p.tags.map(t => `#${t}`).join(' ')}</p>` : ''}
      </header>
      <div class="prose">${p.html}</div>
    `;
  });

  loadPost();
}

// Theme toggle + mobile nav are handled by /js/app.js, loaded alongside this
// script (see pages/blog-post.html).
