# Pricing FSM seed

Five pricing state machines for a residential electrician, a shared rate card, and the
fragments they share. This directory is the **source of truth**; SQL is a transport
format generated from it, never edited by hand.

Design rationale, worked arithmetic and honesty rules: [`docs/pricing-fsm-designs.md`](../../docs/pricing-fsm-designs.md).

```
rate-card.default.json        one contractor's numbers — the whole pricing layer
ev-charger-install.fsm.json   Level 2 EV charger
panel-service-upgrade.fsm.json
circuit-outlet-addition.fsm.json
troubleshooting-callout.fsm.json
whole-home-surge-protection.fsm.json
fragments/wire-run.json             "how does the wire get there" — shared by 2 machines
fragments/panel-check.json          the panel photo and what a homeowner can read off it
fragments/property-and-contact.json the qualifying questions, asked last
fragments/shared-terminals.json     the endings every machine needs
fixtures/NN-*.json                  worked traversals
fixtures/NN-*.expected.json         frozen outputs — the engine's conformance oracle
provisional-schema.sql              four tables, deletable the day the engine migration lands
```

## Commands

```bash
node scripts/seed/pricing-fsms.mjs check          # validate; exits non-zero on error
node scripts/seed/pricing-fsms.mjs quote-all      # every fixture, with full arithmetic
node scripts/seed/pricing-fsms.mjs quote seeds/pricing/fixtures/01-ev-typical.json
node scripts/seed/pricing-fsms.mjs verify         # re-run fixtures against frozen expectations
node scripts/seed/pricing-fsms.mjs expect         # re-freeze expectations after a deliberate change
node scripts/seed/pricing-fsms.mjs build          # flattened graphs (fragments inlined)
node scripts/seed/pricing-fsms.mjs apply local greenput   # emit SQL + print the wrangler command
```

## For the engine

`evaluate(graph, rateCard, answers, env) -> { terminal, low, high, breakdown }` must be pure:
no clock, no RNG, no lookups. `scripts/seed/pricing-fsms.mjs` exports a reference
`evaluate()` that produces `fixtures/*.expected.json`. **The real evaluator must reproduce
those numbers exactly.** Where the reference and the spec disagree, the spec below wins and
the reference is the bug.

Fragments may be supported natively or inlined at load time — `build` produces the flat
form, and a flattened graph is semantically identical to the fragment form.

### Graph

| Field | Meaning |
|---|---|
| `entry` | id of the first state |
| `states[]` | see below |
| `terminals[]` | endings; see below |
| `includes_fragments[]` | fragments this machine pulls in |
| `overlays[]` | `{when, apply}` — a terminal id laid over whichever ending was reached, adding copy and lead flags without changing the price |
| `honesty` | refusal rules, spread ceiling, per-machine rules |
| `meta` | homeowner-facing title/intro, screen counts |

### State kinds

| `kind` | Behaviour |
|---|---|
| `question` | asks; writes `answer.key` (or every `answer.fields[].key` for a group) |
| `derive` | writes `sets` from the first matching rule. `keep: true` leaves an existing value alone |
| `defaults` | fills each key in `sets` only if it was never answered — makes the form's assumptions explicit and checkable |
| `checkpoint` | no question, just branches |
| `fragment` | splices a sub-graph; its `__return__` edges resolve to this state's own `next` |

Every state carries `next[]`: an **ordered** list of `{when, go}`. First match wins. The
last entry must be `{always: true}` unless every option of the guarded answer is covered.

### Answer types

`choice`, `multi_choice`, `measurement`, `photo`, `group`, plus the leaf field types a
group uses (`text`, `phone`, `email`, `zip`).

- `measurement.estimate_options[]` — the "I'm not sure" ladder. Choosing one stores
  `{value, estimated: true}`, which widening rules can test with `{"var": k, "estimated": true}`.
- `photo.interpretation` — the photo does not produce a value, it produces *fields*
  (`panel_capacity`, `panel_brand`, …) plus a `status_key` in
  `missing | unreviewed | reviewed | unreadable`. Unresolved fields take
  `default_when_missing`. **The traversal never blocks on this.**
