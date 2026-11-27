# AGENTS.md

Instructions for coding agents working in this repo. The full project rules
(product, wording, privacy and deploy rules) live in [CLAUDE.md](CLAUDE.md),
and they apply to every agent, not only Claude. This file adds the web
platform policy and the local browser check.

## Browser support: Baseline target

This project's Baseline target is Baseline Widely available.

Use a web platform feature (HTML, CSS, JavaScript or a Web API) without a
fallback only when it is Baseline Widely available. Anything newer needs
progressive enhancement or a fallback, and the PR should say so.

## Modern Web Guidance

Install the [Modern Web Guidance](https://github.com/GoogleChrome/modern-web-guidance)
skill locally before writing or reviewing HTML, CSS or front-end JavaScript,
and follow it within the Baseline target above:

```sh
DISABLE_TELEMETRY=1 npx modern-web-guidance@latest install
```

It writes `.agents/skills/modern-web-guidance/` and `skills-lock.json`.
Both are gitignored here, like every marketplace skill (see `.gitignore`),
so don't commit them.

## Chrome DevTools MCP: local pre-deploy check

Before you open a PR that changes a page, check it in a real browser with
[Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp).
It is a local check only. CI does not run it, and nothing here deploys.

Always run it against a fresh, throwaway Chrome profile:

- Pass `--isolated`, which creates a temporary user-data-dir and deletes it
  when the browser closes. Alternatively, pass `--userDataDir` pointing to a
  new empty temp directory.
- Never pass `--autoConnect`, and never point it at your everyday Chrome
  profile. The agent must not see a signed-in session, cookies or saved
  passwords.
- Pass `--no-performance-crux`, so performance traces don't send page URLs to
  the CrUX API.
- Point it at a local dev server or a preview/staging URL. Use production
  only for read-only checks.

Example MCP config (`.cursor/mcp.json`, `.mcp.json` or your client's
equivalent; keep it in your user config, not in the repo):

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest",
        "--isolated",
        "--headless",
        "--no-performance-crux"
      ]
    }
  }
}
```

Drop `--headless` to watch the browser. A typical check: open the changed
page, list console messages and failed network requests, take a screenshot
at mobile and desktop widths, and run a performance trace. Fix anything new
before pushing. The post-deploy Lighthouse run in CI (including its Agentic
browsing category) covers the same pages after merge.
