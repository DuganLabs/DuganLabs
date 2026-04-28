/**
 * Seed the BLOG KV namespace with sample posts.
 * Run with: wrangler execute worker/seed-blog.js
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { parseFrontmatter } from './vendor/basenative/markdown/markdown.js';

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
    const { meta, content } = parseFrontmatter(raw);
    const slug = meta.slug || filename.replace(/\.md$/, '');

    // Store raw post
    await env.BLOG.put(`post:${slug}`, raw);

    // Add to index
    index.push({
      slug,
      title: meta.title || slug,
      date: meta.date || new Date().toISOString().split('T')[0],
      tags: meta.tags ? meta.tags.split(',').map(s => s.trim()) : [],
      excerpt: meta.excerpt || content.slice(0, 160).replace(/\n/g, ' '),
    });
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
