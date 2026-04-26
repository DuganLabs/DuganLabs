# ADR 0001 — BaseNative is the source of truth for shared code patterns

- Status: **accepted**
- Date: 2026-04-26
- Owner: Warren Dugan

## Context

DuganLabs runs ~9 projects across two visibility tiers (open-source, proprietary). Without a discipline, every project re-rolls its own auth, OG image rendering, lint config, tsconfig, deploy workflow, and so on. That's how organizations rot.

We need a single home for the patterns we want every project to follow.

Two candidates:
1. **`DuganLabs/duganlabs`** — current org meta repo, mostly markdown
2. **`DuganLabs/basenative`** — open-source web runtime + library, already has 30+ packages

## Decision

**`DuganLabs/basenative` is the source of truth for shared code, runtime primitives, configs, CLIs, and Claude Code agents/skills.**

It's open-source, so the org gets free Actions / Packages / hosting. It's already structured as a pnpm + Nx monorepo with publishable packages. Every DuganLabs project — open or proprietary — consumes from it.

## Consequences

- New shared concerns go into BaseNative first, then get adopted by consumers.
- Proprietary projects can extend BaseNative configs without leaking business logic into the OSS layer (boundary rule documented in [PROJECT-BOUNDARIES.md](../PROJECT-BOUNDARIES.md)).
- `duganlabs` (this repo) narrows to: ADRs, org-level docs, cross-project audits, and infra runbooks.
- `DuganLabs/.github` (separate) holds reusable GitHub Actions workflows + issue templates.

## Alternatives considered

- **Promote `duganlabs` itself to host code patterns.** Rejected — it's a docs repo by nature, and BaseNative already has the pnpm + Nx + Changesets infra in place.
- **Per-project copy-paste.** Rejected obvious: every project drift becomes silent.

## Related

- [ADR 0002 — `.github` is the source of truth for org GitHub infrastructure](0002-dot-github-is-source-of-truth-for-org-infra.md)
- [ADR 0003 — Apache-2.0 for OSS, proprietary for the rest](0003-licensing.md)
