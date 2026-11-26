# Deploy

- **Build once:** `node tools/deploy/build-worker.mjs <app>` writes `dist/apps/<app>/index.js`
  (wrangler bundler, dry run, no credentials).
- **Deploy the same bytes:** `bash tools/deploy/deploy.sh <app> <staging|production> [--dry-run]`
  reads `apps/<app>/deploy.json` and runs `wrangler deploy --no-bundle`.
- `deploy.json`: `kind` (worker|pages), `config`, `artifact`, and `stages.{staging,production}`
  with `env`, `url` and optional `blocked` (a reason; the stage is skipped with a notice).
  `lighthouse` lists the paths for the post-deploy audit.
- **Order on first rollout:** `leads` (D1 migration first) -> each site's staging -> Warren
  checks -> production.
- **Cut-over for the six live sites** (greenput, pendingbusiness, basenative, t4bs,
  warrendugan, duganlabs):
  1. Create the Access app for `private.<domain>` (Terraform).
  2. Move the existing site's route to `private.<domain>` and verify it is protected.
  3. Remove `blocked` from the coming-soon app's production stage and deploy it to apex + www.
  4. Check DNS: the apex/www custom domains belong to the new Worker.
     Mail records (MX/SPF/DKIM) are never touched.
- **GreenPut:** only the marketing site moves. `app.`, `api.`, `demo.`, `brand.` and tenant
  subdomains stay public; reserve the tenant slug `private`.
- **PendingBusiness:** at `private.pendingbusiness.com`, keep `RP_ID = "pendingbusiness.com"`
  (existing passkeys stay valid) and set `RP_ORIGIN = "https://private.pendingbusiness.com"`.
