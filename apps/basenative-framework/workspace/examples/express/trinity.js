/**
 * Server-side access to the Holy Trinity catalog (@basenative/components).
 * The registry loads once at module scope; rendering is synchronous from
 * then on, so page.js keeps its synchronous assembly. Every component the
 * site renders — heroes, the shell, the footer, and (as pages migrate)
 * the content components — comes through here: the catalog is the one
 * source of site markup.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { render } from '@basenative/server';
import { loadRegistry, renderComponent, assembleStyles } from '../../packages/components/src/loader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../..');
const componentsDir = join(repoRoot, 'packages/components/src');

const registry = await loadRegistry();
const rawSiteCss = await assembleStyles(registry, [...registry.listComponents()]);

/** Minify a CSS string with esbuild (comments, whitespace, redundant syntax). */
export function minifyStylesheet(css) {
  return transformSync(css, { loader: 'css', minify: true }).code;
}

const minifiedTrinityCss = minifyStylesheet(rawSiteCss);

const SKIP_AND_SR_CSS = `
@layer components {
  [data-bn-skip-link] {
    position: absolute;
    inset-inline-start: -9999px;
    inset-block-start: -9999px;
    z-index: 10000;
    padding: var(--space-sm, 0.5rem) var(--space-md, 1rem);
    background: var(--color-tint, #e8920a);
    color: var(--color-text-on-tint, #0c0b09);
    font-weight: var(--font-weight-semibold, 600);
    text-decoration: none;
    border-radius: 0 0 var(--radius-sm, 0.25rem) 0;
  }
  [data-bn-skip-link]:focus {
    inset-inline-start: 0;
    inset-block-start: 0;
  }
  [data-bn-visually-hidden] {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
}
`;

let cachedBundleCss = null;

/**
 * The whole catalog as one minified sheet (tokens, then every component in
 * registry order), served at /bn-css/trinity.css.
 */
export function trinitySiteCss() {
  return minifiedTrinityCss;
}

/**
 * Swatch and radius-ladder rules for /docs's Design tokens section, derived
 * directly from tokens.css so they ride in the external /site.css bundle
 * instead of an inline <style> tag (strict style-src 'self' CSP).
 */
function docsTokenLadderCss() {
  const tokensCss = readFileSync(join(componentsDir, 'tokens.css'), 'utf8');
  const rootMatch = /:root\s*\{([^}]*)\}/.exec(tokensCss.replace(/\/\*[\s\S]*?\*\//g, ''));
  if (!rootMatch) return '';
  const names = [...rootMatch[1].matchAll(/(--(?:palette-system|size-radius)-[a-z0-9-]+)\s*:/g)].map(
    (m) => m[1],
  );
  const rules = names.map((name) =>
    name.startsWith('--palette-system-')
      ? `[data-bn-swatch="${name}"]{background:var(${name})}`
      : `[data-bn-radius="${name}"]{border-radius:var(${name});background:var(--color-tint)}`,
  );
  return `@layer components {\n${rules.join('\n')}\n}`;
}

/**
 * The single versioned, minified stylesheet linked by layout.html (/site.css):
 * layers, reset, the catalog sheet (tokens + all components including chrome),
 * self-hosted font faces (rewritten to /fonts/src/), site layout styles,
 * skip-link / visually-hidden utilities, and /docs token swatch/radius rules.
 * Collapses five blocking CSS requests and all inline <style> blocks into one
 * cached, strict-CSP-safe stylesheet.
 */
export function siteBundleCss() {
  if (cachedBundleCss) return cachedBundleCss;
  const layers = readFileSync(join(componentsDir, 'layers.css'), 'utf8');
  const reset = readFileSync(join(componentsDir, 'reset.css'), 'utf8');
  const fonts = readFileSync(join(repoRoot, 'packages/fonts/fonts.css'), 'utf8').replaceAll(
    "url('./src/",
    "url('/fonts/src/",
  );
  const siteStyles = readFileSync(join(__dirname, 'public/styles.css'), 'utf8');
  cachedBundleCss = minifyStylesheet(
    [layers, reset, rawSiteCss, fonts, siteStyles, SKIP_AND_SR_CSS, docsTokenLadderCss()].join('\n'),
  );
  return cachedBundleCss;
}

/** Render one catalog component to an HTML string. */
export function renderTrinity(name, props) {
  return renderComponent(registry, render, name, props).html;
}

/**
 * The chrome components' own sheets, concatenated in cascade order
 * (app-shell last: its frame rules win ties against the pieces it
 * composes).
 */
export function trinityChromeCss() {
  return ['hero', 'sidebar', 'app-bar', 'site-footer', 'app-shell']
    .map((name) => registry.getComponent(name).styles.trim())
    .join('\n');
}

/** Render one catalog component, returning the view model alongside the HTML. */
export function renderTrinityVm(name, props) {
  return renderComponent(registry, render, name, props);
}

/**
 * Every registered component with the facts the catalog pages present:
 * its root element, its registered variants, its template and sheet
 * (from the registry) and its logic file (read from the package — the
 * component is its three files, and the pages show all three).
 */
export function trinityComponentInfo() {
  return [...registry.listComponents()].map((name) => {
    const def = registry.getComponent(name);
    return {
      name,
      root: def.root,
      variants: registry.listVariants(name),
      template: readFileSync(join(componentsDir, name, 'index.html'), 'utf8'),
      styles: def.styles,
      source: readFileSync(join(componentsDir, name, 'index.js'), 'utf8'),
    };
  });
}
