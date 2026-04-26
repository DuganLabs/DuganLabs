# Setting up the DuganLabs org-level Project board

## One manual step

Creating an org-level GitHub Project requires the `project` OAuth scope on your `gh` token, which can't be granted non-interactively. Run this once:

```bash
gh auth refresh -s project,read:project
```

Browser opens, you confirm. After that, all subsequent `bn gh board` and `gh project` calls work.

## Create the org-level board

```bash
gh project create --owner DuganLabs --title "DuganLabs Roadmap"
```

Note the project number that's printed (e.g. `1`). All commands below use `<NUM>`.

## Recommended fields

```bash
# Status (single-select): Backlog / Spec / Plan / In Progress / Review / Shipped
gh project field-create <NUM> --owner DuganLabs --name Status --data-type SINGLE_SELECT \
  --single-select-options "Backlog,Spec,Plan,In Progress,Review,Shipped"

# Phase (single-select): M0 / M1 / M2 / M3 / M4
gh project field-create <NUM> --owner DuganLabs --name Phase --data-type SINGLE_SELECT \
  --single-select-options "M0,M1,M2,M3,M4"

# Project (single-select): basenative / t4bs / pendingbusiness / greenput / warrendugan / ralph-station / warren-sys / duganlabs
gh project field-create <NUM> --owner DuganLabs --name Project --data-type SINGLE_SELECT \
  --single-select-options "basenative,t4bs,pendingbusiness,greenput,warrendugan,ralph-station,warren-sys,duganlabs"

# Size (single-select): S / M / L
gh project field-create <NUM> --owner DuganLabs --name Size --data-type SINGLE_SELECT \
  --single-select-options "S,M,L"
```

## Auto-add issues from member repos

In the Project's web UI: Settings → Workflows → "Auto-add to project" → enable for each project repo (basenative, t4bs, etc.) with filter `is:issue`.

This is one of the rare items that's easier in the UI than the API, but it sticks once configured.

## Auto-move on PR events

Same Workflows panel: enable the built-in "Item closed" → set Status to **Shipped**, "PR merged" → set Status to **Shipped**, "Issue reopened" → set Status to **Backlog**.

## Verify

```bash
gh project view <NUM> --owner DuganLabs
gh project field-list <NUM> --owner DuganLabs
```

## What lives where (after setup)

- **GitHub Project board** — operational state. What's in flight, what's next, what shipped.
- **`docs/PRD.md` per project** — canonical design intent. Issues reference PRD sections.
- **Issues** — concrete units of work tied to PRD sections. Auto-labeled by path. Auto-closed on PR merge.
- **Milestones** — phase markers (M0/M1/M2/...). Auto-close when last issue resolves.
- **PRs** — the work itself. Body uses `Closes #N` to wire the auto-close.

When all four are honest with each other (and the automation is on), looking at the Project board *is* the same as looking at reality.
