# PRD template

Use this as the canonical structure when running `bn prd init` (or hand-authoring) a PRD for any DuganLabs project. Match the section headers exactly so issue/milestone tooling stays compatible across the org.

```markdown
# {{PROJECT}} — Product Requirements Document

> Status: **draft** · Owner: {{OWNER}} · Last updated: {{DATE}}
>
> This PRD is the canonical source of truth for what {{PROJECT}} is, who it's for, and what it does. Issues and milestones in [DuganLabs/{{REPO}}]({{REPO_URL}}) reflect this document — when reality drifts, update the doc *and* the issues.

---

## 1. Overview

{{ONE-PARAGRAPH OVERVIEW}}

### One-line pitch
"{{PITCH}}"

---

## 2. Goals

1. {{GOAL 1}}
2. {{GOAL 2}}
3. {{GOAL 3}}

## Non-goals

- {{NON-GOAL 1}}
- {{NON-GOAL 2}}

---

## 3. Users

### Primary
{{PRIMARY USER PERSONA}}

### Secondary
{{SECONDARY USER PERSONA, IF ANY}}

---

## 4. Key flows

### 4.1 {{FLOW NAME}}
1. {{STEP}}
2. {{STEP}}

### 4.2 {{FLOW NAME}}
...

---

## 5. Data model

| Table | Purpose | Key fields |
|---|---|---|
| {{TABLE}} | {{PURPOSE}} | {{FIELDS}} |

---

## 6. Design principles

- {{PRINCIPLE}}
- {{PRINCIPLE}}
- **Color tokens:** {{TOKENS}}
- **Type:** {{FONTS}}

---

## 7. Architecture

### Today
- {{STACK}}

### Target
- {{TARGET STACK, REFERENCES @basenative/* PACKAGES}}

---

## 8. Milestones

> Each milestone maps 1:1 to a GitHub milestone.

### M0 — {{NAME}}
- {{ITEM}}
- {{ITEM}}

### M1 — {{NAME}}
...

---

## 9. Open questions

- {{QUESTION}}

---

## 10. Glossary

- **{{TERM}}** — {{DEFINITION}}
```

## Conventions

- **Section numbers are stable.** Issues reference `PRD §4.1` to point at a specific flow. Renumbering breaks links.
- **Milestone names match exactly.** GitHub milestone titles equal the `## M0 — Name` heading. `bn prd sync` uses these to create/update milestones.
- **Flows are user-visible behaviors.** Implementation lives in issues, not the PRD.
- **Open questions** are for the human reader — they don't generate issues automatically.

## See also

- [t4bs/docs/PRD.md](https://github.com/DuganLabs/t4bs/blob/main/docs/PRD.md) — fully-populated reference example.
- [DuganLabs/.github](https://github.com/DuganLabs/.github) — issue templates that pair with this PRD format.
