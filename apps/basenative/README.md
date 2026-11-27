# BaseNative (apps/basenative)

BaseNative's own Nx/pnpm/changesets workspace lives in `workspace/`, imported with
history from DuganLabs/BaseNative. Root Nx ignores it (`.nxignore`) and sees only
this wrapper `project.json`.

- Checks + deploy: `.github/workflows/basenative.yml`. The deploy job is gated by the repo
  variable `BASENATIVE_DEPLOY_ENABLED`.
- Releases: `.github/workflows/basenative-release.yml`, environment `prd`. It's gated by
  `BASENATIVE_RELEASE_ENABLED`, which stays off until npm trusted publishing names this repo.
- Secrets: Doppler `duganlabs/repository` only (`workspace/doppler.yaml`).
- Package list: `packages.txt` (45 published `@basenative/*` packages).
