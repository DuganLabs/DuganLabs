# Backlog

One file per unit of work. A session with none of the originating
conversation in context should be able to read one ticket and execute it
without rediscovering anything — that is what these are for, and a ticket
that does not meet that bar is not finished.


**Sources.** Most of these come from the 2026-09-12 journey audit, which
drove every product as a user and reproduced each defect. Each was then
re-verified against main before being written down, so a ticket here is a
defect that still existed at that commit — not an audit note.


**Conventions.** `status` is `open` until the fixing PR merges, then the
file is deleted (git history is the archive). `decision` names a question
only the owner can answer; those are blocked, not stalled. `depends_on`
means what it says — do not start a ticket whose dependencies are open.
Every `file:line` in a ticket was read before it was written; if one is
stale, fix it in the same PR that discovers it.


## Blocked on a decision

- [`GP-008`](GP-008.md) — Every Send action only flips a status, invited teammates have no way to ever sign in, and the working invoice renderer and proposal page are linked from nowhere
  - **Hand the contractor a link to send themselves (owner, 2026-09-12). No sending provider for now.**
- [`GP-011`](GP-011.md) — Tenant micro-sites assert licensing, insurance, fixed hours, 24/7 emergency cover and free estimates in the contractor's name from no data
  - **Hide every claim the contractor has not backed with data (owner, 2026-09-12).**
- [`GP-022`](GP-022.md) — The public tenant site serves the contractor's asset register — serials, condition, location and the assigned employee's name — with no authentication
  - **Move the scanner behind authentication in the platform (owner, 2026-09-12).**
- [`GP-034`](GP-034.md) — The Technicians report joins created_by because jobs have no assignee, and the two lead counts on /campaigns and /reports are different numbers with the same name
  - **Should Greenput track which technician does each job (so the Technicians report and the calendar's tech filter mean something), or should that report tab be removed until it does?**
- [`GP-038`](GP-038.md) — Estimate line-item types are smuggled as a text prefix, so the customer's proposal reads "[labor] …"
  - **Should the labor/material split appear on the document the homeowner reads (as its own column), or should it stay an internal costing detail and be dropped from the proposal and invoice entirely?**
- [`GP-039`](GP-039.md) — Six onboarding answers never leave the browser, the multi-select service list collapses to its first entry, and one step offers integrations that do not exist
  - **Of the four things signup asks for and then throws away — service area and radius, team size, brand colour, and third-party integrations — which should the product actually keep, and which steps should be deleted from signup?**
- [`GP-045`](GP-045.md) — greenput.com/pricing's search snippet, its FAQ and the site-wide Get Started button each describe a different product
  - **Can a contractor sign themselves up on greenput.com today and start using the product without talking to us first, or does every new contractor have to go through a setup conversation?**

## Blocking

- [`GP-006`](GP-006.md) (medium) — Every list stops at 25 rows with no pager, and the Jobs calendar filters that same 25-row page so a week with work in it can render empty
- [`GP-103`](GP-103.md) (medium · after [GP-101, GP-102, GP-104]) — The quote ends at a price — the homeowner cannot book the job they were just quoted
- [`GP-104`](GP-104.md) (small · after [GP-101]) — Double-booking is promised four times on greenput.com and prevented nowhere
- [`GP-105`](GP-105.md) (medium · after [GP-103]) — Only the contractor can withdraw a lead, so the fee waiver depends on the party who owes the fee
- [`GP-106`](GP-106.md) (medium) — The entire lead billing lifecycle — including the click that charges a contractor — has no interface
- [`GP-108`](GP-108.md) (medium) — The share-card rasterizer puts a 2.4 MB WASM module inside the API Worker that serves all authenticated traffic
- [`GP-110`](GP-110.md) (small · unblocked — GP-055 shipped chat) — Any signed-in user can send an SMS to any number in the world on the account owner's Twilio bill; the 410 holds until the proper `recipientUserId` fallback lands

## Serious

- [`GP-001`](GP-001.md) (small) — Span quote outcomes print raw terminal ids to homeowners, and a spread refusal shows the priced terminal's copy
- [`GP-003`](GP-003.md) (large) — No entity has a detail route or edit form, so anything captured wrong can never be corrected, and nothing but vehicles can be deleted
- [`GP-004`](GP-004.md) (medium) — Both contact forms have no action or method, so a no-JS submission GETs the page and puts name, email and message in the URL
- [`GP-014`](GP-014.md) (medium) — The quote form has no way back and no way to restart, and the browser Back button silently re-renders the current question
- [`GP-015`](GP-015.md) (medium) — New opportunity always 400s on a hidden leadId, and New job / New estimate demand UUIDs typed by hand
- [`GP-017`](GP-017.md) (small) — Every report drops the last day of its own window — a date-only `to` compared with <= against full ISO timestamps
- [`GP-023`](GP-023.md) (small) — "?slug= overrides the subdomain on production hosts, so demo.greenput.com serves another contractor's site and files the leads it captures into the demo workspace"
- [`GP-109`](GP-109.md) (small) — Two different contractors can be given byte-identical logos

## Annoying

- [`GP-037`](GP-037.md) (medium) — Convert to job schedules the job for the instant of the click with zero duration, with no date picker and no confirmation
- [`GP-040`](GP-040.md) (small) — Four tenant error pages are dead ends with no links, one of them naming a page it does not link to
- [`GP-041`](GP-041.md) (small) — The contractor's phone number prints as raw E.164 on every tenant page
- [`GP-046`](GP-046.md) (small) — The plugin marketplace has no rows in any database built from this repo, and its empty state blames filters the user never set
- [`GP-048`](GP-048.md) (small) — Settings → Billing never shows a renewal date or a plan, and the Stripe portal button fails with no message at all

## Cosmetic

- [`GP-056`](GP-056.md) (small) — A refused recovery number is still explained as a missing US area code, whatever the actual reason
- [`GP-062`](GP-062.md) (small) — The dashboard's "Week view" button opens the Jobs list, and the calendar has no addressable URL

---

36 open tickets.
