import { signal, effect } from './signals.js';

const post = signal(null);
const loading = signal(true);
const errorMsg = signal('');

const isDev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const BASE = isDev ? 'http://localhost:8787/api' : '/api';

function getSlug() {
  const path = location.pathname.replace(/\/$/, '');
  const parts = path.split('/');
  return parts[parts.length - 1];
}

async function loadPost() {
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
}

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

// Theme toggle
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
