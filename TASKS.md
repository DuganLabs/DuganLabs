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

- **Chief** (Grok Bot / Grok CLI) — runs on the Tower. The fleet's main agent. Picks up tasks from this queue.
- **Muse** — Warren's personal agent. Hands work to Chief through this queue. Talks to Chief through the Grok Bot app on the Mac.
- **Tower** — Windows PC, NVIDIA RTX 5070 (12GB VRAM), 32GB RAM. On the Tailscale tailnet as `tower`. Runs local Grok CLI sessions.
- **Mini** — Warren's Mac mini. On the Tailscale tailnet as `mini`.
- **Muse VM** — Muse's own machine. On the Tailscale tailnet as `muse`.

Tailscale is the private link between all of them. The tailnet is up and connected.

## Open tasks

### T-001 — Get OpenClaw running on the Tower and the Mini
- **Owner:** Chief
- **Status:** todo
- **Why:** Warren has not seen OpenClaw running on either machine. OpenClaw is the per-device gateway in the agent system. Nothing else in the system can be driven until the gateways are up.
- **Do this:**
  1. Install OpenClaw on the Tower (Windows). Start the Tower gateway.
  2. Install OpenClaw on the Mini (macOS). Start the Mini gateway.
  3. Verify each gateway is actually running (process up, gateway reachable) and report back the version and the port or socket it is listening on for each machine.
  4. If the install needs a choice (for example a package manager, a service wrapper, or a port), pick the standard one and note it in the done note. Do not stop to ask Warren unless the install is blocked.
- **Done when:** OpenClaw is running on both the Tower and the Mini, and this file says so with the version and port for each.

### T-002 — Merge the fleet task list into this queue
- **Owner:** Chief
- **Status:** todo
- **Why:** The fleet list currently lives at `C:\Users\warre\chief\fleet\TASKS.md` on the Tower. One queue, not one per repo. That list moves into this file.
- **Do this:**
  1. Read `C:\Users\warre\chief\fleet\TASKS.md` on the Tower.
  2. Add every open item from it to this file as a new T-### task below, keeping the original wording and any status it already has.
  3. Leave the Tower file in place as a pointer (replace its contents with a one-line note pointing at this file) so nothing is lost and nothing is double-tracked.
- **Done when:** Every open item from the Tower fleet list is in this file, and the Tower file points here.

### T-003 — Tower Phase 1: local model + agent
- **Owner:** Chief
- **Status:** todo
- **Why:** The Tower is the local-model workhorse. Phase 1 is Ollama with Qwen3 14B, then Hermes as the agent on top.
- **Do this:**
  1. Install Ollama on the Tower. Pull Qwen3 14B (the 30B class is the escalation, not the default).
  2. Verify Ollama serves the model (a real generation, not just a process listing).
  3. Install Hermes as the Tower agent and point it at the local Ollama model.
  4. Report the Ollama version, the model, and that Hermes answered a test prompt through the local model.
- **Done when:** Ollama serves Qwen3 14B on the Tower and Hermes answers through it.

### T-004 — Server gateway (home server)
- **Owner:** Chief
- **Status:** todo
- **Why:** The agent system calls for a gateway per device: Tower Gateway, Mini Gateway, Server Gateway. The home server is the third.
- **Note:** The home server hardware decision is paused pending Warren's parts inventory. Do not buy or build anything for this task until Warren says go. This task is parked until the server exists.
- **Done when:** The home server exists, OpenClaw runs on it as the Server Gateway, and this file says so.

### T-005 — File GitHub Support data-removal request
- **Owner:** Muse
- **Status:** todo
- **Why:** The old commit SHAs from before the history rewrite are still reachable through pull-request refs and cached views.
- **Do this:** File GitHub Support data-removal request for DuganLabs/public (formerly DuganLabs/DuganLabs) as warrendugan via https://support.github.com/contact, Warren approved 6:17 PM PT Nov 26. Ticket text: docs/support/github-purge-request.txt
- **Note:** Submitting needs Warren's GitHub sign-in (2FA, then passkey) in a browser. Do not store or ask for his password in a shared file or message.
- **Done when:** The ticket is filed and its number is recorded here.

## Closed tasks

(None yet.)
