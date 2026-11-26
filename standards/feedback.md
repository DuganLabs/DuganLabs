# Feedback loop (before anything is shown to Warren)

1. `nx run-many -t check test build` is green, and `bash tools/ci/guard.sh` reports ok.
2. Run the leads Worker plus the site(s) locally (AGENTS.md commands).
3. Take screenshots with Playwright of each changed page:
   - desktop 1440×900 and mobile 390×844 @3x;
   - light and dark;
   - states: landing, joined, error, login, hub, leads.
4. Critique against `standards/design.md`. Fix, then re-shoot.
5. Lighthouse mobile and desktop. Every category must be at least 95 (SEO exempt for noindex).
6. Report: what changed, screenshots, scores, and what is not done.
