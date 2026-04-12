import { signal, effect } from './signals.js';

const posts = signal([]);
const loading = signal(true);

const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const BASE = isDev ? 'http://localhost:8787/api' : '/api';

async function loadPosts() {
  try {
    const res = await fetch(`${BASE}/posts`);
    if (!res.ok) throw new Error('Failed to load posts');
    posts.set(await res.json());
  } catch {
    posts.set([]);
  } finally {
    loading.set(false);
  }
}

effect(() => {
  const container = document.getElementById('posts-list');
  if (!container) return;

  if (loading()) {
    container.innerHTML = '<p>Loading posts...</p>';
    return;
  }

  const list = posts();
  if (list.length === 0) {
    container.innerHTML = '<p>No posts yet. Check back soon.</p>';
    return;
  }

  container.innerHTML = list.map(p => `
    <a href="/blog/${p.slug}" class="post-card" style="display:block;text-decoration:none;color:inherit;padding:var(--space-4);border:1px solid var(--surface-3);border-radius:var(--radius-2);margin-bottom:var(--space-3);">
      <h3 style="margin:0 0 var(--space-1)">${p.title}</h3>
      ${p.date ? `<time style="color:var(--text-muted);font-size:var(--text-sm)">${p.date}</time>` : ''}
      ${p.tags?.length ? `<p style="margin:var(--space-1) 0 0;font-size:var(--text-sm);color:var(--text-secondary)">${p.tags.map(t => `#${t}`).join(' ')}</p>` : ''}
      ${p.excerpt ? `<p style="margin:var(--space-2) 0 0;color:var(--text-secondary)">${p.excerpt}</p>` : ''}
    </a>
  `).join('');
});

loadPosts();

// Theme toggle (shared with app.js pattern)
const btn = document.getElementById('btn-theme-toggle');
if (btn) {
  const update = () => {
    const current = document.documentElement.getAttribute('data-theme');
    btn.textContent = current === 'dark' ? 'Light' : 'Dark';
  };
  update();
  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.style.colorScheme = next;
    localStorage.setItem('dl-theme', next);
    update();
  });
}
