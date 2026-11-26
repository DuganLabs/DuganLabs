# DuganLabs

Every Dugan Labs domain lives here as `apps/<domain>` and runs on Cloudflare Workers:
greenput, pendingbusiness, basenative, t4bs, warrendugan, duganlabs, boxsized,
hipowerinc, theduganhouse, visitnorthwood and warrenmd.
The repo also holds the shared coming-soon kit (`libs/coming-soon`), the lead store
(`apps/leads`), and the standards and control plane for all of them.

- **Rules:** [AGENTS.md](AGENTS.md) and [standards/](standards/README.md)
- **CI/CD:** [.github/workflows/ci.yml](.github/workflows/ci.yml): Nx affected, build once,
  staging -> production
- **Infra:** [infra/cloudflare](infra/cloudflare) (Access, Turnstile, D1)

Packages for BaseNative are published from the separate public
[BaseNative](https://github.com/DuganLabs/basenative) repository; only its website lives here.

This repository is public. It contains no secrets and no personal data.
Found a security issue? Use GitHub's private vulnerability reporting on this repo.
