# Coming-soon pages

Each domain's root is a standard landing page built from `apps/<app>/content.json`
by `createSite(content)` from `libs/coming-soon`.

## content.json
Validated by `tools/scripts/check-content.mjs` (Nx `check` target):

| Field | Required? | Rules |
|---|---|---|
| `name`, `domain` | Required | |
| `source` | Required | Lead tag, `[a-z0-9-]` |
| `status` | Required | `coming-soon`, `private-beta` or `todo`. A `todo` app carries no copy. |
| `theme.accent`, `theme.accentInk` | Required | `accentInk` on `accent` must be at least 4.5:1. Dark variants are optional. |
| `headline`, `idea` | | One line each. Real facts only. |
| `points` | | None, or exactly 3 `{icon,title,body}` |
| `visual.rows` | | Optional, 2–4 |
| `form` | | `false` hides the lead form (for example theduganhouse) |
| `noindex`, `eyebrow`, `cta`, `placeholder`, `parentLabel` | | Optional |
| `privateUrl` / `privateLabel` | | Where the previous site lives (`https://private.<domain>/`) |
| `leadsScope` | | `self` (default) or `all` (duganlabs: every source) |

## Lead capture
- Form: `POST /api/lead` on the site Worker. The server sets `source`, `host`, IP and UA, and
  forwards to `dl-leads` over the `LEADS` service binding along with its Turnstile sitekey.
- `dl-leads`:
  - verifies Turnstile and fails closed;
  - stores a salted IP hash, never the IP;
  - rate-limits to 5 per 10 minutes per IP;
  - treats a duplicate `(email, source)` as a silent success.
- **Consent text:** "Email me about {name}. No spam; unsubscribe anytime. Privacy."
  It contains no personal email. `/privacy` is a generic statement.
  `CONSENT_VERSION` is stored with each lead.

## Private area
- `/login` explains, then goes to `/app/`. Cloudflare Access protects `/app*` (Warren only).
- The Worker re-verifies the Access JWT (RS256, `aud`, `iss`, `exp`) against `OWNER_EMAILS` (a secret).
- `/app/` is a hub that links to the leads view and the previous site.
- `/app/leads` offers stats, source chips, search and CSV export (formula-injection safe).
