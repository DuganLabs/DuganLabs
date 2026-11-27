# @greenput/mcp — GreenPut Discovery MCP Server

**Status: contract-first prototype on mock data. NOT deployed. NOT
submitted to any directory. NOT connected to real data.** Every response
carries `data_mode: "mock"` and a notice saying so, and the server refuses
to boot in any other mode (see "Safety gate").

This server is the MCP layer of GreenPut's GEO plan (v3): one MCP server
over GreenPut's contractor directory and pricing engines, so LLM hosts —
a ChatGPT app, a Claude connector — can _call_ GreenPut's data instead of
only citing its pages. ChatGPT apps and Claude connectors are both
MCP-based, so this one build feeds both directories later. Built
mock-first to lock the contracts before the real directory data lands.

GreenPut connects customers with verified trade contractors and charges
contractors one price per delivered lead — **booked jobs, not bought
leads**. A homeowner price exists only inside a quote: `start_quote`
opens one on the pricing engine and returns **no price**, and the
engine's qualification questions take it to one exact number the
customer books at, labeled **"no price until the qualification questions
are answered — then one exact quote"**. No tool returns a dollar range. GreenPut is not
affiliated with or endorsed by Tesla, Inc.; certifications listed for a
contractor are that contractor's own credentials.

## Tools

| Tool               | Kind      | What it does                                                                                                                                                                                                                                                                                                                      |
| ------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `find_contractors` | read-only | Verified shops for a service near a city/ZIP, ordered by fit. Uncovered area → honest empty result with the nearest covered area named — never padded.                                                                                                                                                                            |
| `start_quote`      | read-only | Opens a quote for a service on the shop's pricing engine. Returns no price until the questions are answered — the price lives only inside the quote — with the engine name and the owned GreenPut page it comes from.                                                                                                             |
| `request_booking`  | write     | Booking handoff for ONE shop under an explicit sharing grant (below). Returns a confirmation reference plus a **sharing receipt**. For a shop enrolled in schedule management, the booking lands in an open slot on their calendar, for the shop to confirm with the customer; otherwise it goes through the shop's request flow. |

## The grant: connecting is not consent

Sharing a person's data with a contractor gets the same transparency as
an OAuth / GitHub App install. Connecting an LLM app to GreenPut
authorizes nothing by itself; sharing is a **separate, explicit grant** —
scoped to one provider (the `shop_id` in the call), scoped per field
(`name`, `phone`, `email`, `service_address`, `job_details`, `photos`),
bound to one purpose (`quote-and-schedule`), and **receipted**: the
response's `sharing_receipt` states exactly what was shared, with whom,
under which grant. The way a GitHub App install makes you pick the org
and the repos it can touch, a booking grant makes the customer pick the
shop and the fields. No grant, an empty field list, or a grant with no
contact path (`phone`/`email`) is a hard stop: the call errors and the
sink is untouched. Fields supplied but not granted are dropped before
anything is recorded, and the recorded grant travels with the lead.
Re-sharing is its own decision: `allow_network_reroute` on the grant
governs whether the lead may be rerouted to another shop in the network
pool, and is recorded on the payload as `reroute_allowed`.

`find_contractors` and `start_quote` expose no personal data, so they
need no grant. The booking handoff is the only sharing moment in v1.

## The pact (how the contract works)

- `src/contracts.ts` is the contract: zod schemas for every tool input
  and output. `contracts/*.json` are JSON Schemas generated from them
  (`npm run generate:contracts`); a test regenerates the map in memory and
  fails on drift.
- `src/provider.ts` is the seam: tools talk only to a
  `DiscoveryProvider`. `src/mock-provider.ts` is today's implementation —
  all fixtures are fictional, prefixed `MOCK —`, with round-number prices.
- `test/contracts.test.ts` is **parameterized by provider**
  (`PROVIDER_UNDER_TEST`, default `mock`). Swapping in the real provider
  means implementing the interface and passing that suite **unchanged** —
  plus the protocol suites in `test/protocol.test.ts` and
  `test/node-server.test.ts`, which drive the real transport.

## Safety gate

The server refuses to boot unless `GREENPUT_MCP_DATA_MODE=mock` is set.
There is no real provider yet; serving fixtures under any other label
would be fabrication. Allowing `live` later is a deliberate code change
that lands with the real provider, not an env flip.

## Run it locally

```sh
npm install
GREENPUT_MCP_DATA_MODE=mock npm start        # http://localhost:8787/mcp
PORT=8788 GREENPUT_MCP_DATA_MODE=mock npm start
npm test                                     # vitest: contract + protocol suites
npm run typecheck                            # tsc --noEmit
npm run generate:contracts                   # refresh contracts/*.json
```

Optional env:

| Variable                         | Effect                                              |
| -------------------------------- | --------------------------------------------------- |
| `GREENPUT_MCP_DATA_MODE`         | Required. Must be `mock` or the server won't boot.  |
| `PORT`                           | Node entry port (default 8787).                     |
| `GREENPUT_MCP_BOOKING_SINK_FILE` | Append accepted lead payloads to this file (JSONL). |
| `GREENPUT_MCP_TELEMETRY_FILE`    | Append telemetry records to this file (JSONL).      |

Every tool call is logged to the telemetry sink as
`{ tool, client, query_shape, zero_result }` — query _shape_, never raw
personal data. The client name comes from the MCP initialize handshake
and is sanitized into the lead source tag (`llm-app/<client>`).

## Architecture notes

- **Transport:** SDK 1.32.1's `WebStandardStreamableHTTPServerTransport`
  (Web Standard `Request`/`Response`), stateful sessions,
  `enableJsonResponse: true` — this prototype is request/response only;
  revisit before any directory submission. `src/server.ts` exports the
  fetch handler (`createApp(...).handleRequest`), deployable to a
  Cloudflare Worker as-is; `src/index.ts` is only a thin node:http
  adapter for local runs.
- **TypeScript:** `module`/`moduleResolution: NodeNext` with `.js`
  import suffixes — the package is pure ESM (`"type": "module"`) and the
  Worker/bundler targets consume the same output shape.
- Shop identity in v1: `shop_id` is the slug from the shop's
  `find_contractors` `profile_url`.

## Launch trigger (from GEO plan v3) — do not submit before ALL hold

1. The real directory answers Orange County electrician queries with
   **verified** profiles (pilot cohort live).
2. The quote flow (no price → one exact quote) runs on the real pricing
   engines behind `start_quote`, so tool answers and the shop's quote
   agree. Marketing pages never print a homeowner price.
3. The booking handoff lands in the real form pipeline with source
   tagging verified end to end in staging.
4. The canonical entity block is identical across the site, `llms.txt`,
   and both directory listings.

Until then the server is exercised privately (developer mode / custom
connector) — never submitted, never pointed at real customer data.
