# PendingBusiness — visual language

Written 2026-09-11 alongside `DuganLabs/PendingBusiness#feat/visual-identity`. This is the
specification the code implements, not a mood board: every value here appears verbatim in
`apps/site/src/styles.css`, and every contrast ratio was computed (WCAG 2.x relative
luminance) rather than judged by eye.

---

## 1. What this product is, and what that means for the surface

One person, at a desk, deciding where a month of income goes. Every screen is a decision
surface with money consequences; nothing here is browsed. The register is therefore
**instrument**, not app-marketing: precise, dense, quiet, numerate. The numbers are the
loudest thing on the page. Chrome recedes until it is needed.

Three consequences, which drive everything below:

1. **The figures outrank the headings.** Before this change, `Connected accounts` was set at
   28px/700 while `$82,730` next to it was 20px — the label shouted over the value. Section
   headings drop to a 11px letterspaced micro-cap rule; figures rise to 30px. You read a
   PendingBusiness screen by reading numbers.
2. **Colour is a scarce, reserved resource.** Before, the brand green painted the section
   accent, every link, every button, every stat value, every emphasised table row — and
   `Total liabilities $747,490` rendered in the same green as a gain. When everything is
   accented, nothing is. Colour now has exactly four jobs (§3) and appears on perhaps a
   dozen glyphs per screen.
3. **Density is a feature.** A treasury operator wants the liability ladder in one eyeful,
   not six scrolls. Table rows compress to a ~36px rhythm on fine pointers and relax to ~44px
   on coarse ones, while every interactive control stays at 48px everywhere — density where
   it buys something, no accessibility trade where it would not.

### Relationship to the rest of DuganLabs

The org's favicon preset library (`@basenative/favicon` → `src/presets/dl.js`) already
encodes the house rule: **one charcoal ground, one ink, a different accent hue per
product.** `basenative`/`duganlabs`/`tabs`/`warrendugan` take amber `#E8920A`;
`ralph-station` takes `#5EA0E8`; `warren-sys` takes `#66E0A0`.

PendingBusiness and Greenput were the two presets that broke the rule — both shipped
`{ bg #0F0E0C, fg #F0EDE4, accent #4EAF7C }`, byte-identical. That is the mechanical reason
the two products look like each other. Retuning PendingBusiness's accent is not a departure
from the parent; it is the parent's own rule, applied.

**Ground and ink are unchanged** (`#0F0E0C` / `#F0EDE4`) — that is where family resemblance
lives. Only the accent moves, and it moves for a second, harder reason: see §3.

---

## 2. Type

### 2.1 Families

| Token | Stack | Used for |
|---|---|---|
| `--sans` | `ui-sans-serif, system-ui, -apple-system, 'SF Pro Text', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` | Everything, including all figures |
| `--mono` | `ui-monospace, 'SF Mono', 'JetBrains Mono', 'Fira Code', 'DejaVu Sans Mono', monospace` | Machine strings only — account masks, Plaid client IDs, handles, credential ids |

**Money is set in the sans, not the mono.** The previous build rendered every figure in
`--mono`, which is the reflexive choice and the wrong one:

- Monospace gives `$`, `,` and `.` a full digit advance. `$612,400` costs ~9 character
  widths instead of ~6.5 — roughly 30% of the horizontal budget of every numeric column,
  spent on punctuation.
- Monospace digits are drawn for code, where `l/1/I` disambiguation matters. In a money
  column there are no letters; the tension is between digits, and a text face's lining
  figures are better drawn for that.
- Mono makes money read as *output of a program*. The product's claim is the opposite: the
  numbers are your position.

Alignment — the actual reason people reach for mono — is supplied by OpenType instead:

```css
font-variant-numeric: tabular-nums lining-nums;
font-feature-settings: 'tnum' 1, 'lnum' 1;
```

