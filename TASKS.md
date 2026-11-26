# TASKS.md — The single queue for Warren's agent fleet

One queue, not one per repo. This file is the control plane for the fleet.
Chief picks up tasks from here. Muse hands work to Chief through here.
Warren is the only approver.

## How this queue works

- Each task has an ID (T-###), a title, an owner, a status, and a description.
- Statuses: `todo` (not started), `doing` (in progress), `blocked` (needs Warren or something outside the fleet), `done` (finished and verified).
- When Chief finishes a task, Chief updates this file: mark it `done` and add a short note with what changed and the link or path to the result.
- When Chief starts a task, Chief marks it `doing` so Muse and Warren can see it.
- Tasks are worked top to bottom unless Warren says otherwise.
- **Approvals stay with Warren.** Merges to live sites, deploys, purchases, deleting things, and outgoing messages still need Warren's approval. No task here overrides that.

## The fleet

- **Chief** (Grok Bot / Grok CLI) — the fleet's main agent. Picks up tasks from this queue. Runs on its own computer; the Grok CLI is also installed on the Tower.
- **Muse** — Warren's personal agent. Hands work to Chief through this queue.
- **Tower** — Windows PC, NVIDIA RTX 5070 (12GB VRAM), 32GB RAM. On the private tailnet.
- **Mini** — Mac mini, Apple M2 Pro, 16GB RAM. On the private tailnet.
- **Muse VM** — Muse's own machine. On the private tailnet.

The private tailnet is the link between them. No public ports.

## Open tasks

### T-002 — Merge the fleet task list into this queue
- **Owner:** Chief
- **Status:** doing
- **Why:** The fleet list previously lived in `chief/fleet/TASKS.md` on the Tower. One queue, not one per repo. That list moves into this file.
- **Do this:**
  1. Read the Tower fleet list.
  2. Add every open item from it to this file as a new T-### task below, keeping the original wording and any status it already has.
  3. Leave the Tower file in place as a pointer to this file so nothing is lost and nothing is double-tracked.
- **Done when:** Every open item from the Tower fleet list is in this file, and the Tower file points here.
- **Note (2026-11-26):** This PR adds the migrated tasks. After the PR is opened, the Tower file is replaced with a pointer here. Mark `done` when this PR is merged.

### T-004 — Server gateway (home server)
- **Owner:** Chief
- **Status:** paused
- **Why:** The agent system calls for a gateway per device: Tower Gateway, Mini Gateway, Server Gateway. The home server is the third.
- **Note:** The home server hardware decision is paused pending Warren's parts inventory. Do not buy or build anything for this task until Warren says go. This task is parked until the server exists.
- **Done when:** The home server exists, OpenClaw runs on it as the Server Gateway, and this file says so.

### T-007 — Fleet manager v1: heartbeat + status
- **Owner:** Chief
- **Status:** doing
- **Why:** Need a first status pulse from each machine: online, gateway status, current model, disk/mem/GPU.
- **Do this:** Heartbeat first, jobs/queue view second, spend third.
- **Note (2026-11-26):** Local heartbeat writers are installed on the Tower (hidden Startup item) and the Mini (LaunchAgent `com.duganlabs.fleet-heartbeat`), every 5 minutes, writing `chief/fleet/status/heartbeat.json` on that machine. No public ports. Jobs/queue view and spend still todo.

### T-009 — Tower local coder model
- **Owner:** Chief
- **Status:** done
- **Why:** The original fleet list called for Qwen3-Coder 30B with partial CPU offload as a local escalation model.
- **Note (2026-11-26):** Official `qwen3-coder:30b` is 19 GB with a 256k window and does not fit sensibly in 12 GB VRAM plus 32 GB RAM next to the OpenClaw process. Best-fitting coder already on the Tower: `qwen2.5-coder:14b` (9 GB). 30B was not pulled.

### T-010 — Paid API escalation (hard tasks only, $50/month cap, alerts at 75%/90%)
- **Owner:** Warren
- **Status:** blocked
- **Why:** Paid APIs are allowed only as escalation for hard tasks, with a shared $50 monthly cap and alerts at 75% and 90%. Local qwen3 stays default.
- **Do this:** Put the provider secret in Doppler project `duganlabs`, config `repository`. Chief will enforce the cap and alerts with the plan monitor. Do not install the third-party openclaw-cost-guard plugin (decision: will not install).
- **Note (2026-11-26):** Disabled wiring is ready in `chief/fleet/ESCALATION.md` and `escalation.DISABLED.json5`. Doppler was scanned (names only) across all DuganLabs projects. No model-provider keys are present yet. Exact secret names that turn a provider on: `XAI_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `OPENROUTER_API_KEY`. Nothing paid can run until one of those is added and the disabled patch is applied.

### T-016 — Official OpenClaw iOS app pairing to the Mini
- **Owner:** Chief
- **Status:** todo
- **Why:** The official OpenClaw iOS app is paired to the Tower. The Mini gateway is not paired yet.
- **Do this:** When asked, generate a Mini setup QR with `openclaw qr` and approve any pending official-app request. Do not approve Claw Command (rejected). Do not generate a Mini QR until asked.
- **Done when:** The official app is paired to the Mini gateway.

## Closed tasks

### T-001 — Get OpenClaw running on the Tower and the Mini
- **Owner:** Chief
- **Status:** done
- **Note (2026-11-26):** OpenClaw 2026.11.10 (6ea542f) is running on both machines. Each gateway listens on loopback port 18789 and is exposed on the private tailnet at port 8443 only (no public Funnel; port 443 on the Tower stays with the existing `station` route). Health checks and model smokes passed: Tower default `qwen3:14b`, Mini default `qwen3:8b` at 32k context. Tower starts from a hidden login-item launcher; Mini starts from LaunchAgent `ai.openclaw.gateway`.

### T-003 — Tower Phase 1: local model + agent
- **Owner:** Chief
- **Status:** done
- **Note (2026-11-26):** Ollama serves `qwen3:14b` on the Tower (OpenClaw default, 24k context; it does not fit fully in 12 GB VRAM and partly runs on CPU). Hermes Agent v0.23.4 is installed under `chief/hermes` and answers through a local `hermes-ministral-8b-64k` model on a second Ollama at loopback :11435 (flash attention, 8-bit KV), because Hermes requires at least 64k context and `qwen3:14b` is not used as the Hermes model. Smoke: "HERMES TOWER OK". The same Hermes setup is also on the Mini (smoke: "HERMES MINI OK"); run Hermes and the OpenClaw model one at a time there because of swap pressure.

### T-005 — Reconnect the iPhone to the private tailnet
- **Owner:** Warren
- **Status:** done
- **Note (2026-11-26):** The iPhone is online on the private tailnet again and can reach the Tower gateway.

### T-006 — Pair the official OpenClaw iOS app to the Tower gateway
- **Owner:** Chief
- **Status:** done
- **Note (2026-11-26):** Claw Command (third-party) was rejected and will not be approved. The official OpenClaw iOS app is paired on the Tower. Device names: `iPhone` (node and operator) and `OpenClaw Share` (node). Both report as the official iOS client on iOS 27.2.1. Mini pairing is T-016.

### T-008 — Grok Build CLI sign-in and folder trust on the Tower
- **Owner:** Chief
- **Status:** done
- **Note (2026-11-26):** Grok CLI 1.0.92 was already signed in. A headless test prompt wrote UserPromptSubmit, Stop, and SessionEnd into the chief-feedback spool. Folder trust for `chief` is recorded in the Grok trust store; `grok inspect` reports the folder trusted and the user hooks no longer wait on folder trust.

### T-011 — Hermes always-on launcher for the second Ollama (:11435)
- **Owner:** Chief
- **Status:** done
- **Note (2026-11-26):** Hidden always-on launchers are installed. Tower: Startup-folder `Hermes Ollama.vbs`. Mini: LaunchAgent `com.duganlabs.hermes-ollama`. Both listen on loopback :11435 only (flash attention, 8-bit KV). Verified after start.

### T-015 — Grok sign-in then folder trust so feedback hooks fire
- **Owner:** Warren
- **Status:** done
- **Note (2026-11-26):** Same work as T-008. Completed by Chief; no further sign-in step is needed.
