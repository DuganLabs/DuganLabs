#!/usr/bin/env node
// Build once: bundle an app's Worker into dist/apps/<app>/ with wrangler's
// own bundler (dry run, no network, no credentials). The same bytes are later
// deployed to staging and production by tools/deploy/deploy.sh --no-bundle.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const app = process.argv[2];
if (!app) { console.error('usage: build-worker.mjs <app>'); process.exit(2); }
const cfg = JSON.parse(readFileSync(`apps/${app}/deploy.json`, 'utf8'));
const out = resolve(`dist/apps/${app}`); // absolute: wrangler resolves a relative --outdir against the config's folder
rmSync(out, { recursive: true, force: true });
execFileSync('pnpm', ['exec', 'wrangler', 'deploy', '--dry-run', '--outdir', out, '-c', cfg.config, '--env='], { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } });
if (!existsSync(resolve(cfg.artifact))) { console.error(`expected artifact ${cfg.artifact} was not produced`); process.exit(1); }
console.log(`built ${app} -> ${cfg.artifact}`);
