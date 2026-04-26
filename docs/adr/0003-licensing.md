# ADR 0003 — Licensing: Apache-2.0 for OSS, proprietary for the rest

- Status: **accepted**
- Date: 2026-04-26
- Owner: Warren Dugan

## Decision

| Tier | Repos | License |
|---|---|---|
| **Open-source** | `basenative`, `t4bs`, `DuganLabs/.github`, `duganlabs` (this) | Apache-2.0 |
| **Proprietary (private today)** | `greenput`, `pendingbusiness`, `warrendugan`, `warren-sys`, `ralph-station` | All rights reserved |
| **OSS-eventual** | `pendingbusiness` (planned) | Apache-2.0 once flipped |

## Why Apache-2.0

- Permissive for adopters (matters for BaseNative consumers)
- Patent grant clause covers us if someone tries to weaponize a contribution
- Compatible with most downstream license tiers
- Industry standard; minimal friction

## Why not MIT

MIT works fine for small libraries. Apache-2.0 is preferred when there's any patent surface (anything generating UI / runtime / reusable agents) — the express patent grant is worth the slightly more verbose header.

## Why not GPL/AGPL

We want adopters to use BaseNative without copyleft obligations bleeding into their products.

## Apply

- Each OSS repo has a `LICENSE` file at root with the canonical Apache-2.0 text.
- Each `package.json` declares `"license": "Apache-2.0"`.
- Source files don't need per-file SPDX headers (NOTICE not required for permissive); we document attribution in package READMEs.

## Boundary rule

No proprietary business logic from greenput / pendingbusiness / warrendugan / warren-sys / ralph-station / duganlabs lifts into BaseNative. Infra and primitives are fair game; domain logic is not. Before contributing back, run the proprietary check (see [PROJECT-BOUNDARIES.md](../PROJECT-BOUNDARIES.md)).
