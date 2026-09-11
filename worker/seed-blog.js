/**
 * Seed the BLOG KV namespace with sample posts.
 * Run with: wrangler execute worker/seed-blog.js
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
// The same entry builder the live POST /api/posts route uses. This file used
// to derive the index entry itself and got tags wrong — see the header of
// worker/blog-content.js.
import { indexEntry, parseBlogFrontmatter } from './blog-content.js';

const __dirname = join(fileURLToPath(import.meta.url), '..');

const POSTS = [
  'basenative-launch.md',
  'ecosystem-update-q2.md',
  'duganlabs-mission.md',
];

export async function seed(env) {
  const index = [];

  for (const filename of POSTS) {
    const filepath = join(__dirname, 'posts', filename);
    const raw = readFileSync(filepath, 'utf-8');
    const { meta } = parseBlogFrontmatter(raw);
    const entry = indexEntry(meta.slug || filename.replace(/\.md$/, ''), raw);

    // Store raw post
    await env.BLOG.put(`post:${entry.slug}`, raw);

    // Add to index
    index.push(entry);
  }

  // Store index
  await env.BLOG.put('posts:index', JSON.stringify(index));
  console.log(`Seeded ${index.length} blog posts`);
  return index;
}

// For direct execution
export default {
  async fetch(request, env, ctx) {
    try {
      const index = await seed(env);
      return new Response(JSON.stringify({ ok: true, index }, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: err.message }, null, 2), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