Every system UI face in the stack (SF Pro, Segoe UI, Roboto, Helvetica Neue) carries `tnum`.
The stack ends in `DejaVu Sans`/`Arial` which also do. Where `tnum` is genuinely absent the
column still right-aligns correctly (§2.3 rule 1 makes the digit *count* equal), it just
loses sub-pixel evenness — a graceful, not a broken, degradation.

### 2.2 Tabular vs proportional — the split

A rule with two halves, and getting only one half right is the common failure:

- **In a column → `tabular-nums`.** Table cells, axis ticks, anything that must line up
  vertically. Set via `[data-bn="table"] [data-numeric]`, not on `:root`.
- **Standing alone → proportional (default) figures.** Stat-tile values, the readout strip,
  the waterfall residual. `tabular-nums` gives `1` the width of `0`; at 30px a value like
  `$310,500` develops visible gaps around the `1`. Standalone figures get
  `font-variant-numeric: lining-nums` only.

This is why `--type-readout` and `[data-numeric]` carry different `font-variant-numeric`
declarations rather than inheriting one global setting.

### 2.3 Numeric treatment — the six rules

1. **One precision per column, applied to every cell including nulls.** Decimal alignment in
   a right-aligned tabular column is not a separate mechanism — it is a *consequence* of
   every cell carrying the same number of fraction digits. Mixing `$8,000.00` and `$310,500`
   in one column breaks alignment no matter how you align it. Precision is chosen by the
   column's job:

   | Context | Precision | Why |
   |---|---|---|
   | Ledger currency (principals, balances, annual gross) | 0 dp | Treasury scale; cents are noise at $612,400 |
   | Routing waterfall | 2 dp | One specific transfer is being executed; cents are the instruction |
   | APR | 2 dp | 24.49% vs 24.00% changes avalanche order. The old build's 1 dp rounded away the decision variable |
   | Marginal / effective rate | 1 dp | A projection, not an instruction |

2. **Null renders as `—` in the units position**, right-aligned with the rest of the column,
   never blank and never `$0` (an unknown balance is not a zero balance).

3. **Negative uses U+2212 MINUS SIGN, never a hyphen.** In tabular figures U+2212 carries a
   digit advance; `-` does not, so a hyphen shifts the whole cell left by a fraction of a
   digit and the column stops aligning. `−$18,420`.

4. **Sign is always rendered where direction is meaningful** — `+$4,900`, `−$18,420`. Not
   optional, not colour-dependent (§3.3).

5. **Numeric column headers right-align with their column.** A `CURRENT` header left-aligned
   over right-aligned figures is the single most common table defect; it breaks the vertical
   edge the eye tracks.

6. **Digits never wrap, labels always may.** `white-space: nowrap` on `[data-numeric]`;
   identifier columns wrap freely via `overflow-wrap: anywhere` on the identity name.

### 2.4 Scale

Eight steps. Headings occupy the *bottom* of the scale; figures occupy the top.

| Token | Size | Role |
|---|---|---|
| `--type-micro` | 0.6875rem (11px) | Section rules, column headers, badges. Uppercase, `0.08em` tracking, weight 600 |
| `--type-xs` | 0.75rem (12px) | Meta lines, footnotes, secondary row text |
| `--type-sm` | 0.8125rem (13px) | Table body, form help |
| `--type-base` | 0.9375rem (15px) | Prose, form inputs |
| `--type-md` | 1.0625rem (17px) | Emphasised table figures (waterfall residual, totals row) |
| `--type-lg` | 1.375rem (22px) | Card-level figures |
| `--type-readout` | 1.875rem (30px) | Readout-strip stat values |
| `--type-page` | 1.0625rem (17px) | The page title in the app bar — deliberately *small* |

Note the last row. In an instrument, the page title is a wayfinding label, not a headline.
`Settings` at 48px, as the old build had it, is a poster; at 17px with the wordmark it is a
tab label, which is what it is.

Prose is capped at `--measure: 62ch`. Tracking tightens as size grows
(`-0.005em` → `-0.02em`) and loosens for micro-caps (`+0.08em`).

