# Blog System Setup

The DuganLabs site now includes a full blog engine powered by the `@basenative/markdown` package. Here's how to get started.

## Architecture

The blog system consists of:

1. **Worker API Endpoints** (`worker/index.js`):
   - `GET /api/posts` — List all blog posts with metadata
   - `GET /api/posts/:slug` — Get full post with parsed HTML
   - `POST /api/posts` — Create/update a post (for testing)
   - `DELETE /api/posts/:slug` — Delete a post

2. **Blog Storage** (Cloudflare KV):
   - `BLOG` namespace stores raw markdown posts
   - `posts:index` key maintains metadata for listing
   - `post:{slug}` keys store individual posts

3. **Sample Posts** (`worker/posts/`):
   - `basenative-launch.md` — BaseNative announcement
   - `ecosystem-update-q2.md` — Q2 roadmap update
   - `duganlabs-mission.md` — DuganLabs mission statement

## Setup

### 1. Understand the Markdown Parser

The `@basenative/markdown` module is bundled at `worker/vendor/basenative/markdown/markdown.js`. It provides:

```javascript
import { parse, parseFrontmatter } from './vendor/basenative/markdown/markdown.js';

// Parse markdown to HTML
const html = parse('# Hello\n\nThis is **bold**.'); 
// → '<h1 id="hello">Hello</h1>\n<p>This is <strong>bold</strong>.</p>'

// Extract frontmatter + content
const { meta, content } = parseFrontmatter(rawMarkdown);
// meta: { title: '...', slug: '...', ... }
// content: '<markdown body without frontmatter>'
```

### 2. Create a Sample Post

Add a new `.md` file to `worker/posts/`:

```markdown
---
title: My Blog Post
slug: my-blog-post
date: 2026-04-27
tags: [baseative, tutorial]
excerpt: A brief description of the post.
---

## Introduction

Start writing your content here...

### Features

- Item 1
- Item 2
```

### 3. Seed the KV Store

To populate the blog with sample posts:

```bash
cd worker
wrangler execute seed-blog.js --env production  # or --env preview
```

This reads all `.md` files from `worker/posts/`, parses them, and stores them in KV.

### 4. Test the API

```bash
# List all posts
curl http://localhost:8787/api/posts

# Get a single post
curl http://localhost:8787/api/posts/basenative-launch

# Create a new post (JSON)
curl -X POST http://localhost:8787/api/posts \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "test-post",
    "content": "---\ntitle: Test Post\ndate: 2026-04-27\n---\n\n# Test\n\nThis is a test."
  }'
```

## How It Works

### Request Flow: GET /api/posts

1. Worker receives request at `/api/posts`
2. Router calls the `router.get('/api/posts')` handler
3. Handler retrieves `posts:index` from KV
4. Index is sorted by date (newest first)
5. JSON response is returned with metadata

### Request Flow: GET /api/posts/:slug

1. Worker receives request at `/api/posts/:slug`
2. Router extracts `slug` parameter
3. Handler retrieves `post:{slug}` from KV
4. Handler calls `parseFrontmatter()` to extract metadata
5. Handler calls `parse()` to convert markdown to HTML
6. JSON response is returned with full post data

### Post Structure

Raw post in KV:
```
---
title: Introducing BaseNative
slug: basenative-launch
date: 2026-04-15
tags: [basenative, ecosystem, announcement]
excerpt: We're excited...
---

## A Fresh Approach...
```

Response object:
```json
{
  "slug": "basenative-launch",
  "title": "Introducing BaseNative",
  "date": "2026-04-15",
  "tags": ["basenative", "ecosystem", "announcement"],
  "excerpt": "We're excited...",
  "html": "<h2 id=\"a-fresh-approach\">A Fresh Approach...</h2>"
}
```

## Frontmatter Parsing

The worker extends `parseFrontmatter` with bracket-array support:

```javascript
function parseBlogFrontmatter(raw) {
  const { meta, content } = parseFrontmatter(raw);
  // Parse bracketed array values (e.g., tags: [a, b, c])
  for (const [key, val] of Object.entries(meta)) {
    if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  return { meta, content };
}
```

This allows posts to use YAML-array syntax for tags:
```yaml
tags: [basenative, ecosystem, announcement]
```

## Frontend Integration (Task C)

To render the blog on the frontend, you'll need:

1. A new `/blog` route in the SPA
2. A new `/blog/:slug` route for individual posts
3. JavaScript to fetch from `/api/posts` and `/api/posts/:slug`
4. HTML templates to render the post list and individual posts

See `CLAUDE.md` Epic 1 Task C for details.

## Markdown Features

The parser supports:

- **Headings** — `# H1`, `## H2`, etc. (auto-slugified ID)
- **Bold/Italic** — `**bold**`, `*italic*`, `***both***`
- **Code** — Inline `` `code` `` and fenced blocks
- **Lists** — Ordered `1.` and unordered `- `
- **Links** — `[text](href)`
- **Images** — `![alt](src)`
- **Blockquotes** — `> quoted text`
- **HR** — `---` or `***`
- **Line breaks** — Two spaces + newline or `\n`

All HTML is automatically escaped for security.
