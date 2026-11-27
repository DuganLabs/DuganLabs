/**
 * Client entry point. Composes deps, mounts the shell, kicks off the
 * initial session check.
 */

// @basenative/components stylesheets. `layers.css` declares the cascade-layer
// order and must come first. The package's `reset.css` and `theme.css` are
// deliberately not imported: the platform ships its own reset (styles/tokens.ts)
// and a single light palette — `theme.css` would flip the components to the
// dark palette on OS dark mode while the rest of the app stayed light. The
// `:root` bridge in styles/tokens.ts re-points every `--bn-*` token at the
// `--gp-*` palette (unlayered, so it wins over the package's `@layer tokens`).
import '@basenative/components/layers.css';
import '@basenative/components/tokens.css';
import '@basenative/components/components.css';
import '@basenative/components/states.css';
import { initPlatform } from '@basenative/platform';
import { adoptDesignTokens } from './styles/tokens.js';
import { createDeps } from './deps.js';
import { renderShell } from './shell/shell.js';

function bootstrap(): void {
  const root = document.documentElement;
  if (!root.hasAttribute('data-bn-platform')) {
    root.setAttribute('data-bn-platform', 'ios');
  }
  initPlatform(root);
  adoptDesignTokens();
  const target = document.querySelector('[data-bn-app]');
  if (!target) {
    throw new Error('Missing <div data-bn-app> in index.html');
  }

  const deps = createDeps();
  const shell = renderShell(deps);
  target.replaceWith(shell.element);

  // Kick off a session check so the first navigation has a hydrated auth
  // state. The router guard awaits this if it fires first.
  void deps.auth.checkSession();

  // If the URL is '/', let the router pick it up and the placeholder route
  // redirects to /dashboard.
  if (window.location.pathname === '/') {
    void deps.router.navigate('/dashboard', { replace: true });
  } else {
    // Re-fire navigation so the guard pipeline runs against the initial URL.
    void deps.router.navigate(
      window.location.pathname + window.location.search,
      { replace: true },
    );
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