---

## 3. Colour

### 3.1 Ground and ink (unchanged from the DuganLabs parent)

| Token | Value | Notes |
|---|---|---|
| `--bg` | `#0F0E0C` | Page ground. Parent charcoal, untouched |
| `--surface` | `#191714` | Card ground |
| `--surface-2` | `#221F1B` | Inputs, table headers, inset panels |
| `--surface-3` | `#2C2924` | Hover / pressed |
| `--ink` | `#F0EDE4` | Primary. 16.48:1 on bg, 12.37:1 on surface-3 |
| `--ink-muted` | `#A8A093` | Labels, secondary. 7.46 / 6.91 / 6.34 / 5.60:1 on bg/s1/s2/s3 |
| `--ink-dim` | `#968F82` | Tertiary, disabled-adjacent. 6.02 / 5.58 / 5.12 / 4.52:1 |

The surface ramp was **rehued**. It used to be `#141821 / #1c2230 / #242b3c` — cool navy
cards floating on a warm near-black page. The mismatch is visible as a blue cast on every
card edge. The new ramp holds the ground's warm hue and only lifts luminance, so a card
reads as *paper on the desk* rather than a chip pasted on top.

`--ink-dim` is the floor: 4.52:1 on `--surface-3`, its worst pairing. Nothing tertiary sits
on anything lighter.

### 3.2 The accent, and why it moved

`--accent: #6FB7CE` — a desaturated steel-cyan. 8.58:1 on `--bg`, 7.30:1 on `--surface-2`.
Its dark ink `--accent-ink: #0F0E0C` is 8.58:1 on the accent fill, so the primary button
passes AA as text and AAA as a large control.

Two reasons, and the second is the load-bearing one.

**(a) It was byte-identical to Greenput's.** See §1.

**(b) Green cannot be both the brand and the semantics.** In a financial instrument green
*means* gain. If green is also the hue of every link, every button, the focus ring and the
active nav item, then green appears a hundred times a screen for reasons unrelated to money,
and the one colour that must be reserved is spent. The old build reached the reductio:
`Total liabilities $747,490` rendered in gain-green.

The accent must therefore sit outside the money triad — not green (gain), not red (loss),
not amber (caution). Cool cyan also gives the warm charcoal a single cold counterpoint,
which is what an anodised instrument face looks like, and it is distinct from the org's
existing cool accent (`ralph-station` `#5EA0E8`, a markedly bluer sky).

**The accent's entire budget:** focus ring, primary-button fill, active-nav underline,
links. Four uses. It does not appear on figures, on table rows, or on data marks — if it
did, it would start reading as a value.

### 3.3 Financial semantics

| Role | Token | Value | Means |
|---|---|---|---|
| Gain | `--gain` | `#8FDCA8` | Money in, yield, FICA saved, surplus, headroom |
| Loss | `--loss` | `#FF6B8A` | Money owed, principal, cost, a crossed threshold |
| Caution | `--caution` | `#FFC966` | Approaching a threshold, an APR above the avalanche line, due soon |
| Neutral | `--ink` | `#F0EDE4` | **The default for every figure.** A fact is not a direction |

`--gain` doubles as the success state for an operation (`Configured · production · updated
8/30`), which is the one place it is not about money. That is a deliberate overload: a
success state and a gain are the same kind of good news, and giving operations a fifth hue
would cost more than it buys.

Contrast, computed:

| | on `--surface` | on `--surface-2` | on `--surface-3` |
|---|---|---|---|
| `--gain` | 11.05:1 | 10.13:1 | 8.95:1 |
| `--loss` | 6.58:1 | 6.03:1 | 5.33:1 |
| `--caution` | 11.75:1 | 10.78:1 | 9.52:1 |

All AA at body size, with headroom for the 13px table body.

