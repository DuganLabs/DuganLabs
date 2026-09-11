/**
 * Vendored from @basenative/marketplace 0.2.2
 * (DuganLabs/BaseNative → packages/marketplace/src/card.js).
 *
 * Vendored rather than installed for the same reason as
 * vendor/basenative/runtime/signals.js: this repo has no build step, so it
 * copies BaseNative source in and imports it as a plain ES module.
 *
 * /ecosystem previously hand-copied this renderer into TWO places —
 * pages/js/ecosystem.js and worker/index.js — which is how the client tree
 * and the SSR tree drift apart. Both now import this one module.
 *
 * Deliberate differences from upstream, both of which should be sent back:
 *
 *  1. `headingLevel` option. Upstream hardcodes <h4> for the package name.
 *     On a page whose own heading is the <h1>, that skips two levels and
 *     leaves the document outline H1 → H4. The data-bn markup contract is
 *     unchanged — data-bn="pkg-name" is what the CSS and every consumer
 *     target — and the default is 4, so upstream behaviour is byte-identical
 *     when the option is omitted.
 *
 *  2. packageCardStyles() is not vendored. Its rules live in
 *     pages/css/components.css instead (transcribed verbatim, with two
 *     marked patches), so they are cached with the other stylesheets rather
 *     than injected into a <style> block on every page view.
 */

/**
 * Renders a marketplace package card as an HTML string.
 * Works on both server (SSR) and client via @basenative/components convention.
 *
 * @param {object} pkg - Package data
 * @param {string} pkg.name - Package name (e.g., "@basenative/runtime")
 * @param {string} [pkg.description] - Short description
 * @param {string} [pkg.version] - Latest version
 * @param {string} [pkg.author] - Author name
 * @param {string} [pkg.category] - Package category
 * @param {string[]} [pkg.tags] - Tags
 * @param {number} [pkg.downloads] - Download count
 * @param {string} [pkg.updatedAt] - ISO timestamp
 * @param {string} [pkg.repo] - Repository URL
 * @param {object} [options]
 * @param {number} [options.headingLevel=4] - Heading level for the package name (1-6)
 * @returns {string} HTML string
 */
export function renderPackageCard(pkg, options = {}) {
  const {
    name,
    description = '',
    version = '',
    author = '',
    category = '',
    tags = [],
    downloads = 0,
    updatedAt = '',
    repo = '',
  } = pkg;

  const level = clampHeadingLevel(options.headingLevel);
  const h = `h${level}`;

  const tagsHtml = tags.length > 0
    ? `<div data-bn="pkg-tags">${tags.map(t => `<span data-bn="pkg-tag">${esc(t)}</span>`).join('')}</div>`
    : '';

  const statsHtml = `<div data-bn="pkg-stats">
    ${downloads > 0 ? `<span data-bn="pkg-stat">${formatDownloads(downloads)} downloads</span>` : ''}
    ${version ? `<span data-bn="pkg-stat">v${esc(version)}</span>` : ''}
    ${updatedAt ? `<span data-bn="pkg-stat">${relativeTime(updatedAt)}</span>` : ''}
  </div>`;

  const linkAttr = repo ? ` href="${esc(repo)}" target="_blank" rel="noopener"` : '';

  return `<article data-bn="pkg-card">
  <div data-bn="pkg-header">
    <${h} data-bn="pkg-name">${repo ? `<a${linkAttr}>${esc(name)}</a>` : esc(name)}</${h}>
    ${category ? `<span data-bn="pkg-category">${esc(category)}</span>` : ''}
  </div>
  ${description ? `<p data-bn="pkg-desc">${esc(description)}</p>` : ''}
  ${tagsHtml}
  ${statsHtml}
  ${author ? `<div data-bn="pkg-author">${esc(author)}</div>` : ''}
</article>`;
}

function clampHeadingLevel(level) {
  const n = Number(level);
  if (!Number.isInteger(n) || n < 1 || n > 6) return 4;
  return n;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDownloads(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

function relativeTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
