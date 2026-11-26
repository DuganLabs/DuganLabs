# Accessibility: WCAG 2.2 AA

- **Contrast.** Text is at least 4.5:1 (large text 3:1). Accent and ink pairs are checked by
  `validateContent` and the `accent/ink pairs meet WCAG AA` test, and CI fails on a bad theme.
- **Links in text** are underlined, never distinguished by colour alone (Lighthouse
  `link-in-text-block`).
- **Forms.** Every input has a programmatic label. Errors are announced (`role="alert"`)
  and are linked to the field. Consent is a real checkbox, never pre-checked.
- **Keyboard.** All actions are reachable, with a visible `:focus-visible` ring.
  A skip link goes to main content.
- **Structure.** Each page has one `h1`, landmarks (`header`, `main`, `footer`, `nav`)
  and `lang` set.
- **Motion** respects `prefers-reduced-motion`.
- **Checked by:** Lighthouse accessibility = 100 locally, at least 95 in production
  (`tools/audit/post-deploy.sh`).