**Most figures are `--ink`.** MAGI, marginal rate, principal, min/mo, gross — these are
positions, not directions, and colouring them is the mistake the old build made. Colour
attaches only to a *direction* or a *state*: a delta, a saving, a crossing, an exception.

### 3.4 Colour is never the carrier — and here is the measurement

The gain/loss pair is the canonical red-green problem. Measured with the OKLab CVD model in
`dataviz/scripts/validate_palette.js` against `--surface-2`:

| Gain candidate | vs `--loss #FF6B8A`, deuteranopia ΔE |
|---|---|
| `#4EAF7C` (the old accent) | **2.4** — indistinguishable |
| `#3FD0A8` | 5.2 |
| `#6BD69B` | 6.7 |
| **`#8FDCA8` (chosen)** | **10.2 — PASS** |

`#8FDCA8` was selected specifically because it is the step that clears the ΔE ≥ 8 bar
against the loss rose. But clearing it is not licence to rely on hue, because a 10.2 ΔE is a
pass, not a guarantee — and forced-colors mode, greyscale print and a screen reader have no
hue at all.

So **every semantic colour is paired with a non-colour carrier**, structurally:

| Carrier | Where |
|---|---|
| Rendered sign (`+` / `−`, U+2212) | Every directional figure |
| A text badge | `AVALANCHE TARGET`, `CROSSED`, `BREAK-EVEN`, `OVER LINE` — text, never a bare dot |
| Column position + header | Liabilities sit under an `Owed` header inside a `LIABILITIES −` group |
| A group rule and caption | Accounts split above/below an `Assets` / `Liabilities` rule, netting to a total |
| `aria-label` on every mark | Bars and meters are `aria-hidden`; the figure beside them is the accessible value |

Remove all colour from a PendingBusiness screen and every number still states its direction.
That is the test.

Note also what the validator flags that we accept: `--accent` and `--gain` sit at ΔE 13.7
for normal vision, below the categorical floor of 15. That check governs *categorical series
in one chart*. These two never co-occur as series — the accent is chrome and never encodes a
value (§3.2) — so the pairing never arises. Documented, not ignored.

### 3.5 Borders and rules

Borders are ink at an alpha, never a separate grey — so they track the surface they sit on.

- `--rule-hair` — `ink @ 8%`. Row separators. Present but below conscious notice.
- `--rule` — `ink @ 14%`. Card edges, input borders, section rules.
- `--rule-strong` — `ink @ 26%`. Under a table header; above a totals row.
- **Double rule above totals** — the accounting convention, rendered as a 3px
  `border-block-start` in `--rule-strong` plus the row's own hairline. It is the one piece of
  ornament in the system and it earns its place: it tells you where the arithmetic ends.

---

## 4. Density and rhythm

A 4px base unit; every space token is a multiple.

`--space-1` 4px · `--space-2` 8px · `--space-3` 12px · `--space-4` 16px · `--space-5` 20px ·
`--space-6` 24px · `--space-8` 32px · `--space-10` 40px.

Table density is **pointer-conditional**, not viewport-conditional — the distinction matters,
because a touchscreen at 1280px still needs finger-sized rows and a trackpad at 390px does
not.

```css
:root { --row-y: var(--space-2); --cell-x: var(--space-3); --touch-target: 48px; }
@media (pointer: coarse) {
  :root { --row-y: var(--space-3); }
}
```

That yields a ~36px table row on a desk and ~44px on a phone, from one token.

**Interactive controls are exempt from the compression.** `--touch-target` stays 48px on
every pointer: buttons, inputs and selects all take `min-block-size: var(--touch-target)`.
Shrinking them would still clear WCAG 2.5.8's 24px floor, but the density win here is in the
ledgers — which are not touch targets — so there is no reason to spend target size on it.

Card padding is `--space-5` (20px), down from 24px. Section-to-section gap is `--space-5`.
The dashboard is deliberately tighter than a marketing page and slightly looser than a
spreadsheet.

### Layout

