# Ecosystem Marketplace Setup

The DuganLabs site now includes a full marketplace registry for BaseNative packages — the official community directory serving as the centralized package discovery hub.

## Architecture

The ecosystem system consists of:

1. **Worker API Endpoints** (`worker/index.js`):
   - `GET /api/ecosystem` — List all packages with optional filtering
   - `GET /api/ecosystem/categories` — List all categories with package counts

2. **Ecosystem Storage** (Cloudflare KV):
   - `REGISTRY` namespace stores the package registry
   - `packages:list` key maintains the full catalog (JSON array)
   - Queries support filtering by category and search term

3. **Default Package Seed** (in `worker/index.js`):
   - 15 core and ecosystem packages pre-seeded
   - Includes runtime, server, routing, components, forms, auth, db, middleware, fetch, realtime, i18n, markdown, flags, marketplace, cli
   - Each package includes: name, description, version, category, tags, downloads, repo URL

## How It Works

### Request Flow: GET /api/ecosystem

1. Worker receives request at `/api/ecosystem`
2. Router attempts to retrieve `packages:list` from KV
3. If not in KV, uses `DEFAULT_PACKAGES` and seeds KV
4. Applies optional filters:
   - `?category={name}` — filter by category
   - `?q={search}` — search by name, description, or tags
5. Returns JSON: `{ packages: [...], total: N }`

### Request Flow: GET /api/ecosystem/categories

1. Worker retrieves `packages:list` from KV (or uses defaults)
2. Aggregates unique categories and counts packages per category
3. Returns array of `{ name, count }` objects sorted by count descending

### Package Structure

Each package object contains:

```json
{
  "name": "@basenative/runtime",
  "description": "Signal-based reactivity — signal(), computed(), effect(), hydrate(). ~120 lines, zero deps.",
  "version": "1.0.0",
  "category": "core",
  "tags": ["signals", "reactivity", "hydration"],
  "downloads": 0,
  "repo": "https://github.com/DuganLabs/BaseNative"
}
```

## Setup

### 1. Verify KV Configuration

The `wrangler.toml` includes a `REGISTRY` KV namespace binding:

```toml
[[kv_namespaces]]
binding = "REGISTRY"
id = "placeholder-registry"
preview_id = "placeholder-registry-preview"
```

Replace the placeholder IDs with real KV namespace IDs created via Wrangler.

### 2. Initialize the Ecosystem

The ecosystem automatically seeds with `DEFAULT_PACKAGES` on first API call:

```bash
# First request triggers seeding
curl http://localhost:8787/api/ecosystem
```

Or manually populate via:

```bash
# Write packages directly
wrangler kv:key put packages:list @packages.json --namespace-id=<REGISTRY_ID>
```

### 3. Test the API

```bash
# List all packages
curl http://localhost:8787/api/ecosystem

# Filter by category
curl "http://localhost:8787/api/ecosystem?category=core"

# Search packages
curl "http://localhost:8787/api/ecosystem?q=auth"

# Get categories
curl http://localhost:8787/api/ecosystem/categories
```

### 4. Frontend Integration

The frontend at `/ecosystem` is already configured:

- **HTML**: `pages/ecosystem.html` — Page structure with search, category filters, package grid
- **JavaScript**: `pages/js/ecosystem.js` — Data loading, filtering, rendering
- **Styling**: Inline CSS in HTML (no external stylesheet needed) using design tokens

No additional setup required; the page is ready to use.

## Categories

The 15 default packages are organized into these categories:

- **core** (3 packages) — Runtime, server, routing
- **ui** (1 package) — Components
- **forms** (1 package) — Form handling
- **auth** (1 package) — Authentication
- **data** (2 packages) — Database, fetch
- **server** (1 package) — Middleware
- **realtime** (1 package) — Real-time communication
- **i18n** (1 package) — Internationalization
- **content** (1 package) — Markdown parser
- **infra** (1 package) — Feature flags
- **ecosystem** (1 package) — Marketplace
- **tooling** (1 package) — CLI

## Frontend Integration Details

### ecosystem.html

The page includes:

- **Hero section** — Title and description
- **Search input** — Real-time filtering by name, description, or tags
- **Category pills** — Dynamically loaded filter buttons with counts
- **Package grid** — Responsive 3-column layout (mobile: 1 column)
- **Package cards** — Each card shows:
  - Package name (linked to repo)
  - Category badge
  - Description
  - Tag pills
  - Version number

