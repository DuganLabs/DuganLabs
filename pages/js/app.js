import { $ } from './dom.js';

// ─── Theme ─────────────────────────────────────────────────
// Note: initial theme set by inline script in <head> to prevent FOUC

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('dl-theme', theme);
  const btn = $('#btn-theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? 'Light' : 'Dark';
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
});
