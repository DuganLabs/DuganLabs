# Blog Posts

This directory contains sample markdown blog posts for the DuganLabs blog.

## Format

Each post is a markdown file with YAML frontmatter:

```yaml
---
title: Post Title
slug: post-slug
date: YYYY-MM-DD
tags: [tag1, tag2, tag3]
excerpt: Brief description of the post
---

# Markdown Content

Your post content here...
```

## Fields

- **title** (required) — Post title for display
- **slug** (required) — URL-friendly identifier (lowercase, hyphens only)
- **date** (required) — Publication date (YYYY-MM-DD format)
- **tags** (optional) — Comma-separated list of tags
- **excerpt** (optional) — Brief summary. Auto-generated from content if omitted.

## Parsing

Posts are parsed at request time using `@basenative/markdown`:

- Frontmatter is extracted with `parseFrontmatter()`
- Content is converted to HTML with `parse()`
- Posts are stored in Cloudflare KV under `post:{slug}` keys
- A `posts:index` entry maintains metadata for all posts

## Seeding

To seed the KV store with sample posts:

```bash
wrangler execute worker/seed-blog.js
```

This will:
1. Read all `.md` files in this directory
2. Parse the frontmatter
3. Store each post and the index in KV
4. Return a JSON response with the seeded entries

## API Endpoints

- **GET /api/posts** — Returns array of all posts (sorted by date, newest first)
- **GET /api/posts/:slug** — Returns full post with parsed HTML content

### Example Response (GET /api/posts)

```json
[
  {
    "slug": "basenative-launch",
    "title": "Introducing BaseNative",
    "date": "2026-04-15",
    "tags": ["basenative", "ecosystem", "announcement"],
    "excerpt": "We're excited to announce the launch of BaseNative..."
  }
]
```

### Example Response (GET /api/posts/:slug)

```json
{
  "slug": "basenative-launch",
  "title": "Introducing BaseNative",
  "date": "2026-04-15",
  "tags": ["basenative", "ecosystem", "announcement"],
  "excerpt": "We're excited to announce the launch of BaseNative...",
  "html": "<h2>A Fresh Approach to Web Development</h2>..."
}
```
