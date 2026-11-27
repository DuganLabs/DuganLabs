# Greenput pricing state machines — the domain design

Five finite state machines for a residential electrician: what they **ask**, how they
**branch**, and how they **price**. Companion to `greenput-fsm-pricing.md`, which designed
the engine, the versioning and the evaluator. This is the part that was left to the owner.

The machines themselves are seed data in the repo at
[`seeds/pricing/`](../seeds/pricing/), with a schema reference in
[`seeds/pricing/README.md`](../seeds/pricing/README.md). Every number printed in this
document was produced by running that seed through
`scripts/seed/pricing-fsms.mjs quote`, not typed by hand. Re-run
`node scripts/seed/pricing-fsms.mjs quote-all` and you get this document's arithmetic back.

> **Every figure here is a tunable default, not market truth.** Labour rates vary roughly
> two-to-one between US metros, copper moves monthly, and permit fees are entirely
> jurisdictional — an EV-charger permit is $60 in one town and $450 plus a stamped load
> calculation in the next. The defaults are chosen so a new workspace produces a *sane*
> range on day one, not a *correct* one. Greenput should treat an untuned rate card as a
> warning state on every quote it backs, and it does: `env.rate_card_tuned = false` adds
> ten points of spread, visibly. Where a number could not be grounded honestly it is
> marked `placeholder: true` in the seed and says so on screen.

---

## 1. The rate card — six questions that build a pricing engine

The owner's framing is that a contractor "creates a pricing engine without knowing it."
That only works if the setup screen asks about things they already know the answer to.
None of these six questions requires an electrician to think about state machines,
formulas, or their own cost structure in any way they don't already:

| Screen | What it asks | Default | What it drives |
|---|---|---|---|
| 1 | "What do you charge for an hour of a licensed electrician's time?" | $110/hr | every `labour` line in every machine |
| 2 | "Do you charge to come out?" + when it applies | $79, diagnostic only | the `trip` line, and whether it appears at all |
| 3 | "What's the smallest job you'll take?" | $285 | a hard floor under every low end |
| 4 | "How much do you add to parts?" | 35% | material markup (not allowances, not subs) |
| 5 | "Who deals with permits?" + your fee | you pull, $285 flat | the permit line, per job class |
| 6 | "How sure do you want your prices to be?" | Comfortable (±12%) | the width of every range |

Then a parts list, pre-filled with ~50 entries, each with a label a contractor recognises
("2-pole 40A breaker", "8/2 NM-B romex, 40A"), a default cost, and a `typical_range` so a
wrong entry is visibly wrong. Most contractors will change three or four and leave the
rest. Each entry that hides a trap carries a note:

> **2-pole 50A GFCI breaker — $135.** Required when a 14-50 receptacle feeds an EVSE
> (NEC 625.54). This single part is the most common reason a plug-in install prices above
> a hardwired one.

> **1-pole 20A AFCI / dual-function breaker — $52.** The hidden cost of a panel
> replacement. Where the AHJ requires AFCI on reused circuits, a 20-circuit swap can carry
> $700–$1,000 of these.

And then the screen that makes it real:

> **That's your pricing engine.** Switch on the jobs you want instant prices for. We'll
> show you exactly what a homeowner would be quoted for a typical version of each one,
> using your numbers — change anything that looks wrong.
>
> *Every job type shows a worked example before you turn it on. You are never asked to
> trust a number you haven't seen produced.*

That last line is the whole product argument. A contractor is being asked to pre-commit to
honour a price generated while they are up a ladder. They will only do that if they have
watched the thing produce a number they agree with, from their own inputs, before it ever
faced a customer.

### Three rate-card decisions worth defending

