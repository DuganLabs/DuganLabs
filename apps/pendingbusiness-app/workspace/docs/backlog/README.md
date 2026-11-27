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

## Open

None. Every ticket from the 2026-09-12 audit has merged; the files are in git
history (`git log --diff-filter=D -- docs/backlog/`). Add the next one as
`PB-NNN.md` here and list it in this section under the heading that fits
(`Open`, or `Blocked on a decision` with the question as a sub-bullet).

---

0 open tickets.
