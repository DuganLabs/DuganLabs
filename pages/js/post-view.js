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

/**
 * One entry in the /blog index.
 * The heading is an <h2>: the page's own <h1> is "Blog", and skipping to
 * <h3> would leave a hole in the outline.
 */
export function renderPostCard(post) {
  const tags = Array.isArray(post.tags) ? post.tags : [];
  return `
    <a href="/blog/${escapeHtml(post.slug)}" class="post-card">
      <h2 class="post-card-title">${escapeHtml(post.title)}</h2>
      ${post.date ? `<time class="post-card-date">${escapeHtml(post.date)}</time>` : ''}
      ${tags.length ? `<p class="post-card-tags">${tags.map(t => `#${escapeHtml(t)}`).join(' ')}</p>` : ''}
      ${post.excerpt ? `<p class="post-card-excerpt">${escapeHtml(post.excerpt)}</p>` : ''}
    </a>`;
}

/** The whole /blog list, including the empty state. */
export function renderPostsList(posts) {
  if (!posts.length) return '<p>No posts yet. Check back soon.</p>';
  return posts.map(renderPostCard).join('');
}

/**
 * The header of a single post at /blog/:slug — the post title is that page's
 * <h1>, so the rendered markdown body's own headings start below it.
 */
export function renderPostHeader(post) {
  const tags = Array.isArray(post.tags) ? post.tags : [];
  return `
    <header class="post-header">
      <p class="post-header-back"><a href="/blog">&larr; Back to blog</a></p>
      <h1 class="post-header-title">${escapeHtml(post.title)}</h1>
      ${post.date ? `<time class="post-header-date">${escapeHtml(post.date)}</time>` : ''}
      ${tags.length ? `<p class="post-header-tags">${tags.map(t => `#${escapeHtml(t)}`).join(' ')}</p>` : ''}
    </header>`;
}
