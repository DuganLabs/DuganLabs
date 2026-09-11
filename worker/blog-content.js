// Blog content parsing, shared by the request path (worker/index.js) and the
// KV seeder (worker/seed-blog.js).
//
// It lives here rather than in index.js because the seeder had its own copy
// of the frontmatter handling and the copy was wrong: it called
// @basenative/markdown's parseFrontmatter directly and then did
// `meta.tags.split(',')` on a value that is still the literal string
// "[basenative, ecosystem]" at that point, so every seeded post got a first
// tag of "[basenative" and a last tag of "ecosystem]".
import { parseFrontmatter } from '@basenative/markdown';

/**
 * @basenative/markdown's parseFrontmatter, extended with array support so
 * `tags: [a, b, c]` comes back as an array instead of that string.
 */
export function parseBlogFrontmatter(raw) {
  const { meta, content } = parseFrontmatter(raw);
  for (const [key, val] of Object.entries(meta)) {
    if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
    }
  }
  return { meta, content };
}

/** Words per minute. 200 is the low end of adult silent reading for prose. */
const WPM = 200;

/**
 * Minutes to read a markdown body, rounded up and never below 1 for a post
 * that has any words at all. An empty body returns 0, which is what the
 * views treat as "no reading time to show" — so a post whose body failed to
 * load renders without the chip rather than with "0 min read".
 *
 * Markdown punctuation is stripped first so `**bold**` and `[text](href)`
 * count as the words a reader sees; fenced code is dropped entirely rather
 * than counted as prose.
 */
export function readingMinutes(markdown) {
  const text = String(markdown ?? '')
    .replace(/^---\n[\s\S]*?\n---\n/, '')      // frontmatter, if still attached
    .replace(/```[\s\S]*?```/g, ' ')            // fenced code blocks
    .replace(/`[^`]*`/g, ' ')                   // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')      // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')    // links keep their text
    .replace(/[#>*_~\-|]/g, ' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  if (!words) return 0;
  return Math.max(1, Math.ceil(words / WPM));
}

/**
 * The index entry for a post. One definition, so a post created through
 * POST /api/posts and a post written by the seeder carry the same fields —
 * including `minutes`, which /blog renders per card.
 *
 * The slug is the caller's, never the frontmatter's: it is the key the post
 * body was written under, and an index entry naming a key that does not
 * exist is a 404 with a link pointing at it.
 */
export function indexEntry(slug, raw) {
  const { meta, content } = parseBlogFrontmatter(raw);
  return {
    slug,
    title: meta.title || slug,
    date: meta.date || new Date().toISOString().split('T')[0],
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    excerpt: meta.excerpt || content.slice(0, 160).replace(/\n/g, ' '),
    minutes: readingMinutes(content),
  };
}