- App bar: 52px, sticky, `--surface` with a `--rule` underline.
- Readout strip: full-bleed on `--bg`, no card — it is the instrument face, not a widget.
- Content: `max-inline-size: 84rem`, centred; padding `clamp(16px, 3vw, 32px)`.
- Ledger board: `grid-template-columns: repeat(auto-fit, minmax(30rem, 1fr))` above 78rem,
  with `[data-span="full"]` on the wide tables (liabilities, accounts, waterfall). Nine
  identical stacked slabs become a two-column board you can scan.

---

## 5. Tables

The tables *are* the product. Rules, in priority order.

1. **Render through `renderTable` from `@basenative/components`.** Not a hand-rolled
   `<table>`. Gaps in the renderer go upstream (§8), not into local markup.

2. **Numeric columns right-align; their headers right-align with them.** Declared per column
   (`numeric: true`), never by nth-child.

3. **Fixed column geometry.** `table-layout: fixed` plus an explicit width per column, so a
   value changing from `$9,999` to `$142,310` does not reflow the table. Numbers that jump
   sideways while you read them are the difference between an instrument and a web page.

4. **Header treatment.** `--type-micro`, uppercase, `+0.08em`, `--ink-muted`, on
   `--surface-2`, with a `--rule-strong` underline. Sticky within a scrolled table body.

5. **Row rhythm.** `--rule-hair` between rows; zebra at `ink @ 2.5%` — enough to track a wide
   row across, not enough to read as stripes. Hover lifts to `--surface-2`.

6. **Totals row in `<tfoot>`**, above a double rule, at `--type-md`/600. Present on income
   (gross), liabilities (principal, min/mo) and accounts (net position). Their absence in
   the old build is why you had to add the column up yourself.

7. **Emphasis is singular.** `data-row="emphasis"` marks *one* row — the avalanche target,
   the S-Corp break-even. The old build emphasised every S-Corp row with savings over
   $2,000, which was all four, so the whole table rendered green and the break-even — the
   only interesting row — was invisible. If more than one row qualifies, the rule is wrong.

8. **Magnitude bars.** A 3px right-anchored bar beneath the figure, width
   `calc(var(--v) * 100%)` where `--v` is the value over the column max. `ink @ 38%` —
   **neutral, not accent and not semantic**, because a bar's length already encodes
   magnitude and colouring it by magnitude double-encodes (and would make the accent read as
   a value). `aria-hidden`; the figure beside it is the accessible value. On: principal,
   gross, FICA saved, and each waterfall step.

   **No track.** The first cut drew one, and every row then looked the same length with a
   darker stub on the right end — because a track states a maximum, and the maximum here is
   "the widest value in this column", not the cell. Bar length alone, so a short bar is
   unambiguously a small number. (A *meter* is different — see §7 — because a meter genuinely
   has a scale, and it keeps its track.)

9. **Row identity before row data.** The first column is always the thing's name, at
   `--ink`/600, with its qualifier (`employer`, `institution · ····4417`) on a second line at
   `--type-xs`/`--ink-dim`.

### States

| State | Treatment |
|---|---|
| Loading | `renderSkeleton` rows at the table's real column widths and row count, so the layout does not jump when data lands. `aria-busy="true"` on `<tbody>`; a `<caption>`-level live region announces "Loading". Pulse respects `prefers-reduced-motion` |
| Empty | A single full-width cell: one sentence of plain English plus, where there is one, the action that fixes it (`Connect a bank →`). Centred, `--ink-muted`, 2× row padding |
| Error | `renderAlert` (`variant: error`) inside the section, above the table, carrying the actual failure and a `Retry` button that re-runs that one fetch. Not a toast, not a status line at the bottom of the page. `role="alert"` |
| Stale | Where a figure has a sync time, a `--type-xs` `--ink-dim` meta line on the section header (`synced 06:12`), rising to `--caution` past 24h with the text `stale · 2d` |

### Mobile — the record-card transform

