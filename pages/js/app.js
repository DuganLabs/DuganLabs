import { $ } from './dom.js';

// ─── Theme ─────────────────────────────────────────────────
// Note: initial theme set by inline script in <head> to prevent FOUC

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('dl-theme', theme);
  const btn = $('#btn-theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? 'Light' : 'Dark';
}

// ─── View Transitions ─────────────────────────────────────
// Intercept same-origin link clicks and use the View Transitions
// API for smooth animated page navigation when supported.

function enableViewTransitions() {
  if (!document.startViewTransition) return;

  document.addEventListener('click', (e) => {
    const link = e.target.closest('a[href]');
    if (!link) return;
    const url = new URL(link.href, location.origin);
    if (url.origin !== location.origin) return;
    if (link.target === '_blank') return;
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;

    e.preventDefault();
    document.startViewTransition(() => {
      location.href = url.pathname;
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = $('#btn-theme-toggle');
  if (btn) {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    btn.textContent = current === 'dark' ? 'Light' : 'Dark';
    btn.addEventListener('click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(next);
    });
  }

  enableViewTransitions();
});
