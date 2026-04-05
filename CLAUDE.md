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
