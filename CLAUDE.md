# CLAUDE.md — DuganLabs

## Identity

DuganLabs is the org portfolio site for Warren Dugan's projects. It showcases BaseNative, GreenPut, and PendingBusiness — linking to live sites and source repos.

## Constitution

1. **No build step** — Vanilla JS ES modules, plain CSS, static HTML. BaseNative for signals.
2. **No framework except BaseNative** — itty-router on the worker, BaseNative on the frontend.
3. **No CSS frameworks** — Custom properties + plain CSS only.
4. **Static site only** — No database, no auth, no API. Just HTML served by a Worker.

## Workspace Structure

```
duganlabs/
├── pages/                  # Static frontend
│   ├── css/               # tokens.css, reset.css, base.css, layout.css, components.css, utilities.css
│   ├── js/                # ES module app + shared utilities
│   │   ├── signals.js     # Re-exports from vendor/basenative/runtime/signals.js
│   │   ├── dom.js         # DOM helpers using BaseNative signal API
│   │   └── app.js         # Theme toggle + nav
│   ├── vendor/
│   │   └── basenative/
│   │       └── runtime/signals.js   # BaseNative signal primitives
│   └── index.html         # Landing page
└── worker/
    ├── index.js           # Cloudflare Worker — static file serving + health endpoint
    ├── wrangler.toml      # Cloudflare config
    └── package.json       # Worker dependencies
```

## Infrastructure

Terraform (`infra/`, `.github/workflows/terraform.yml`) was retired 2026-09-10 — org-wide
decision, retired everywhere as a control plane. CI + `wrangler` are now the only source
of truth for provisioning. The R2 state bucket (`duganlabs-tf`) still exists but is no
longer used by anything in this repo; it's on the owner's cleanup list, not deleted by
this change.

- Worker `duganlabs` + routes `duganlabs.com/*`, `www.duganlabs.com/*` —
  `worker/wrangler.toml`.
- KV `duganlabs-blog` (binding `BLOG`) and `duganlabs-registry` (binding `REGISTRY`) —
  `worker/wrangler.toml`. The namespace IDs there are the ones Terraform originally
  created; CI only binds to them, it never creates or destroys a namespace.
- Apex/`www` DNS records for `duganlabs.com` (proxied A records) — previously
  Terraform-managed (`infra/dns.tf`, now deleted). They keep working because the
  Cloudflare-side record already exists, but nothing in this repo recreates them if
  they're ever removed.

## BaseNative Signal API

BaseNative signals use function-call syntax (not property access):

```javascript
const count = signal(0);
count();         // read — subscribes if inside effect()
count.set(1);    // write
count.peek();    // read without subscribing

const doubled = computed(() => count() * 2);
effect(() => console.log(count())); // auto re-runs on change
```

## Commit Convention

Conventional Commits. Co-Authored-By line on every commit:
```
Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```

## AI Execution Pipeline / Backlog

When executing autonomously, start pulling from this prioritized task list:

### Epic 1: Dynamic Blog Engine **[DOGFOODING REQUIRED]**
- **Task A**: Do **NOT** install `marked` or write bespoke logic. You must construct `@basenative/markdown` in the upstream `basenative` monorepo first.
- **Task B**: Once linked, utilize `@basenative/markdown` here to implement the `GET /api/posts` and `GET /api/posts/:slug` endpoints.
- **Task C**: Implement a new `/blog` and `/blog/:slug` route in the frontend using BaseNative's router pulling directly from your new package to render markdown safely.

### Epic 2: Project Showcase Router Transitions
- **Task A**: Introduce animated view transitions utilizing the native View Transitions API on the main directory page, so navigating between projects feels seamless.

### Epic 3: Ecosystem Marketplace Integration [Phase 3] **[DOGFOODING REQUIRED]**
- **Task A**: Pause. Go to the `basenative` monorepo and scaffold out `@basenative/marketplace` components, specifically a component card registry view.
- **Task B**: Construct a new `/ecosystem` route on DuganLabs serving as the official community marketplace directory for BaseNative.
- **Task C**: Implement a Cloudflare KV lookup on the worker backend to serve dynamic registry lists to the marketplace grid.
