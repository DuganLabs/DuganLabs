# CLAUDE.md — DuganLabs

## Identity

DuganLabs is the org portfolio site for Warren Dugan's projects. It showcases BaseNative, GreenPut, and PendingBusiness — linking to live sites and source repos.

## Constitution

1. **No build step** — Vanilla JS ES modules, plain CSS, static HTML. BaseNative for signals.
2. **No framework except BaseNative** — itty-router on the worker, BaseNative on the frontend.
3. **No CSS frameworks** — Custom properties + plain CSS only.
4. **Static pages, dynamic edges** — The pages are static HTML with no build
   step. The Worker that serves them also serves `/api/*` and reads two KV
   namespaces (`BLOG`, `REGISTRY`) for the blog and the package registry. There
   is still no relational database and no auth. This used to read "no database,
   no auth, no API", which the blog and the ecosystem page have contradicted
   since they shipped.
5. **Shared code comes from BaseNative** — anything a second DuganLabs product
   would also want is a published `@basenative/*` package consumed from GitHub
   Packages, not a file copied into `vendor/`. A vendored snapshot silently
   stops receiving fixes: `worker/vendor/basenative/markdown/` was a 270-line
   copy that had no table support, so every markdown table in a blog post
   rendered as raw pipe characters until it was replaced with the real
   `@basenative/markdown`. `pages/vendor/` is the one legitimate exception —
   the browser cannot install from a registry, and this repo has no build
   step.

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
│   │       ├── runtime/signals.js     # BaseNative signal primitives
│   │       └── marketplace/card.js    # package card renderer
│   ├── index.html         # Landing page (Projects)
│   ├── blog.html          # /blog
│   ├── blog-post.html     # /blog/:slug shell
│   └── ecosystem.html     # /ecosystem
└── worker/
    ├── index.js           # Worker — assets, /api/*, SSR into the page shells
    ├── blog-content.js    # frontmatter + post helpers (@basenative/markdown)
    ├── wrangler.toml      # Cloudflare config, KV bindings
    └── package.json       # @basenative/markdown, itty-router
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

### Epic 1: Dynamic Blog Engine — **shipped**

`@basenative/markdown` exists upstream and is consumed here as a real dependency
from GitHub Packages (`worker/package.json`). `GET /api/posts`,
`GET /api/posts/:slug`, `/blog` and `/blog/:slug` all work, server-rendered into
the page shells with a `data-ssr="1"` handshake so the client script leaves the
DOM alone.

Still open: `worker/seed-blog.js` cannot actually run. It calls `readFileSync`
inside a Worker, and the `wrangler execute` its docstring names is not a real
command. Posts are seeded through `POST /api/posts` in the meantime.

### Epic 2: Project Showcase Router Transitions
- **Task A**: Introduce animated view transitions utilizing the native View Transitions API on the main directory page, so navigating between projects feels seamless.

### Epic 3: Ecosystem — **shipped, and its brief was wrong**

`/ecosystem` exists. It is **not** "the official community marketplace directory
for BaseNative", and must not be turned back into one. The owner's words on
seeing that version: *"Dugan Labs ecosystem is also basically just another Base
Native page."*

It is a page about **the DuganLabs ecosystem** — the three layers (products →
shared packages → platform), what each product contributes, and the conventions
they share. The `@basenative/*` registry is one section near the bottom, served
from the `REGISTRY` KV namespace, not the subject of the page. `/` (Projects)
says what the products are; `/ecosystem` says how they are built and what they
share. Keep that distinction.

Still open here: nothing. Do not re-scaffold `@basenative/marketplace` — it
exists, and `pages/vendor/basenative/marketplace/card.js` consumes it.
