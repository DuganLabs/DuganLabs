// The blog's view fragments — ONE copy, imported by both trees.
//
// These used to exist twice: pages/js/blog.js built the post card in the
// browser and worker/index.js built the same markup for SSR. The two copies
// had identical markup and identical inline styles but different escaping —
// the Worker wrapped all five interpolations in escapeXml(), the client
// wrapped none, so a post title containing markup executed in the browser on
// every non-SSR serve. Two renderers of the same thing cannot be kept in
// step by review; there is now only one.
//
// Everything here is presentation-free: the markup carries classes that
// pages/css/components.css declares rules for, and never a style attribute.
//
// Imported by pages/js/blog.js, pages/js/blog-post.js and worker/index.js.

/** Escape a value for interpolation into HTML text or an attribute value. */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `2026-04-15` → `15 Apr 2026`.
 *
 * Deliberately not Intl/toLocaleDateString: this runs in workerd for SSR and
 * in the visitor's browser for the client fallback, and those two do not
 * guarantee the same locale data. A fixed table is the only way the server
 * paint and the client re-render can be byte-identical. Anything that is not
 * an ISO date comes back unchanged rather than as "Invalid Date".
 */
export function formatDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!m) return String(iso ?? '');
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return String(iso);
  return `${Number(m[3])} ${month} ${m[1]}`;
}

/**
 * The date / reading-time line. Either half can be missing — a post written
 * before the index carried word counts has no `minutes` — so the row is only
 * emitted when there is something to put in it, rather than rendering an
 * empty element or a stray separator.
 *
 * The <time> carries the raw ISO value in `datetime` and the readable form
 * as its text: "2026-04-15" was previously printed at the reader verbatim,
 * and machines had no attribute to read at all.
 */
function metaHtml(post, className) {
  const parts = [];
  if (post.date) {
    parts.push(`<time class="meta-date" datetime="${escapeHtml(post.date)}">${escapeHtml(formatDate(post.date))}</time>`);
  }
  if (post.minutes > 0) {
    parts.push(`<span class="meta-reading">${escapeHtml(post.minutes)} min read</span>`);
  }
  if (!parts.length) return '';
  // aria-hidden on the separator: it is a visual divider, and a screen reader
  // announcing "middle dot" between the date and the reading time is noise.
  return `<p class="${className}">${parts.join('<span class="meta-sep" aria-hidden="true">&middot;</span>')}</p>`;
}

function tagsHtml(tags) {
  const list = Array.isArray(tags) ? tags.filter(Boolean) : [];
  if (!list.length) return '';
  return `<ul class="tag-list">${list
    .map((t) => `<li class="tag">${escapeHtml(t)}</li>`)
    .join('')}</ul>`;
}

/**
 * One entry in the /blog index.
 *
 * The card is an <article> whose title holds the only link, with the link
 * stretched over the whole card in CSS. A card that is itself one big <a>
 * gives a screen reader a link whose name is the title, the date, the
 * reading time, the excerpt and every tag run together; this way the link is
 * named "Introducing BaseNative" and the rest is read as the text it is,
 * while a pointer still gets the whole card as a target.
 *
 * The heading is an <h2>: the page's own <h1> is "Blog", and skipping to
 * <h3> would leave a hole in the outline.
 */
export function renderPostCard(post) {
  return `
    <li class="post-item">
      <article class="post-card">
        <h2 class="post-card-title"><a class="post-card-link" href="/blog/${escapeHtml(post.slug)}">${escapeHtml(post.title)}</a></h2>
        ${metaHtml(post, 'post-card-meta')}
        ${post.excerpt ? `<p class="post-card-excerpt">${escapeHtml(post.excerpt)}</p>` : ''}
        ${tagsHtml(post.tags)}
        <p class="post-card-cue" aria-hidden="true">Read post <span class="post-card-cue-arrow">&rarr;</span></p>
      </article>
    </li>`;
}

/**
 * The whole /blog list: how many posts there are, then the posts.
 *
 * The count lives inside this one fragment rather than in a second element
 * the Worker has to find and replace separately — one SSR marker cannot get
 * out of step with itself.
 */
export function renderPostsList(posts) {
  if (!posts.length) {
    return `
      <div class="empty-state">
        <h2 class="empty-state-title">No posts yet</h2>
        <p class="empty-state-body">Engineering notes land here as they are written. Until then, the ecosystem page is the shortest route to what DuganLabs is actually building.</p>
        <p class="empty-state-actions">
          <a class="button-link" href="/ecosystem">Browse the ecosystem</a>
          <a class="button-link" data-variant="quiet" href="https://github.com/DuganLabs">Source on GitHub</a>
        </p>
      </div>`;
  }
  return `
    <p class="post-count">${posts.length} post${posts.length === 1 ? '' : 's'}</p>
    <ul class="post-list">${posts.map(renderPostCard).join('')}
    </ul>`;
}

/**
 * The header of a single post at /blog/:slug — the post title is that page's
 * <h1>, so the rendered markdown body's own headings start below it.
 */
export function renderPostHeader(post) {
  return `
    <header class="post-header">
      <a class="back-link" href="/blog"><span class="back-link-arrow" aria-hidden="true">&larr;</span>All posts</a>
      <h1 class="post-header-title">${escapeHtml(post.title)}</h1>
      ${metaHtml(post, 'post-header-meta')}
      ${tagsHtml(post.tags)}
    </header>`;
}

/**
 * Newer / older post links under the article. The index is sorted
 * newest-first, so the entry before a post is the newer one — "previous" and
 * "next" are ambiguous about which end of that they mean, and a reader who
 * has just finished a post wants to know which way is which.
 *
 * Either side may be absent (the newest post has nothing newer); with both
 * absent nothing is rendered at all, so a one-post blog gets no empty bar.
 */
export function renderPostNav({ newer, older } = {}) {
  if (!newer && !older) return '';
  const link = (post, dir, label) => (post
    ? `<a class="post-nav-link" data-dir="${dir}" href="/blog/${escapeHtml(post.slug)}">
          <span class="post-nav-label"><span class="post-nav-arrow" aria-hidden="true">${dir === 'newer' ? '&larr;' : '&rarr;'}</span>${label}</span>
          <span class="post-nav-title">${escapeHtml(post.title)}</span>
        </a>`
    : '<span class="post-nav-blank" aria-hidden="true"></span>');
  return `
    <nav class="post-nav" aria-label="More posts">
      ${link(newer, 'newer', 'Newer post')}
      ${link(older, 'older', 'Older post')}
    </nav>`;
}

/**
 * The two neighbours of `slug` in a newest-first index. Shared so the Worker
 * (which has the index in hand) and the browser (which fetches it) cannot
 * disagree about which post is "newer".
 */
export function neighbours(index, slug) {
  const i = index.findIndex((p) => p.slug === slug);
  if (i < 0) return {};
  return { newer: index[i - 1] || null, older: index[i + 1] || null };
}
