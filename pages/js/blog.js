import { signal, effect } from './signals.js';
import { renderPostsList } from './post-view.js';

// The worker server-renders the post list into #posts-list before it ever
// reaches the browser (see worker/index.js renderBlogPage). When that
// happened, the container carries data-ssr="1" and already has the real
// content, so there's nothing left for the client to fetch or render —
// doing so anyway would just flash "Loading posts..." over content that's
// already there. Only fall back to the client-side fetch when the page
// was served without going through the worker's SSR path.
const postsListEl = document.getElementById('posts-list');
const isSSR = postsListEl?.dataset.ssr === '1';

if (!isSSR) {
  const posts = signal([]);
  const loading = signal(true);

  // Same origin, always. The Worker serves these pages and /api/* from one
  // origin in every environment, `wrangler dev` included — the old
  // localhost:8787 special case pointed the dev fallback at a port nothing
  // listens on unless the worker happens to have been started there, so this
  // branch silently rendered "no posts" locally. pages/js/ecosystem.js never
  // had the special case.
  const BASE = '/api';

  const loadPosts = async () => {
    try {
      const res = await fetch(`${BASE}/posts`);
      if (!res.ok) throw new Error('Failed to load posts');
      posts.set(await res.json());
    } catch {
      posts.set([]);
    } finally {
      loading.set(false);
    }
  };

  effect(() => {
    const container = document.getElementById('posts-list');
    if (!container) return;

    if (loading()) {
      container.innerHTML = '<p class="post-loading">Loading posts...</p>';
      return;
    }

    // Same renderer the Worker uses for SSR (pages/js/post-view.js), so the
    // two trees cannot disagree about markup or about escaping.
    container.innerHTML = renderPostsList(posts());
  });

  loadPosts();
}

// Theme toggle + mobile nav are handled by /js/app.js, loaded alongside this
// script (see pages/blog.html).