### ecosystem.js

Provides:

- `loadPackages()` — Fetch filtered packages from API
- `loadCategories()` — Fetch and render category buttons
- `renderGrid()` — Render package cards
- `renderCard()` — Build individual package card HTML
- Event handling for search (debounced) and category filtering

### Styling

Uses CSS custom properties for theming:

- `--surface-2`, `--surface-3` — Card backgrounds
- `--border`, `--accent` — Card styling
- `--text-primary`, `--text-secondary`, `--text-muted` — Text colors
- Supports light/dark theme toggle via `data-theme` attribute

## Adding New Packages

To add a new package to the ecosystem:

1. **In development**: Add to `DEFAULT_PACKAGES` in `worker/index.js`:
   ```javascript
   { 
     name: '@basenative/newpkg', 
     description: 'What it does...', 
     version: '1.0.0', 
     category: 'category-name', 
     tags: ['tag1', 'tag2'], 
     downloads: 0, 
     repo: 'https://github.com/DuganLabs/BaseNative' 
   }
   ```

2. **In production**: Update via Wrangler KV:
   ```bash
   wrangler kv:key put packages:list @updated-packages.json --namespace-id=<REGISTRY_ID>
   ```

3. The frontend will automatically refresh on next page load.

## Advanced Features

### Search Implementation

The search feature uses substring matching on:
- Package name (case-insensitive)
- Description (case-insensitive)
- Tags (case-insensitive, any tag match)

Search is debounced to 300ms for performance.

### Category Filtering

Categories are dynamically generated from unique `category` values in packages. The category count is calculated in real-time.

### Responsive Design

The package grid uses CSS Grid with `minmax(20rem, 1fr)`:
- Desktop: 3+ columns
- Tablet: 2 columns
- Mobile: 1 column (via media query)

## Testing Checklist

- [ ] `GET /api/ecosystem` returns all 15 packages
- [ ] `GET /api/ecosystem?category=core` returns 3 packages
- [ ] `GET /api/ecosystem?q=signal` returns runtime package
- [ ] `GET /api/ecosystem/categories` returns all categories with counts
- [ ] `/ecosystem` page loads and displays package grid
- [ ] Search input filters packages in real-time
- [ ] Category buttons filter correctly
- [ ] Package cards link to correct repos
- [ ] Light/dark theme toggle works
- [ ] Mobile layout is responsive

## API Response Examples

### GET /api/ecosystem (all packages)

```json
{
  "packages": [
    { "name": "@basenative/runtime", ... },
    { "name": "@basenative/server", ... },
    ...
  ],
  "total": 15
}
```

### GET /api/ecosystem?category=core

```json
{
  "packages": [
    { "name": "@basenative/runtime", "category": "core", ... },
    { "name": "@basenative/server", "category": "core", ... },
    { "name": "@basenative/router", "category": "core", ... }
  ],
  "total": 3
}
```

### GET /api/ecosystem/categories

```json
[
  { "name": "core", "count": 3 },
  { "name": "data", "count": 2 },
  { "name": "ui", "count": 1 },
  ...
]
```

## Future Enhancements

Potential improvements for future iterations:

1. **Download metrics** — Track and display real download counts
2. **Rating system** — Community ratings and reviews
3. **Installation guides** — Per-package setup instructions
4. **Version history** — Show changelog and release notes
5. **Author profiles** — Link packages to author profiles
6. **Package filtering** — Advanced filters (license, compatibility, size)
7. **Trending** — Show trending packages based on activity
8. **Search ranking** — Improve relevance with weighted search

## Troubleshooting

**Problem**: `/api/ecosystem` returns empty list  
**Solution**: Check KV binding in wrangler.toml; ensure REGISTRY namespace is created with correct IDs.

**Problem**: Search not working  
**Solution**: Clear browser cache; search is case-insensitive substring matching.

**Problem**: Categories not loading  
**Solution**: Verify API endpoint `/api/ecosystem/categories` returns data; check browser console.

**Problem**: Page not serving  
**Solution**: Ensure worker routing includes `/ecosystem` path; check wrangler.toml assets configuration.