Below 32rem of *container* width — the section, not the viewport, so the two-column ledger
board at 1440px keeps real tables — a table is not a table. The old build hid `<thead>` and pushed the header into
`td::before`, which is the right *idea* — the data was labelled, not a zig-zag — but the
result was 7,000px of undifferentiated label/value pairs with no boundary between records.
Six liabilities read as thirty-six anonymous lines.

The transform now produces a **record card** per row:

```
┌──────────────────────────────────────────┐
│ Chase Sapphire                  $18,420  │   ← identity + primary figure, one line
│ credit card · ◆ AVALANCHE TARGET         │   ← qualifier + badge
│ ────────────────────────────────────────  │
│ APR                              24.49%  │   ← remaining fields, 2-col grid
│ Min / mo                           $465  │
└──────────────────────────────────────────┘
```

- Each record gets a real boundary (`--surface-2` ground, `--rule` border, `--radius-sm`).
- The identity column and the column marked `primary: true` are promoted to the head line;
  the head figure is `--type-md`/600.
- Everything else is a labelled `minmax(8rem, 40%) 1fr` grid — label `--type-micro`
  uppercase `--ink-muted`, value right-aligned tabular.
- **No column is dropped.** Hiding data on a small screen is a decision the operator did not
  make.
- `<thead>` is `display: none` but stays in the DOM, and every cell keeps `data-label`, so
  the accessibility tree is unchanged.

---

## 6. Forms

The old forms shouted and lied about size: every label uppercase and letterspaced (a
treatment reserved here for table headers), every input 640px wide regardless of content, a
two-letter state field the width of an email field.

1. **Labels are sentence case, `--type-sm`, `--ink-muted`, weight 500.** The *value* is the
   emphasised thing. Micro-caps stay in tables.
2. **Field width matches expected content.** `data-field="xs|sm|md|lg|full"` →
   `6rem | 12rem | 20rem | 30rem | 100%`. A 2-letter state input is 6rem. This is
   information, not decoration: a field's width tells you how much to type.
3. **Currency inputs** get a `$` adornment inside the field at `--ink-dim`, right-aligned
   tabular figures, and `inputmode="decimal"`. A number you type lines up with the number
   it produces.
4. **Help text sits under its label**, `--type-xs`/`--ink-dim`, inside the `<label>` — not as
   a paragraph above the form where it detaches from the field it explains.
5. **Errors are per-field.** `aria-invalid="true"` → `--loss` border plus a `--loss` message
   in the field's own `aria-describedby` target, with the error text naming the field. The
   old whole-form `box-shadow` told you something was wrong without telling you where.
6. **Pending state is on the button**, not a 0.7-opacity fade of the whole form (which reads
   as "disabled" and makes the labels you are trying to read harder to read). The button
   takes `aria-busy` → a spinner and its own label change; fields stay crisp.
7. **Auth pages are narrow, centred cards** (`max-inline-size: 26rem`, vertically centred),
   not full-width slabs above an acre of empty ground.

Controls: `--radius-sm` 5px, `--radius` 9px for cards. Focus is a 2px `--accent` ring at 2px
offset plus a 1px `--bg` inner ring, so it is visible on every surface including the accent
button itself.

---

## 7. Marks — bars, meters, waterfall

There is no chart library and there should not be one. Three marks, all pure CSS, all driven
by one custom property `--v` in `0..1`, all `aria-hidden` with the value in adjacent text.

**Magnitude bar** (§5.8). 3px, `--radius-pill`, `ink @ 22%`, one hue, `aria-hidden`.

**Threshold meter.** For "distance to the next tax threshold". Track is `ink @ 10%`; fill is
the same ramp stepped by *state*, which is genuine severity rather than a value ramp:

| State | Fill | Always accompanied by |
|---|---|---|
| > 10% headroom | `ink @ 45%` | `$89,500 away` |
| ≤ 10% headroom | `--caution` | `$12,000 away · CLOSE` |
| crossed | `--loss` | `CROSSED` badge |

