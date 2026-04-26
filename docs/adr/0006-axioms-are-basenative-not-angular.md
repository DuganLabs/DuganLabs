# ADR 0006 — The four axioms describe BaseNative, not Angular

- Status: **accepted**
- Date: 2026-04-26
- Owner: Warren Dugan
- Supersedes: clarifies §11 of `DUGANLABS_ORCHESTRATOR_SPEC.md`

## Context

`DUGANLABS_ORCHESTRATOR_SPEC.md` describes four axioms (§8) and a
"Standing Preferences" list (§11) that reference Angular constructs:
`@Component` decorators, `:host` blocks, `[ngStyle]`, "Trinity Standard"
as a single-file `.ts` with `template:`/`styles:` strings.

That language was load-bearing in a vacuum. In practice, **DuganLabs
projects do not use Angular.** t4bs is React 18 (migrating off);
PendingBusiness is vanilla TS + itty-router; BaseNative ships its own
signal-based runtime (basenative.com tagline: "Angular-inspired control
flow to native template elements" — *inspired by*, not *built on*).

We use BaseNative. Period.

## Decision

The four axioms apply to **BaseNative-pattern code** across all
DuganLabs projects. The orchestrator's `basenative-enforcer`
(`libs/dugan/basenative-enforcer`) interprets them in BaseNative terms,
not Angular terms.

### Axiom 1 — No namespace theater (BaseNative interpretation)

**Reject:** custom-element wrappers like `<bn-foo>` or `<my-component>`
when a semantic HTML host fits. Reject `<div>`/`<span>` where a semantic
element exists. Reject barrel files in app code.

**Allow:** `<section>`, `<article>`, `<nav>`, `<header>`, `<main>`,
`<aside>`, `<figure>`, `<dialog>`, `<details>`, `<form>`, `<output>`,
`<time>`, `<mark>`, etc., enhanced via BaseNative directives + signals.

**Implementation:** AST walk on `.html`, `.tsx`, `.jsx` and any inline
template strings. Whitelist of semantic tags. Reject with diagnostic
pointing to the closest semantic alternative.

### Axiom 2 — Zero inline style (unchanged in spirit)

**Reject:** `style="..."` attributes. Tailwind / Bootstrap utility
classes. CSS-in-JS frameworks (`styled-components`, `emotion`).
Inline style props in JSX/TSX (`style={{...}}`) except for layered
runtime values that genuinely cannot live in CSS.

**Allow:** CSS in `@layer` declarations. Custom properties for runtime
tokens. `:has()`, container queries, logical properties. Per-component
CSS files. The CSS-in-`const` pattern t4bs uses today (single CSS string
template) is acceptable as long as it composes via custom properties
and doesn't re-implement utility-class soup.

**Implementation:** template AST + stylesheet AST (PostCSS) + JSX prop
scan. Reject with the offending pattern and suggested rewrite.

### Axiom 3 — Hosts pass through layout (BaseNative interpretation)

**Reject (Angular shape):** `:host { display: block }` or any host
selector that wraps a component in its own box-model presence,
unless the component is explicitly a "rendered host."

**Reject (React/JSX shape):** wrapper `<div>` elements at the top of a
component that exist solely to host the component. The semantic host
should be the topmost element; if a component must wrap children, use
`<>...</>` (Fragment) to avoid the synthetic box.

**Allow:** explicit opt-out via component metadata or comment
(`/* basenative:rendered-host */`) where the host needs box-model
presence (a card, a modal frame, a button).

**Implementation:** stylesheet AST for `:host` patterns. JSX top-level
element scan for unnecessary wrapper `div`/`span`. Default-deny on
synthetic hosts without opt-out.

### Axiom 4 — Trinity Standard (BaseNative interpretation)

**Reject:** components split across multiple files purely for
file-organization aesthetics (`Foo.tsx` + `Foo.module.css` +
`Foo.types.ts` for a simple component). Components that
re-export their own internal helpers via barrel files.

**Allow:** single-file components — state, logic, template, styles
fused. Format depends on framework:
- **React/JSX:** component function + colocated CSS string template
  (the t4bs pattern in `src/App.jsx`).
- **BaseNative-runtime:** the convention `@basenative/components` ships
  (signal closures + JSX-ish or template strings + CSS tokens
  inline at the component head).
- **Vanilla TS / Workers:** the file *is* the component.

The discriminator is "would adding a co-edit make the change atomic?"
If yes (state + template + style change together), it's one file. If
the styles are genuinely shared and the template is only one consumer,
the styles can split.

**Implementation:** decorator/import scan. Look for sibling files
that import only one consumer. Suggest fusing.

## Standing preferences (§11) — BaseNative version

The full list, restated for the BaseNative stack:

- **pnpm only.** Never `npm`, never `yarn`. (For npm-only consumers
  like the current t4bs SPA, document the migration target —
  pnpm is the org default.)
- **Strict modern TypeScript.** `strict`,
  `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`. ESM. `node:` prefixes. `import type`
  for type-only imports.
- **Components:** semantic HTML hosts, BaseNative directives + signals
  for behavior. Zero `app-` / `bn-` / `my-` wrapper tags.
  Zero unnecessary `<div>`/`<span>`.
- **Modern CSS only.** `@layer`, container queries, `:has()`,
  logical properties, custom properties. No Tailwind. No Bootstrap.
  No CSS-in-JS framework.
- **Single-file components.** State + logic + template + styles fused
  per the Axiom 4 interpretation above.
- **Measurements concrete.** Timestamps in ms, budgets in cents,
  bandwidth in bytes. No "seconds-ish" / "dollars-ish".
- **Comments explain *why*, never *what*.**
- **Errors are typed.** Discriminated unions. No string-throwing.
- **No barrel files in app code.** Only at lib public boundaries.
- **Lead with sharp insights.** Direct conclusions, no hedging.

## Consequences

- The orchestrator's `basenative-enforcer` checks JSX/TSX, BaseNative
  templates, and vanilla TS — not just Angular `@Component` blocks.
- Wherever the spec says "Angular," read "BaseNative-pattern code in
  whichever framework the venture uses."
- The four axioms are framework-agnostic intent: semantic HTML +
  modern CSS + signal-driven behavior + single-file components.
- When BaseNative finalizes its own component conventions
  (Q2 2026 target), this ADR gets a clarifying revision pointing
  at those docs.

## Related

- ADR 0001 — BaseNative is source of truth for shared code patterns
- `basenative.com` — public face of the runtime
- `DUGANLABS_ORCHESTRATOR_SPEC.md` §8, §11 — original axiom statements
