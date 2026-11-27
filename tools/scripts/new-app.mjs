#!/usr/bin/env node
// Scaffold a standard DuganLabs domain app from the coming-soon kit.
//   node tools/scripts/new-app.mjs <domain> [--todo] [--live]
// Writes apps/<name>/{content.json,src/index.js,wrangler.toml,deploy.json,project.json,package.json}.
// Existing files are never overwritten.
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [domain, ...flags] = process.argv.slice(2);
if (!domain || !/^[a-z0-9-]+\.[a-z]{2,}$/.test(domain)) {
  console.error('usage: new-app.mjs <domain> [--todo] [--live]');
  process.exit(2);
}
const name = domain.split('.')[0];
const dir = join('apps', name);
const todo = flags.includes('--todo') || !flags.includes('--ready');
const live = flags.includes('--live'); // domain has a live site today; prod cut-over waits for its move to private.<domain>
mkdirSync(join(dir, 'src'), { recursive: true });
const put = (f, s) => {
  const p = join(dir, f);
  if (existsSync(p)) return console.log(`keep  ${p}`);
  writeFileSync(p, s);
  console.log(`write ${p}`);
};

const NEUTRAL = { accent: '#1d1d1f', accentInk: '#ffffff', accentDark: '#f5f5f7', accentInkDark: '#111113', accentStrongDark: '#f5f5f7' };
put('content.json', JSON.stringify(todo
  ? { name: domain, domain, source: name, status: 'coming-soon', todo: true, theme: NEUTRAL }
  : { name, domain, source: name, status: 'coming-soon', headline: `${name} is coming soon`, idea: `${domain} is currently in development.`, theme: NEUTRAL }, null, 2) + '\n');

put('src/index.js', `import { createSite } from '@duganlabs/coming-soon';
import content from '../content.json';

export default createSite(content);
`);

put('wrangler.toml', `# ${domain}: standard DuganLabs site Worker (libs/coming-soon).
# Config as code. Nothing here has been deployed; routes go live only with
# the owner's approval (PLAN.md D2 for live sites).
name = "dl-${name}"
main = "src/index.js"
compatibility_date = "2026-11-01"
workers_dev = false

observability = { enabled = true }

# Every public page is served by this Worker; /app/* is additionally behind
# Cloudflare Access (infra/cloudflare/access.tf).
routes = [
  { pattern = "${domain}", custom_domain = true },
  { pattern = "www.${domain}", custom_domain = true },
]

[[services]]
binding = "LEADS"
service = "dl-leads"

# Secrets (never committed; this repo is public). Pushed from Doppler
# duganlabs/repository at deploy with \`wrangler secret bulk\`:
#   OWNER_EMAILS   who may open /app (Access enforces it first)
[vars]
TURNSTILE_SITE_KEY = "TODO-phase3"          # public site key (infra/cloudflare/turnstile.tf)
ACCESS_TEAM_DOMAIN = "TODO.cloudflareaccess.com"
ACCESS_AUD = "TODO-phase3"                   # Access application AUD tag

[env.staging]
name = "dl-${name}-staging"
workers_dev = true
routes = []
[[env.staging.services]]
binding = "LEADS"
service = "dl-leads-staging"
[env.staging.vars]
TURNSTILE_SITE_KEY = "TODO-phase3"
ACCESS_TEAM_DOMAIN = "TODO.cloudflareaccess.com"
ACCESS_AUD = "TODO-phase3"
`);

put('deploy.json', JSON.stringify({
  $schema: '../../tools/deploy/deploy.schema.json',
  kind: 'worker',
  config: `apps/${name}/wrangler.toml`,
  artifact: `dist/apps/${name}/index.js`,
  stages: {
    staging: { env: 'staging', url: `https://dl-${name}-staging.duganlabs.workers.dev` },
    production: live
      ? { env: null, url: `https://${domain}`, blocked: `cut-over pending: move the current ${domain} site to private.${domain} (behind Access) first; see PLAN.md migration order` }
      : { env: null, url: `https://${domain}` },
  },
  lighthouse: ['/', '/login'],
}, null, 2) + '\n');

put('project.json', JSON.stringify({
  name,
  $schema: '../../node_modules/nx/schemas/project-schema.json',
  projectType: 'application',
  sourceRoot: `apps/${name}/src`,
  tags: ['scope:site', 'type:coming-soon'],
  implicitDependencies: ['coming-soon'],
  targets: {
    check: { executor: 'nx:run-commands', cache: true, inputs: ['{projectRoot}/content.json', '{workspaceRoot}/libs/coming-soon/src/content.js'], options: { command: `node tools/scripts/check-content.mjs apps/${name}/content.json` } },
    build: { executor: 'nx:run-commands', cache: true, dependsOn: ['check'], inputs: ['default', '^default'], outputs: [`{workspaceRoot}/dist/apps/${name}`], options: { command: `node tools/deploy/build-worker.mjs ${name}` } },
    serve: { executor: 'nx:run-commands', continuous: true, options: { command: `pnpm exec wrangler dev -c apps/${name}/wrangler.toml -c apps/leads/wrangler.toml --persist-to .wrangler/state` } },
    deploy: { executor: 'nx:run-commands', dependsOn: ['build'], options: { command: `bash tools/deploy/deploy.sh ${name} {args.stage}`, args: '--stage=staging' } },
  },
}, null, 2) + '\n');

put('package.json', JSON.stringify({ name: `@duganlabs/app-${name}`, private: true, type: 'module', dependencies: { '@duganlabs/coming-soon': 'workspace:*' } }, null, 2) + '\n');