**Confidence is a preset, not a number.** "How sure do you want to be?" offers Tight (±8%,
"you will occasionally eat a surprise to honour one"), Comfortable (±12%) and Wide (±20%,
"you'll almost always come in under the top, which reads well — but a wide range converts
worse"). Nobody can calibrate a percentage. Everybody can pick a temperament.

**The range is skewed, not symmetric.** `skew: 0.6` puts 60% of the spread above the point
estimate and 40% below, because electrical surprises are one-tailed: you find things behind
walls, you never find fewer. A symmetric band systematically under-promises the top.

**The flat pad is capped at 5% of the estimate.** A $60 floor on uncertainty is sensible on
a $2,000 job and absurd on a $420 surge protector, where it would manufacture a 30% range
out of nothing. Capping it is the difference between a range that means something and a
range that is decoration.

---

## 2. The primitives, in one page

Full schema in [`seeds/pricing/README.md`](../seeds/pricing/README.md). The parts that
carry design weight:

- **A state asks one screen.** Not one question — one *screen*. The `group` answer type
  puts several fields on one screen, which is how the contact step went from five screens
  to two. Screens are the currency; every one costs completions.
- **Transitions are an ordered list of guarded edges, first match wins.** The last must be
  a catch-all unless every option is provably covered. The validator enforces this, which
  is the mechanical form of "you haven't said what happens if they answer 'I don't know'".
- **A `derive` state writes an answer without asking.** `circuit_amps`, `route_difficulty`,
  `load_risk`, `conductor_spec` — the technical facts the homeowner can't state and
  shouldn't have to. Each one carries an `explain` field written for the contractor, not
  the engineer.
- **A `defaults` state fills in what the flow never had to ask.** One screen in the GUI:
  "what the form assumes when it doesn't ask." It exists so that the checker can *prove* no
  price ever reads an answer that some route skipped.
- **A `fragment` is a sub-graph included by several machines.** `wire_run` is authored once
  and priced by two machines; `panel_check` by four. A contractor who changes their wire-run
  labour changes it everywhere, once.
- **A photo produces fields, not a value** — `panel_capacity`, `panel_brand`,
  `panel_spaces_free`, `aluminium_branch_visible` — plus a `photo_status` of
  `missing | unreviewed | reviewed | unreadable`. **The traversal never waits for it.**
- **A terminal is an outcome, not a price permutation.** Distance, wall finish, weather and
  digging are *modifiers* inside one terminal. A new terminal is earned only by a
  materially different job: a subpanel, a service upgrade, a refusal.
- **`range_side: "high_only"`** puts a line item in the top of the range only. It is how
  "it might take another hour" gets said in money instead of in weasel words.

---

## 3. Machine one — Level 2 EV charger install

**What the homeowner sees:** *"Get a price for your EV charger. Nine questions, about two
minutes, and a real price at the end — not a call-back. We honour whatever this gives you."*

Twelve screens on the typical path, seventeen at absolute worst. Seed:
[`ev-charger-install.fsm.json`](../seeds/pricing/ev-charger-install.fsm.json).

### 3.1 The screens, in order

**1. `charger_location`** — *"Where do you want the charger?"*
Inside my attached garage · On the outside wall of the garage · In a carport, or on the
driveway · In a detached garage or shop · At a parking spot away from the house.
*Help:* "Think about where the car actually sits, and which side the charge port is on.
Most chargers come with a cable around 18 to 25 feet."
*Why we ask:* "Inside a garage is the simplest and cheapest case. Anything outdoors needs
weatherproof parts, and anything in a separate building usually means digging."
→ derives `destination_outdoors`, which is the only thing the shared wire-run fragment
needs to know about EV chargers.

**2. `charge_speed`** — *"How fast do you want it to charge?"*
Normal (32A, "about 25–30 miles of range per hour; this is what most people get and it is
plenty for daily driving") · Fast (48A, "needs heavier wire and has to be wired in
directly, not plugged in") · I don't know — recommend one.
*Why:* "Faster charging costs more to install because it needs thicker wire and a bigger
breaker — not because the charger costs more."

**3. `charger_supply`** — *"Do you have the charger already?"* Yes · Ordered, not here yet ·
No, include one in the price.

**4. `charger_connection`** — *"Does your charger plug in, or wire in directly?"*
It has a plug ("a big three-prong-plus-round plug, like an electric range. Called a 14-50")
· It's wired in directly · I don't know.
*Why:* **"A plug-in charger needs a special safety breaker that costs about three times a
normal one, because the code requires it for that kind of outlet. Wiring in directly avoids
that. It's often the biggest surprise on an EV quote, so we'd rather tell you now."**

If we're supplying the charger, this screen is re-framed as a choice we're making together
— "Wire it in directly (cheaper, tidier)" vs "Put an outlet in and plug it in (costs more,
but you can take the charger with you)" — because when it's our hardware, it's our
recommendation.

**5–9. `panel_check` fragment** — panel location, the photo, the main breaker number, the
big appliances. Covered in §3.3.

**10–12. `wire_run` fragment** — distance, room crossings, wall finish, and only if
relevant: surface-vs-hidden, weather, digging. Covered in §3.2.

**13–14. `property_and_contact` fragment** — two grouped screens: what kind of building and
do you own it; then ZIP, timing and where to send the price.

### 3.2 The wire-run fragment — the biggest lever in the job

**`run_distance_ft`** — *"Roughly how far is the panel from where the work is going?"*
*Help:* "Pace it out — a normal step is about a foot. Go around corners the way a wire would
have to, not straight through. Close is fine; we don't need it exact."
With an "I'm not sure" ladder: *Same wall, or just around the corner* (15ft) · *Across the
garage, or the next room over* (35) · *Other side of the house, or a different floor* (70) ·
*A separate building* (110). Picking one stores `estimated: true`, and **estimating costs
six points of spread.** Over 150ft the machine stops quoting.

**`route_crosses`** — *"Between the panel and there, does the wire have to leave the room?"*
No · Through one wall · To a different floor or the other side of the house · To a separate
building. Worth `+0.4 / +1.2 / +1.6` labour hours respectively.

**`wall_finish`** — *"What are the walls and ceiling like along the way?"*
Open — bare studs, exposed block or an unfinished ceiling ("you can see the wood or the
brick") · Finished walls, but there's an attic or crawlspace we can get into · Finished
walls, and there's no attic or crawlspace · I'm not sure.
*Why:* **"This is the biggest single thing that changes how long the job takes. Stapling a
wire to open studs is minutes. Threading it through a finished wall with nowhere to get
above it can take hours."**

**`finish_preference`** — only when there's no access. *"With nowhere to get above or below,
we have two ways to do this. Which sounds better?"* Surface conduit ("cheapest and quickest.
You'll see it on the wall") · Hide it inside the wall ("we cut small openings to get the
wire through. Patching and painting is not included") · Whichever you'd recommend.
*Help:* **"There's no hidden option that costs nothing — either the wire shows, or we open
the wall."**

These four answers collapse into one derived value, `route_difficulty`, and the entire
labour model multiplies off it:

| `route_difficulty` | labour multiplier | why |
|---|---|---|
| `open_framing` | ×1.0 (baseline 1.5 min/ft) | staple and go |
| `attic_or_crawl` | ×2.1 | working somewhere you can't stand up |
| `surface_conduit` | ×2.9 | bending and strapping conduit |
| `fish_and_patch` | ×4.2 | fishing wire inside a finished wall |
| `unknown` | ×2.5 | and +8% spread |

Outdoors adds `outdoor_exposure` (none / along an outside wall / underground / not sure) and
if underground, one grouped screen for `trench_surface` and `trench_distance_ft`. **Concrete
or asphalt is an immediate stop** — cutting paving is a different trade with a price nobody
can guess from a form.

### 3.3 The panel check — and the photo

**`panel_location`** — *"Where is your electrical panel?"* with an "I can't find it" option
that is a real branch, not a dead end. It leads to a screen that helps:

> Check, in this order: the garage wall nearest the meter; a basement or utility room; a
> hallway or bedroom closet; the outside wall right behind or beside your electric meter. In
> an apartment or condo it's often by the front door. It's a metal door, hinged, usually
> about the size of a cereal box or bigger, and there's a paper list of rooms inside.

**`panel_photo`** — *"Last thing — a photo of your panel."* Two shots: the panel with the
door open ("stand close enough that we could read the little numbers on the switches. Don't
touch anything inside") and one from a few feet back. Safety note: **"Open the outer door
only — the one with the handle. Never unscrew the metal cover behind it."**

*Why:* "Without it we can still quote, but we have to show you a much wider range — because
we'd be pricing for the possibility that the panel is full."

Skippable, labelled *"I'll send this later."* The photo yields five interpreted fields, each
of which can be `unknown`:

| field | values |
|---|---|
| `panel_capacity` | `spare_capable` · `spare_needs_tandem` · `full_needs_subpanel` · `service_upgrade_needed` · `hazard_panel` · `unreadable` · `unknown` |
| `panel_brand` | Square D · Siemens · Eaton · GE · Murray · **Federal Pacific · Zinsco · Challenger · Pushmatic** · other · unknown |
| `panel_main_amps`, `panel_spaces_free` | numbers, or null |
| `aluminium_branch_visible` | true / false / null |

The four bolded brands are the recalled-or-withdrawn ones. Seeing one routes to a terminal
that refuses to sell a new circuit at all (§3.6).

**`service_size_stated`** — *"What number is printed on the big switch at the top of the
panel?"* 60 · 100 · 125 · 150 · 200 · 400+ · I can't see a number.

**`major_loads`** — *"Which of these does your home run on electricity?"* Electric oven ·
electric dryer · electric water heater · central AC · heat pump · pool or hot tub · another
EV charger · a workshop. *Help:* "Tick everything that's electric rather than gas."

These two derive `load_risk` — and the seed says out loud what it is:

> A crude proxy, **not** a load calculation. A real NEC 220.83 calculation needs square
> footage and nameplate ratings and is an electrician's job, not a form's. This only decides
> whether the machine is allowed to quote the cheap path, or has to raise the possibility of
> a service upgrade or load management. When it says `high`, the machine offers both and says
> plainly that a calculation has to be done.

100A with three or more big electric loads → `high`. 60A service → `critical`, and the
machine refuses outright: a 60A service cannot take a charger on any reading.

### 3.4 The technical derives — where domain knowledge lives

**`circuit_amps`** — 32A charging → 40A circuit; 48A → 60A; plug-in caps at 50A.
That cap raises a `notice`, and the notice becomes a line of copy on the quote:

> You asked for fast charging and a plug. Those two don't go together — a plug-in charger is
> limited to a 50A circuit. We've priced the fastest plug-in setup. If you want the full
> speed, we'd wire it in directly instead; say the word and we'll re-price it.

**`gfci_breaker_required`** — true for a plug-in charger (NEC 625.54), false for hardwired,
and **true when the homeowner doesn't know**, because we price the dearer option and say so:

> We've priced this as a plug-in charger, which is the more expensive of the two. If yours
> wires in directly, we'll take about $150 off before you pay anything.

**`conductor_spec`** — and the rule that no homeowner could possibly know:

> Picks the wire. The rule that surprises people: **6-gauge romex is only rated 55A, so a
> 60A circuit cannot use it** — it has to be individual conductors in conduit. That single
> code fact is the difference between a $3.40/ft job and a conduit job.

**`upsize_for_voltage_drop`** — and the myth it refuses to repeat:

> Long runs lose voltage. The real number is a calculation, not a rule of thumb: at 240V a
> 32A continuous load on #8 copper stays inside 3% to roughly 145 feet, and a 48A load on #6
> to roughly 150. So we set the trigger at a conservative 120 feet rather than repeating the
> common myth that anything over 50 feet needs upsizing — it does not, and charging for it
> would be dishonest.

### 3.5 The outcomes

Seven, in order of seriousness:

| Terminal | When | Kind |
|---|---|---|
| `T_hazard_panel` | photo shows FPE / Zinsco / Challenger / Pushmatic | refuses |
| `T_site_visit_required` | aluminium branch wiring, >150ft, concrete trench, mobile home, 60A service, or spread over the ceiling | refuses |
| `T_service_upgrade_required` | photo or load risk says the service is too small | refuses, hands off |
| `T_load_management` | panel has room but the service is tight | **quotes — the cheaper answer** |
| `T_subpanel_required` | panel full, service fine | quotes |
| `T_standard_install` | there's room — the normal job | quotes |
| `T_needs_panel_review` | photo unread or missing | spans the two above |

`T_service_upgrade_required` is deliberately not a quote, and the seed says why:

> This machine never collected the answers a service upgrade actually prices off — how many
> circuits come back, where the meter is, whether the service comes in overhead. Emitting a
> number here would be the machine pricing a job it did not ask about.

`T_load_management` is the one that matters commercially. A 100A house with a range, a dryer
and central AC is the single most common EV-charger customer, and the reflex sale is a
$6,000 service upgrade. The honest answer is usually a load-management module: the charger
shares capacity with the house and backs off when everything is on at once. The machine
quotes that *first*, with the service upgrade offered as an alternative:

> There may be a cheaper way. If your panel has room and it's only the total that's tight, a
> load-management device can let you charge without upgrading anything. Ask us — **we'd
> rather sell you the small job if it's the right one.**

### 3.6 Worked traversal A — the premise's typical job

Attached garage, hardwired 32A charger the homeowner already owns, panel in the same garage
with spare spaces confirmed from the photo, 25ft measured, same room, open framing, 200A
service. Fixture [`01-ev-typical.json`](../seeds/pricing/fixtures/01-ev-typical.json).

**Route:** `charger_location → derive_destination_outdoors → charge_speed → charger_supply →
charger_connection → derive_circuit → derive_gfci → panel_check(location, photo, service
size, loads, load risk) → wire_run(distance, crosses, wall finish, defaults, route
difficulty) → derive_conductor → derive_voltage_drop → property_basics → contact_details →
outcome → T_standard_install`

| Line | Arithmetic | Cost |
|---|---|---|
| Getting set up and protecting the space | 0.5 hr × $110 | $55.00 |
| Work in the panel | 1.5 hr × $110 | $165.00 |
| Running the wire | 25ft × 0.025 hr/ft = 0.625 → 0.75 hr × $110 | $82.50 |
| Mounting and connecting the charger | 1.25 hr × $110 | $137.50 |
| 40A breaker | 1 × $42 × 1.35 markup | $56.70 |
| 8-gauge cable | (12ft slack + 25ft) × 1.12 waste × $2.20 × 1.35 | $123.08 |
| Fixings, connectors and labels | 1 × $22 × 1.35 | $29.70 |
| Permit and inspection | flat | $285.00 |
| Filing the permit and meeting the inspector | (0.75 + 1.0) hr × $110 | $192.50 |
| | **point estimate** | **$1,126.98** |

Spread 12% (nothing widened it — the distance was measured, the walls are open, the photo
was read). Pad = min($60, 5% × $1,127) = $56.35.

```
low  = 1126.98 × (1 − 0.4 × 0.12) − 56.35 = 1015.58  → floor to 25  → $1,000
high = 1126.98 × (1 + 0.6 × 0.12) + 56.35 = 1264.47  → ceil  to 25  → $1,275
```

**RANGE $1,000 – $1,275.** Note what the permit is doing: $477.50 of a $1,127 job is permit
fee plus permit labour. In a jurisdiction that charges $60 and doesn't require an inspection
meeting, the same job prices near $700. That is why the permit fee is the number the setup
wizard tells contractors to tune per city.

### 3.7 Worked traversal B — the photo we haven't read yet

Same house, but a plug-in charger, the panel in an interior closet, 45ft through a finished
wall with no attic access, homeowner chose to hide the wire, photo uploaded but not yet
reviewed. Fixture [`02-ev-plug-in-finished-wall.json`](../seeds/pricing/fixtures/02-ev-plug-in-finished-wall.json).

The traversal lands on `T_needs_panel_review`, which spans two terminals:

| Outcome | Point | Spread | Band |
|---|---|---|---|
| `T_standard_install` | $2,246.68 | 27% | $1,925 – $2,675 |
| `T_subpanel_required` | $3,131.64 | 31% | $2,675 – $3,775 |

**RANGE $1,925 – $3,775** — literally the cheapest outcome's low to the dearest outcome's
high. Not a padded guess; the real shape of the uncertainty. The 27% comes from 12% base +
10% (photo unreviewed) + 5% (panel brand unknown), and the $2,247 against traversal A's
$1,127 is three things: the GFCI breaker the plug demands ($135 → $182 with markup), the
14-50 receptacle in industrial grade, and 7.25 labour hours instead of 0.75 to fish 45
feet through a finished wall.

The screen says:

> **Here's your range — we'll narrow it today.** Everything except your panel is clear.
> Until one of our electricians has read the photo, this range covers both possibilities: a
> straightforward job if there's room in the panel, and the bigger one if there isn't.
> *Your photo's with us. Nothing more needed from you.*

And, as a condition on the priced half: *"This price includes opening the wall and putting
the wire in. It does not include making the wall look new again"* — with a patching add-on
priced separately at $135 per opening, shown outside the range because it's optional.

### 3.8 Worked traversal C — the expensive job that is still quotable

Detached garage, 48A hardwired, charger supplied by us, 110ft run, 40ft of it trenched
through lawn, open framing at both ends. Fixture
[`03-ev-detached-garage-trench.json`](../seeds/pricing/fixtures/03-ev-detached-garage-trench.json).

| Line | Arithmetic | Cost |
|---|---|---|
| Setup | 0.5 hr | $55.00 |
| Work in the panel | 1.5 hr | $165.00 |
| Running the wire | (110 × 0.025) + 1.6 (other building) + 0.5 (exterior wall) + 1.0 (in and out of the ground) = 5.85 → 5.75 hr | $632.50 |
| A second pair of hands | 0.6 × 5.75 = 3.45 → 3.5 hr × $65 | $227.50 |
| Mounting and connecting | 1.25 + 0.3 (weather-sealing) + 0.4 (shut-off at the far building) = 1.95 → 2.0 hr | $220.00 |
| 60A breaker | 1 × $58 × 1.35 | $78.30 |
| 6-gauge conductors | (36 + 110×3) = 366ft × 1.12 × $0.78 × 1.35 | $431.65 |
| Buried conduit | (8 + 110)ft × 1.12 × $1.30 × 1.35 | $231.94 |
| Shut-off switch at the far building | 1 × $62 × 1.35 | $83.70 |
| Charger (allowance) | 1 × $480, **at cost, no markup** | $480.00 |
| Fixings (large-job rate) | 1 × $65 × 1.35 | $87.75 |
| Digging (lawn) | 40ft × $14/ft | $560.00 |
| Permit + permit labour | | $477.50 |
| | **point estimate** | **$3,730.84** |

**RANGE $3,475 – $4,075.** Three domain facts are visible in that table. The conductors are
individual THHN in conduit, not romex, because 60A rules out 6-gauge cable. There are three
conductors, not two, times the run. And the charger allowance carries **no markup** — an
allowance is a pass-through, and marking one up is how a quote becomes a trap.

### 3.9 Worked traversal D — when the machine refuses

Carport, "recommend a speed", charger ordered but not arrived, connection unknown, panel on
an exterior wall, **photo skipped**, main breaker number unknown, distance estimated at 35ft
from the ladder, wall finish unknown. Fixture
[`04-ev-no-photo-estimated-distance.json`](../seeds/pricing/fixtures/04-ev-no-photo-estimated-distance.json).

The spread accumulates: 12 base + 6 (distance estimated) + 8 (walls unknown) + 8 (route
unknown) + 14 (no photo) + 5 (brand unknown) + 5 (service size unknown) = **58%**, above the
45% ceiling. The machine stops:

> **outcome:** `T_site_visit_required` — no price.
> *Uncertainty reached 58%, above the 45% ceiling. A range that wide is not a price.*
> **indicative only (NOT a quote): $1,350 – $3,400**

That is the design working. Four "I don't know"s is not a customer to be quoted at, it is a
customer to be visited. And they still leave with a number — labelled, honestly, as not one.

---

## 4. Machine two — panel replacement and service upgrade

**What the homeowner sees:** *"What would a new panel cost? The biggest job most houses ever
need from an electrician, and the one with the widest prices out there. Eight questions and
we'll show you an honest range — including whether you need it at all."*

Seed: [`panel-service-upgrade.fsm.json`](../seeds/pricing/panel-service-upgrade.fsm.json).

### 4.1 The screens

**1. `reason`** — *"What's making you look at your panel?"* No room for more circuits ·
Breakers keep tripping · It's old, or an inspector or insurer flagged it · I'm adding
something big · I'm selling the house · **Something's wrong with it — burning smell, scorch
marks, it's warm, it buzzes or sparks.**
*Why:* **"Half the people who ask about a new panel don't need one. The answer changes what
we look at."**
That last option exits immediately to `T_urgent_dispatch`. A panel that smells is a safety
call, and pricing is the wrong response to it.

**2–6. `panel_check` fragment** — the same photo and the same two homeowner-answerable
questions as the EV machine. Authored once.

**7. `circuits_in_use`** — *"How many switches are in your panel?"*
*Help:* "Count every switch except the big one at the top. Count a wide double switch as one.
If you sent the photo, a rough number is fine — we'll count them properly ourselves."
*Why:* **"Every existing circuit has to be moved across and given a new breaker, and modern
breakers cost several times what the old ones did. On a panel replacement, breakers are
often the single biggest material cost — more than the panel."**

**8. `meter_position`** — *"Where's your electric meter, compared to the panel?"* Right
behind it · Same outside wall, near it · Somewhere else entirely · I can't see a meter · Not
sure. *Why:* "If the meter is right there, replacing the panel is one job. If it's far away,
it becomes two."

**9. `service_entry`** — *"How does the power get to your house?"* Through the air, from a
pole · Up out of the ground · Not sure.
*Help:* "Stand outside and look up. If there's a cable from a pole to your roof or a mast,
that's overhead."
*Why:* **"This is the single biggest thing that separates a $3,000 job from a $9,000 one.
Underground services usually mean the utility company has to dig."**

**10. `panel_position_issue`** — *"Is anything awkward about where the panel is?"* In a
clothes closet · In a bathroom · Over a stairway · Something big in front of it · In a
crawlspace or attic you can't stand up in.
*Help:* **"Tick anything that's true. None of these are your fault — houses get built this
way."**

**11. `upgrade_target`** — replace what I've got · 200A · 400A · tell me what I need.

**12. `outage_tolerance`** — *"Your power will be off for most of a day. When can we do
that?"* A weekday is fine · Weekend only · I can't be without power.

### 4.2 The outcomes, and the one that loses the sale on purpose

| Terminal | When | Kind |
|---|---|---|
| `T_urgent_dispatch` | burning, heat, arcing | safety, no price |
| `T_panel_relocation` | panel in a bathroom, closet, or over stairs | refuses, visits |
| `T_service_upgrade_underground` | power comes up out of the ground | refuses, visits |
| `T_site_visit_required` | meter far away or not visible, or 400A | refuses, visits |
| **`T_subpanel_instead`** | **only out of spaces, service is fine** | **quotes — a third of the price** |
| `T_service_upgrade_overhead` | service genuinely too small | quotes, but books a visit |
| `T_panel_swap_same_service` | old or hazardous panel, service fine | quotes, but books a visit |
| `T_needs_panel_review` | photo unread | spans subpanel ↔ service upgrade |

The derive that picks between them leads with the cheap answer, and says why in the seed:

> If the only problem is running out of spaces and the service itself is fine, the honest
> answer is a subpanel, not a new service — and it is roughly a third of the price. The
> machine must volunteer that.

`T_subpanel_instead` opens: **"You probably don't need a new panel."** And closes:

> We're telling you this because it's true, not because it's the cheapest thing we could
> sell you. If a full replacement turns out to be the right call when we look, we'll show
> you why.

### 4.3 The arithmetic, and the cost everybody forgets

Worked traversal: 100A → 200A, overhead service, meter directly behind the panel, 24
circuits, a range, a dryer and central AC. Fixture
[`06-panel-service-upgrade.json`](../seeds/pricing/fixtures/06-panel-service-upgrade.json).

| Line | Arithmetic | Cost |
|---|---|---|
| New panel (200A, 40-space) | 1 × $420 × 1.35 | $567.00 |
| **Arc-fault and dual-function breakers** | **24 × 0.7 = 17 × $52 × 1.35** | **$1,193.40** |
| Standard breakers | (24 − 3 big loads) × 0.3 = 6 × $12 × 1.35 | $97.20 |
| Breakers for the big appliances | 3 × $34 × 1.35 | $137.70 |
| Ground rods | 2 × $22 × 1.35 | $59.40 |
| Earthing cable | 30ft × 1.12 × $2.40 × 1.35 | $108.86 |
| Fixings, connectors, labels, sealant | 1 × $65 × 1.35 | $87.75 |
| Replacing the panel | 3.5 + (24 × 0.18) = 7.82 → 7.75 hr × $110 | $852.50 |
| A second electrician | 0.75 × 7.75 = 5.75 hr × $65 | $373.75 |
| Meter enclosure | 1 × $155 × 1.35 | $209.25 |
| Mast and weatherhead | 1 × $180 × 1.35 | $243.00 |
| Mast pipe | 10ft × 1.12 × $9.00 × 1.35 | $136.08 |
| Service cable | (10 + 5)ft × 1.12 × $11.50 × 1.35 | $260.82 |
| Meter, mast and service cable labour | 6.0 hr × $110 | $660.00 |
| A second electrician on the service work | 0.9 × 6.0 = 5.5 hr × $65 | $357.50 |
| Permit and inspection + filing | | $477.50 |
| | **point estimate** | **$5,821.71** |

Spread 12% base + 8% ("your utility company sets its own requirements for the mast height,
the meter position and the connection, and we find out exactly what they want when we
apply") = 20%. **RANGE $5,275 – $6,600.**

**The arc-fault breakers cost more than the panel, the meter base and the mast combined.**
That is the real shape of a modern panel replacement and it is the number contractors most
often leave out of a phone quote. The `0.7` is flagged as the first thing to tune, per city:

> Some jurisdictions require AFCI on every reused circuit on a replacement panel; some
> require none. At 20 circuits that difference is roughly $700 of parts.

Three more things this terminal says out loud, as conditions on the quote:

> Your utility may bill you directly for the disconnect and reconnect. We can't include what
> we don't control, so if they charge you, that's on top.

> On a job this size we come and look before you commit to anything. The visit confirms the
> number — it doesn't become a sales call.

> Modern breakers detect faults the old ones didn't. **On about one job in four, one comes
> up the moment we energise.** That's a real fault that was always there — we'll show you
> what we find and price it separately rather than hiding it in this number.

For comparison, the same house whose only problem is spaces, fixture
[`07`](../seeds/pricing/fixtures/07-panel-subpanel-instead.json), prices at **$1,300 –
$1,625** — a subpanel, a feed breaker, 16ft of feeder and 3.5 hours. Roughly a quarter.

And the Federal Pacific case, fixture
[`08`](../seeds/pricing/fixtures/08-panel-swap-hazard-brand.json): a like-for-like 100A
replacement with the panel behind a workbench and a homeowner who estimated "about twenty"
circuits. Labour picks up +1.5 hr ("old panels come apart slowly and the wiring in them is
usually short") and +1.0 hr for the blocked access; spread picks up +5% ("old wiring in an
old panel is short, brittle and sometimes spliced — we find out when the cover comes off")
and +8% for the estimated circuit count. **$3,200 – $4,250.**

---

## 5. Machine three — adding an outlet or a circuit

**What the homeowner sees:** *"Need an outlet putting in? The most common thing we do.
Answer a few questions and we'll price it — including telling you when the cheap version
will do."*

Seed: [`circuit-outlet-addition.fsm.json`](../seeds/pricing/circuit-outlet-addition.fsm.json).

### 5.1 The branch that defines the machine

**1. `what_for`** — *"What's the outlet for?"* A normal outlet · An outdoor outlet · A
kitchen or bathroom outlet · A 240V dryer outlet · A range or oven · A welder, compressor or
shop tool · A hot tub or spa · A window AC or space heater · Power out to a shed or shop.
*Why:* **"A normal outlet and a dryer outlet are the same idea and about four times apart in
price."**

Nine plain-English answers collapse into six technically different jobs (`circuit_class`).
Then, for the small general-purpose ones only, the question that decides everything:

**`tap_existing`** — *"Is there already a working outlet near where you want the new one?"*
*Help:* "Same wall, or the other side of the same wall, within about ten feet."
*Why:* **"If there is, we can usually run the new one off it in about an hour — no trip to
the panel, no permit, a fraction of the price. It's worth a look before you spend more than
you need to."**

Answering yes takes a completely different route: no panel photo, no run questions, no
permit — five screens instead of twelve, and a quote of **$285 – $300** instead of roughly
$1,100. The seed makes this a hard rule rather than a preference:

> When `needs_new_circuit` is false the machine **must** land on `T_tap_existing_circuit`
> even though the new-circuit terminal would earn three times as much. A machine that
> quietly stops offering its cheapest honest outcome is the failure mode that destroys trust
> in the whole product.

That $285 is the minimum-job floor biting — the arithmetic comes to $250.74 — and when it
bites, the quote says so:

> This job is smaller than our minimum call-out, so it's priced at the minimum of $285. If
> you have anything else you've been meaning to get done while we're there, now is the time
> to mention it — you're paying for the hour either way.

It also refuses to over-promise:

> If we get there and the nearby outlet turns out to be on a circuit that's already loaded,
> or it's a kitchen or bathroom circuit we're not allowed to extend, we'll tell you before we
> start and re-price it as a new circuit. **You won't be charged for finding out.**

### 5.2 Outcomes and pricing

`T_tap_existing_circuit` · `T_new_circuit` (one terminal, guarded line items for every
circuit class) · `T_hot_tub_circuit` (extends it) · `T_circuit_with_subpanel` (extends it) ·
`T_needs_panel_review` (spans the last two) · plus the shared refusals.

A `derive_conductor_spec` picks the cable once for all six classes. **This derive exists
because of a bug the validator did not catch and a fixture did:** an early draft priced a
hot-tub circuit with no cable and no breaker at all, because the guards on those lines
listed `240_50` and `subpanel_feed` but not `spa_240`. The "a branch with no price" check
caught outcomes with *no* lines; it could not catch an outcome whose lines were *missing
one*. Running every fixture and reading the receipt did. That is an argument for worked
examples being part of the authoring surface, not an afterthought — see §7.

Two worked traversals:

**A 240V dryer circuit, 30ft across the house through an attic** (fixture
[`10`](../seeds/pricing/fixtures/10-circuit-dryer.json)): 0.5 setup + 1.0 panel + (30 ×
0.025 × 2.1 attic + 1.2 across-house) = 2.75 run + 0.75 outlet = 5.0 labour hours; a 30A
2-pole breaker, 42ft of 10/3, a 14-30 receptacle, a box, consumables, permit and permit
labour. Point $1,257.79, spread 12%. **RANGE $1,125 – $1,425.** With a condition that saves
an argument on the day:

> Check which plug your dryer has before we come. Older dryers have a three-pin plug; new
> circuits have to be four-pin. If yours is the old kind we'll change the cord — about twenty
> minutes and the cost of the cord.

**A hot tub, 55ft with 25ft of trench** (fixture
[`11`](../seeds/pricing/fixtures/11-circuit-hot-tub.json)): the spa panel with its built-in
GFCI ($249.75), 30ft of bonding wire, four buried conductors in 1" PVC (268ft of THHN —
two hots, a neutral and a ground), $350 of digging, and two extra hours for the shut-off and
the bonding. Point $2,489.93, spread 17%. **RANGE $2,250 – $2,825.** Plus:

> Don't fill the tub before we've been. The bonding has to be done with the equipment
> accessible, and it's a lot easier before there's 400 gallons in the way.

---

## 6. Machine four — "something's not working"

**What the homeowner sees:** *"Tell us what's happening. We'll either tell you how to fix it
yourself, tell you to call someone who isn't us, or book you in — in that order."*

Seed: [`troubleshooting-callout.fsm.json`](../seeds/pricing/troubleshooting-callout.fsm.json).
This is the highest-frequency inbound call in residential electrical and the machine that
quotes least. From the seed:

> Three of its six endings take no money at all. That is the point: the highest-frequency
> inbound call in residential electrical is also the one where an instant confident number
> is a lie, and the machine that says so is the one people come back to.

### 6.1 The first screen does most of the work

**`symptom`** — *"What's happening?"* with ten options, four of which end the flow
immediately:

| Answer | Goes to |
|---|---|
| Burning smell, scorch marks, hot or sparking | `T_urgent_dispatch` |
| I'm getting shocks off an appliance, a tap or a switch | `T_urgent_dispatch` |
| Half the house has no power, or lights are dim in some rooms and bright in others | `T_call_utility_first` |
| The whole house has no power | a neighbour check, then `T_call_utility_first` |
| An outlet with buttons keeps tripping / some outlets stopped working | `reset_attempted` first |
| everything else | the diagnostic flow |

*Why we ask:* **"Some of these have a free answer. We'd rather give you that than take your
money."**

### 6.2 The three screens that don't sell anything

**`T_urgent_dispatch`** — no price above the safety instruction:

> **Stop and read this.** What you've described can be an active fire or shock risk. Please
> don't wait for a price. If you can see smoke or flame, get out and call 911. Otherwise:
> switch off the breaker for that circuit if you can reach the panel safely, don't use the
> outlet or fixture, and call us now.

The call-out rate is disclosed below it, so nobody feels ambushed, and then it gets out of
the way.

**`T_call_utility_first`** — the highest-trust screen in the product:

> **Call your power company before you call us.** Half the house dark, or lights dim in some
> rooms and unusually bright in others, is the classic sign of a failed neutral on the
> service — the cable between the pole and your meter. **That's the utility's side of the
> line. They treat it as an emergency and they don't charge for it.** If we came out, we'd
> look at it, tell you the same thing, and charge you for the privilege.
>
> If they come out and tell you the problem is on your side of the meter, come straight back
> to us — we'll book you in and we'll take the utility's findings as the starting point.

With a safety note attached: bright-then-dim lights with a failed neutral can put 200V across
120V appliances, so unplug sensitive electronics while you wait.

**`T_self_check_first`** — four numbered steps for finding a GFCI in another room and
properly resetting a breaker ("a tripped breaker often doesn't look obviously off — it sits
slightly out of line with its neighbours. Push it fully OFF first, then back ON"), plus the
one that matters: *"If a breaker trips again straight away, stop. Leave it off and book us —
something is actually wrong and resetting it repeatedly is not safe."*

Framed as *"Try this first — it's free and it works about a third of the time."* And it still
shows the price of a visit, because somebody who tries this and fails should not have to
start again to find out what it costs.

There is a fourth: `T_fixed_itself`, for the homeowner who says the reset worked. It asks for
nothing except permission to remember them, and gives one piece of advice about what a
repeat trip would mean.

### 6.3 The one thing it does price

`T_diagnostic_visit` — **"We'll come and find it."**

> This is the price to come out, find the fault and tell you exactly what it takes to fix it.
> **It is not the price of the repair** — nobody honest can tell you that before they've
> looked.

Fixture [`12`](../seeds/pricing/fixtures/12-troubleshoot-diagnostic.json): a breaker tripping
across several rooms, started after somebody else did building work, wanted same day.

| Line | | Cost |
|---|---|---|
| Coming out to you | trip charge | $79.00 |
| Finding the fault | 1.0 hr included × $110 | $110.00 |
| Same-day call-out | | $225.00 |
| **A second hour, if the fault is a hidden one** | 1.0 + 0.5 (several rooms) + 0.5 (somebody else's work) = 2.0 hr × $110 — **top of the range only** | $220.00 |
| | point / point-with-the-extra-time | $414.00 / $634.00 |

**Spread is set to exactly zero** and the pad to zero. The seed explains why:

> Deliberately zero. The range on this terminal comes entirely from the high-only line item
> — from a real statement about time, not a percentage pad. This is the one machine that can
> be nearly exact, and it should be.

**RANGE $400 – $650.** And four conditions that between them are the whole pitch:

> If it turns out to be something we can fix in the time you've already paid for, we fix it
> and you pay nothing more. That happens a lot.
>
> If it's bigger, you get a fixed price before we touch it, and you can say no. The visit
> still costs what it says here and nothing more.
>
> If you go ahead with the repair, the call-out comes off it.
>
> Same-day means pulling someone off another customer's job, which is why it costs more. If
> tomorrow works, pick that and this comes down.

A machine-level honesty rule backs it up, aimed at the authoring GUI rather than the
homeowner:

> This machine must never emit a price for a repair. If a contractor tries to add repair line
> items to `T_diagnostic_visit`, the validator should warn: **a repair price derived from a
> symptom dropdown is a guess wearing a number.**

---

## 7. Machine five — whole-home surge protection

Chosen as the deliberate counterweight. Seed:
[`whole-home-surge-protection.fsm.json`](../seeds/pricing/whole-home-surge-protection.fsm.json).

> The counterweight to the troubleshooting machine. Small, repeatable, almost deterministic
> — a device, a breaker, ninety minutes. It exists to prove the same engine that honestly
> refuses to quote a fault can give a near-exact number when the job genuinely is near-exact.
> **If every machine produces a wide range, homeowners stop believing any of them.**

Six screens: why you're asking · the panel check · which of three tiers · are we already
coming out · then contact. Base spread is overridden down from 12% to **6%**, with a note:

> This job genuinely has very few unknowns once the panel photo is read, and padding it to
> 12% would be dishonest in the other direction.

Fixture [`15`](../seeds/pricing/fixtures/15-surge-standard.json): standard tier, panel in the
garage with spaces free, on its own. Device $182.25, breaker $45.90, fixings $29.70, 1.5
hours $165.00 → point $422.85, spread 6%, pad capped at $21.14. **RANGE $375 – $475.**

As an add-on to a job already booked, fixture
[`16`](../seeds/pricing/fixtures/16-surge-addon.json), the trip charge and permit line are
dropped and the labour halves to 0.75 hr: a higher-tier device for **$450 – $550**, with the
condition *"This price only holds while the other job is still booked. On its own it costs
more, because of the trip."*

Two screens refuse to sell.

`T_find_the_cause_first` fires when the homeowner says things keep dying, or died when the
lights went dim in one room and bright in another:

> **Don't buy this yet.** That's not a surge-from-outside problem. It's a fault — most often
> a failed neutral, either in your panel or on the utility's service. A surge protector will
> not stop that, and fitting one would take your money for something that cannot help. Get
> the fault found first. If it turns out to be on the utility's side, their visit is free.
>
> Once it's fixed, come back — protection is a good idea, and by then it'll be protecting
> something that works.

And the priced terminal still refuses to overclaim:

> Worth being straight about what this does: it stops spikes coming in from outside —
> lightning nearby, the utility switching, a big motor down the street. It will not save
> something that fails because of a fault inside your house, and it is not a replacement for
> insurance.

> **Good timing.** Whoever fitted your solar or charger may already have put protection in —
> send us a photo of that equipment too and we'll tell you if you're covered. **If you are,
> we'll say so and you can keep your money.**

---

## 8. Authoring — what the GUI must let a contractor say, and stop them saying

The contractor never sees the words *state*, *transition*, *guard*, *predicate* or *machine*.
They see **a job type**, made of **screens**, each with **answers**, and each answer saying
**what happens next**. The graph is explicit in the file and implicit in the interface.

### 8.1 What it must let them express

**"Add a question."** Answer types offered as outcomes, not types: *pick one · pick several ·
a number · a photo · yes or no · their details*. A number can carry an "I'm not sure" ladder,
which the GUI presents as *"Give them some rough options in case they can't measure"* — and
it should warn, visibly, that choosing one widens the price.

**"What happens for each answer."** For a pick-one, a row per option with a destination
picker: another question, or *"that's the price."* This is the transition editor and it never
shows a boolean.

**"Only ask this if…"** A sentence builder over answers already collected:
*Only ask this if **the walls** are **finished with no attic access**.* One clause per row,
joined by *and* / *or*. The stored form is the same predicate language the pricing modifiers
use, which means a contractor who learns the sentence builder once has learned the whole
system.

**"What do we charge for this outcome."** A receipt, not a formula:

> **For this outcome, charge:**
> `2` hours of an electrician's time — *add `0.75` hours if the panel is outside*
> `1` × 2-pole 40A breaker
> `12` feet plus `1` foot for every foot of **distance from the panel** of 8/2 romex
> the permit fee
> **→ Right now that comes to $1,000 – $1,275 for a typical job.** *(live, recomputed as they type)*

**"Assume this when we don't ask."** The `defaults` state, shown as one panel per job type:
*"When we don't ask about digging, we assume there is none."* Editable, and the validator
requires it to cover whatever the prices reference.

**Test drive.** A preview pane running the real flow as a homeowner would see it, with a
saved set of scenarios down the side — *typical · worst case · no photo · out of area* — each
showing the route taken and the receipt. This is what caught the missing hot-tub breaker in
§5.2, and it should be a first-class surface rather than a developer's script.

**Diff before publish.** Because versions are immutable and quotes pin their version, the
publish step must show consequences:

> Compared to your live version: **3 screens changed**, and prices move on 2 outcomes.
> *A typical EV install: $1,000–$1,275 → $1,150–$1,450.*
> *A hot tub circuit: unchanged.*
> Quotes already given keep their old prices. This affects new ones only.

**Start from a template.** Every machine here ships as a Greenput global template
(`workspace_id IS NULL`) that a contractor clones and edits. Nobody authors a state machine
from an empty canvas.

### 8.2 What it must prevent

The validator in `scripts/seed/pricing-fsms.mjs` implements all of these today. Errors block
publishing; warnings do not. The messages are written for a contractor:

| Check | Message |
|---|---|
| unreachable state | *"This question can never be reached — nothing leads to it."* |
| dead end | *"This question is a dead end — nothing follows it."* |
| shadowed guard | *"The branch to X can never happen — an earlier branch already catches everything."* |
| non-exhaustive branching | *"You haven't said what happens if they answer 'I'm not sure'."* |
| missing catch-all | *"This question has no catch-all branch — some answers would go nowhere."* |
| a branch with no price | *"This outcome charges for nothing — it has no priced lines."* |
| broken reference | *"No parts-list entry `breaker.2p_40a`."* / *"No rate-card entry `labor.electrician_hourly`."* |
| forward line reference | *"This line refers to one priced after it."* |
| **path-sensitive answer use** | ***"This price uses `trench_distance_ft`, but there's a route here that never asks it."*** |
| duplicate guards | *"Two branches share an identical condition."* (warning) |
| no way out | *"This question gives no way to say 'I don't know'."* (warning, suppressible with `exhaustive: true`) |
| unexplained question | *"This question doesn't say why it's being asked."* (warning) |
| too long | *"The longest route asks 22 questions — past the point a homeowner finishes."* (warning) |

The path-sensitive check is the one that earns its keep. It is a "must-reach" dataflow
analysis: for every state and outcome, the set of answers guaranteed collected on *every*
route to it, computed to a fixpoint. A price that reads an answer outside that set is an
error — not because it would crash, but because it would silently price off a default and the
contractor would never know. It caught six real holes in the first draft of these five
machines, including the circuit machine pricing a trench it had never asked about.

Two more the GUI should enforce that are policy rather than structure:

- **You cannot publish against a draft rate card.** A machine is only as real as the numbers
  behind it.
- **You cannot publish a machine whose ceiling has no refusal.** If `max_spread_pct` can be
  exceeded, `on_exceed_max_spread` must name a terminal that books a visit.

---

## 9. Honesty rules

### H1 — No price, then a range, then one exact number

A quote moves through three stages, and only forward (H6):

1. **No price** — the work order is not answered far enough to price, or the outcome
   refuses, refers or escalates. `low` and `high` are `null`.
2. **A range** — every priced outcome starts here. Low and high are rounded to $25, and the
   rounding is deliberate: a *range* that reads $1,127.44 is claiming a precision it does
   not have. It stays a range while anything is still a guess: a widen rule fired (an
   estimated distance, an unread photo, an untuned rate card, a utility requirement), a
   line is priced only if it turns out to be needed (`side: high_only`), or the contractor
   has not confirmed the work order.
3. **One exact number** — when nothing is left to guess *and* the contractor has confirmed
   the work order (`env.work_order_confirmed`, the provider's input), the quote is the sum
   of its priced lines, to the cent, never below the minimum job. `low` and `high` both
   carry it, so every consumer of the band sees one price, and `exact` names it. It is not
   rounded: it is the number the contractor's estimate shows, line for line.

Homeowner answers alone never reach stage 3. The base spread exists because self-reported
answers have not been checked by anyone who will do the work; it is the contractor's
confirmation, not another question, that removes it. `exact_blockers` says in words what
still stands between a range and the number. Code: `libs/shared/pricing/src/quote-stage.ts`.

Marketing pages show no stage at all: no homeowner price and no range. The price lives
only inside the quote.

### H2 — The photo never blocks the first number

`photo_status = unreviewed` produces a quote immediately, on a spanning terminal, and a human
resolves it behind the flow. The contractor's standing commitment is to the *flow*, so it
holds even here. What the homeowner sees:

> Everything except your panel is clear. Until one of our electricians has read the photo,
> this range covers both possibilities. *We'll look at it within a few hours and narrow this
> down. The top of the range won't move.*

### H3 — The range widens where we are guessing, and says which guess

Every widening rule carries a `because` string, and they are shown, not hidden:

| Widen | Default |
|---|---|
| the distance was estimated rather than measured | +6% |
| we don't know what the walls are like | +8% |
| we don't know how the wire gets there | +8% |
| nobody has looked at your panel photo yet | +10% |
| we haven't seen your panel at all | +14% |
| we don't know what's under the ground | +8% |
| breaker prices vary a lot by panel brand | +5% |
| this contractor has not finished setting their prices | +10% |

### H4 — Above the ceiling, stop quoting

45% by default. Past it the machine routes to a site visit and shows an indicative band
labelled *not a quote*. Inside a span, if any spanned outcome blows the ceiling, the span
stops being a quote too. Fixture 04 is the worked case: 58%, refused, indicative band shown.

### H5 — Refuse outright in these cases, whatever the spread says

| Case | Why |
|---|---|
| burning smell, scorch marks, heat, sparks, shocks | safety; pricing is the wrong response |
| a recalled panel brand (FPE, Zinsco, Challenger, Pushmatic) | adding load to it is the wrong move |
| aluminium branch wiring visible | changes what we can connect to |
| underground service upgrade | the utility controls the price and we don't know their answer |
| concrete or asphalt to cut | a different trade |
| run over 150ft | the route matters more than the distance |
| 60A service | can't take it on any reading |
| panel in a bathroom, closet or over stairs | it has to move, and where is a standing-in-the-room decision |
| mobile or manufactured home | different service equipment, different rules |
| commercial building | different rules, inspections and insurance |
| half the house dark / whole house dark | probably the utility's free problem |
| repeated equipment failures, for surge protection | the product doesn't fix that fault |

### H6 — Re-evaluation may narrow, never silently widen

When a human resolves the photo and the traversal is re-run, the new range must land
**inside** what was shown. If reading the photo reveals an outcome above the high end that
was quoted, the system must not reprice — it must produce a `revision_required` state and a
phone call. This is the rule that makes "the contractor agrees to honour the range" mean
something. It is stated on every spanning terminal:

> Re-evaluation may only move the range INSIDE what was shown. If reading the photo reveals
> an outcome above this high end, we do not reprice silently — we call.

### H7 — Say what is excluded, every time, in words

Carried on the rate card and shown with every quote: patching and painting where a wall is
opened; restoring lawn or paving over a trench; anything found that is already unsafe;
utility charges billed directly; permit fees if the homeowner pulls. Plus the promise they
sit under:

> This is the price we will honour. If we get there and the job is genuinely different from
> what you described, we stop and talk to you before doing anything that costs more.

### H8 — Refusing without losing them

A refusal with no number is the biggest drop-off in the flow. So refusals follow a fixed
shape: **say what we already know · name the single unknown · give a next step with a price
attached to it · show an indicative number, clearly labelled as not a quote.** Never the
words *"we cannot quote this"* — the homeowner hears *go away*. The seed carries a
`tone_note` on every refusal terminal for whoever edits the copy next:

> **`T_site_visit_required`:** Never the words "we cannot quote this". Say what we know, name
> the one unknown, give a next step with a price attached.
>
> **`T_hazard_panel`:** This is the moment a homeowner decides whether you are honest.
> Explain the actual reason, name the brands so they can look it up themselves, and offer to
> be wrong.
>
> **`T_out_of_area`:** Giving away the number here costs nothing and buys enormous trust.
> They will remember who told them what the job was worth.
>
> **`T_call_utility_first`:** Sending somebody to a free fix costs one call-out and buys a
> customer for a decade. Do not dilute it with an upsell above the fold.
>
> **`T_find_the_cause_first`:** Turning down a sale on the grounds that the product doesn't
> do what the customer needs is the most persuasive thing a contractor can do. Say it plainly
> and do not soften it into an upsell.

### H9 — A tenant is not a dead end

Renters get the same number, with a condition and a lead flag, and a *"forward this to my
landlord"* action. Refusing to price for somebody who can't authorise the work throws away a
lead that was one email from being real.

---

## 10. What is placeholder, and what a contractor must tune first

In tuning order:

1. **The permit fee and whether you permit at all.** On the EV typical job, $477.50 of a
   $1,127 estimate is permit fee plus permit labour. This is the single largest source of
   error and it is per-city.
2. **Your hourly rate.** Everything scales off it.
3. **The AFCI fraction on panel replacements** (`0.7`). Worth ~$700 on a 20-circuit panel and
   entirely dependent on your AHJ.
4. **Breaker prices.** Vary threefold by panel brand; Square D QO and Eaton CH sit at the
   top, BR and Homeline at the bottom.
5. **Trenching and concrete-cutting rates.** Sub-contracted, local, and the concrete number
   is wide by nature.
6. **The two explicit indicative bands** — `T_service_upgrade_underground` ($4,500–$14,000)
   and EV's `T_service_upgrade_required` ($3,500–$9,500). Both carry `placeholder: true` and
   both should be replaced with the contractor's own last-twelve-months actuals before they
   ship. They are there to show the shape, not to be believed.
7. **The temporary-power add-on** ($350 flat) on a panel replacement for someone who can't
   lose power.

Structural things deliberately left as structure rather than guessed numbers:

- **After-hours and weekend multipliers are on the rate card but not applied at quote time.**
  A quote is generated when the homeowner fills the form, not when the job is scheduled, so
  applying a weekend multiplier at quote time would be pricing a decision nobody has made
  yet. The panel machine applies it only where the homeowner has explicitly said *weekend
  only*. Everywhere else it is disclosed, not charged.
- **Sales tax defaults to 0%,** because taxability of contractor-installed materials differs
  by state and by whether the contractor buys tax-paid. Set deliberately or absorb it in
  markup.
- **Utility disconnect/reconnect defaults to $0** and is disclosed as a pass-through, because
  many utilities bill the homeowner directly.
- **Composed quotes** (EV charger + service upgrade priced as one job) are specified in the
  seed as `composed_of` but are not evaluated. Doing it properly means running two machines
  over a merged answer set, and the EV machine does not collect what the panel machine needs.
  Until it does, the honest behaviour is a hand-off, which is what ships.

---

## 11. Handover to the engine

- `seeds/pricing/*.json` is the source of truth. SQL is a transport format, generated, never
  edited, never committed.
- `scripts/seed/pricing-fsms.mjs` exports a reference `evaluate()`. `fixtures/*.expected.json`
  are its frozen outputs. **The real evaluator must reproduce all 18 exactly**; run
  `node scripts/seed/pricing-fsms.mjs verify` in CI against both implementations.
- `TARGET_SCHEMA` at the top of that file is the only place that knows the database shape. If
  the engine's migration names things differently, change that object — the seed JSON is
  schema-independent.
- `seeds/pricing/provisional-schema.sql` creates the four authoring tables so the seed loads
  today. **Delete it the day the engine's migration lands.**
- Fragments may be supported natively or inlined at load (`build` emits the flat form). Both
  are semantically identical.
- The evaluator must be pure: no clock, no RNG, no lookups. Environment facts
  (`in_service_area`, `rate_card_tuned`, `is_weekend`) are passed in, never read inside.
- Photo interpretation is an input to the evaluator, never a step inside it. Whether a human
  or a model produces `panel_capacity` is invisible to the pricing.
