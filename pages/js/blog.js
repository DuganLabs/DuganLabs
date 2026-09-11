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

  const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  const BASE = isDev ? 'http://localhost:8787/api' : '/api';

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
      container.innerHTML = '<p>Loading posts...</p>';
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