- `exhaustive: true` — "these options genuinely cover everything", suppressing the
  missing-"I don't know" lint.

### Predicates

```json
{ "all": [ {"var": "panel_capacity", "eq": "spare_capable"},
           {"var": "run_distance_ft", "lte": 30} ] }
```

Sources: `var` (an answer), `env` (an environment fact: `in_service_area`,
`rate_card_tuned`, `is_weekend`), `rate_card` (a rate-card path), `notice` (a flag a derive
raised). Operators: `eq ne in nin lt lte gt gte contains contains_any count_gte answered
estimated`, combined with `all any not always`.

### Terminal kinds

| `kind` | Behaviour |
|---|---|
| `quote` | priced from `line_items` |
| `span` | low = min of the spanned terminals' lows, high = max of their highs. Used while a photo is unread |
| `no_quote` | refuses; may carry an `indicative` band explicitly marked not-a-quote |
| `urgent` | safety; never shows a price above the safety instruction |
| `referral` | out of scope or out of area |
| `overlay` | never routed to; applied over another terminal |

`extends` inherits a parent terminal's line items; `line_items_extra` appends,
`line_items_override` replaces by id, `drop_items` removes.

### Line items

`{id, kind, label, when?, qty, range_side?}` where `kind` is one of:

| kind | Cost |
|---|---|
| `labour` | `qty × rate_card[rate]` |
| `material` | `qty × (1 + waste%) × catalog.cost × (1 + markup%) × (1 + tax%)` |
| `allowance` | `qty × catalog.cost × (1 + tax%)` — **no markup**; an allowance is a pass-through |
| `fee` / `sub` | `qty × rate_card[rate]` — no markup, these are already sell prices |
| `adjustment` | multiplies the labour subtotal (e.g. a weekend uplift) |

`range_side: "high_only"` puts a line in the top of the range only — how "it might take
another hour" is said in money rather than in weasel words.

### Quantities

```json
{ "base": 1.5,
  "per": [ {"of": "run_distance_ft", "rate": 0.025} ],
  "modifiers": [ {"when": {...}, "op": "multiply", "value": 2.1, "because": "..."} ],
  "min": 0.5, "round_to": 0.25 }
```

`base`, then every `per` term, then `modifiers` **in array order** (`add`, `multiply`,
`set`), then `min`/`max`, then `round_to`. A `per` term reads an answer (`of`, with
optional `minus`, `count`, `default`) or a rate-card field (`rate_card`). `{"of_item": "x",
"factor": 0.6}` reads another line item's computed quantity — that item must be listed
earlier, and the validator enforces it.

### Range

```
spread% = terminal.base_spread_pct (or rate card default)
        + terminal.extra_spread_pct
        + every matching widen rule
        capped at uncertainty.max_spread_pct

pad     = min(terminal.flat_pad_usd ?? rate card pad, point × flat_pad_cap_pct%)

low  = floor_to_25( point       × (1 − (1−skew) × spread) − pad ),  raised to fees.minimum_job
high = ceil_to_25 ( point_high  × (1 +    skew  × spread) + pad )
```

`skew` (default 0.6) puts 60% of the spread above the point estimate, because electrical
surprises are one-tailed — you find things behind walls, you never find fewer.

**If the uncapped spread exceeds the ceiling, the machine must stop quoting** and route to
`honesty.on_exceed_max_spread`. Same rule inside a span: if any spanned member blows the
ceiling, the span itself is no longer a quote.

## What the validator enforces

Errors (block publish): unreachable states; dead ends; a branch that can never fire
because an earlier one catches everything; an answer option nothing handles; a priced
outcome with no lines; a rate-card or parts-list reference that doesn't resolve; a line
item referring to one priced after it; and the path-sensitive one that matters — **a price
or a guard that reads an answer some route never collects**.

Warnings: a question with no "I don't know"; a question that doesn't say why it's asked;
duplicate guards; a route longer than 18 screens; a shared ending nothing routes to.