**Waterfall.** The signature feature, and previously an eight-row table indistinguishable
from the liabilities list. Now it renders through the same ledger view layer as everything
else, and each step's amount carries a magnitude bar scaled to `grossIn` — so the routing
visibly steps down from the gross to the residual, readable in one glance, with the exact
figure to two decimals beside it.

Every step also renders its own sign (`$8,000.00` in, `−$2,640.00` to the tax reserve,
`−$429.00` to the avalanche, `$231.00` residual), so the arithmetic reads correctly with no
colour at all. The residual is the single emphasised row. It stays a real `<table>` with
`<th scope="row">` per step.

Marks are thin, recessive, and never labelled on every point. The table is the label.

---

## 8. Component boundary

The site renders through `@basenative/components` — `renderTable`, `renderBadge`,
`renderAlert`, `renderSkeleton`, `renderButton`, `renderDialog` — and themes them through
the `--bn-*` token bridge at the top of `styles.css`. It does not fork component CSS and
does not hand-roll a component the package owns.

Where the package cannot express something, the fix goes upstream. Two gaps found while
building this and filed as `DuganLabs/BaseNative` PR:

1. **`renderTable` has no column alignment or numeric affordance.** Every column renders
   left-aligned with proportional figures; a money column is impossible without wrapping
   each cell by hand in the `render` hook. Added: `align: 'start'|'end'|'center'` and
   `numeric: true` on a column (numeric implies end-alignment plus `tabular-nums`), emitted
   as `data-align` / `data-numeric` on both `<th>` and `<td>`.
2. **No `data-label` on cells**, so a responsive stacked layout cannot recover the column
   heading, and no `footer` rows, so a totals row is impossible. Added: each `<td>` carries
   `data-label` from its column label, and `footer: [...]` renders a `<tfoot>`. Also
   `emptyContent` as an HTML slot beside the existing text-only `emptyMessage`, so an empty
   state can carry its own call to action.

Filed as **DuganLabs/BaseNative#189** with a minor changeset (`align`/`numeric` on a column,
`data-label` on every cell, `footer` rows, `emptyContent`).

Until that version publishes, `apps/site/src/lib/table.ts` renders through the published
0.7.0 `renderTable` — which still owns structure, escaping, the caption and the empty state —
and a small `applyCompatPass()` adds exactly the four attributes the renderer cannot yet
emit. The pass is **self-removing**: it first checks whether the markup already carries
`data-label` and no-ops when it does, so the day the upstream release lands it simply stops
running.

---

## 9. Accessibility as a constraint, not a tax

- Every pairing introduced here was computed, and the numbers are in §3. Nothing is at 4.5:1
  by luck; the floor case is `--ink-dim` on `--surface-3` at 4.52:1 and nothing tertiary sits
  higher.
- Verified in a real browser rather than against the token table: every distinct
  foreground/background/size combination on all six pages was measured with alpha composited
  through the ancestor chain — **82 combinations, 0 below AA**, lowest 5.12:1 (an 11px table
  caption). `axe-core` (wcag2a/aa, wcag21a/aa, wcag22aa, best-practice) reports **0
  violations** at 1440×900 and 390×844 across all six pages, and there is no horizontal
  overflow at 1440 / 390 / 320.
- Direction is never hue-only (§3.4), with the ΔE measurement that forces the rule.
- Target size is not traded for density (§4): every interactive control stays at 48px on
  every pointer. Only *table row* height is pointer-conditional, and a row is not a target.
- Landmarks, `scope`, `aria-current`, `aria-live`, `aria-busy` and the existing focus order
  are preserved exactly; the change is presentational. Tables keep their `<thead>` in the DOM
  at every width.
- `prefers-reduced-motion` suppresses the skeleton pulse, the bar transitions and the view
  transition.
- Bars and meters are `aria-hidden`; their value is always in adjacent text.
