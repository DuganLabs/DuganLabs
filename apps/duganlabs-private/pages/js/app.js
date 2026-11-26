import { $ } from './dom.js';

// ─── Theme ─────────────────────────────────────────────────
// Note: initial theme set by inline script in <head> to prevent FOUC

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  // Set color-scheme on BOTH branches. The pre-paint script in each page's
  // <head> writes an inline color-scheme, and an inline style can only be
  // overridden by another inline style — so clearing it here by assigning the
  // new theme is what keeps UA-painted chrome (scrollbars, the <input
  // type="search"> clear affordance, native focus rings) in step with the
  // page. Setting it only on the way into light left color-scheme:light
  // stuck on a #0C0B09 page for the rest of the session.
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem('dl-theme', theme);
  const btn = $('#btn-theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? 'Light' : 'Dark';
}

// ─── Mobile nav ─────────────────────────────────────────────
// Below 640px (see pages/css/layout.css) #main-nav is hidden behind the
// hamburger button; toggle its .is-open class + aria-expanded, and close
// on Escape or on navigating away (link click).

function initMobileNav() {
  const toggle = $('#btn-nav-toggle');
  const nav = document.getElementById('main-nav');
  if (!toggle || !nav) return;

  const setOpen = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };

  toggle.addEventListener('click', () => {
    setOpen(!nav.classList.contains('is-open'));
  });

  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) {
      setOpen(false);
      toggle.focus();
    }
  });
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
    // In-page fragment (the skip link, any future anchor): let the browser
    // move focus and scroll. Navigating to url.pathname would drop the hash
    // and reload the page, which is exactly what a skip link must not do.
    if (url.hash && url.pathname === location.pathname) return;

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

  initMobileNav();
  enableViewTransitions();
});
