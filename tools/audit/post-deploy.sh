#!/usr/bin/env bash
# Post-deploy Lighthouse audit (report-only). Builds LIGHTHOUSE_TARGETS from
# deployed apps plus fixed extra targets and calls tools/audit/lighthouse.mjs.
#   tools/audit/post-deploy.sh '["greenput","boxsized"]'
set -euo pipefail

apps_json="${1:-[]}"
if [[ -z "$apps_json" ]]; then
  apps_json="[]"
fi

targets=$(node -e '
const fs = require("node:fs");
const apps = JSON.parse(process.argv[1] || "[]");
const targets = [];

for (const app of apps) {
  const cfgPath = `apps/${app}/deploy.json`;
  if (!fs.existsSync(cfgPath)) continue;
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const prod = cfg && cfg.stages && cfg.stages.production;
  if (
    !prod ||
    prod.blocked ||
    typeof prod.url !== "string" ||
    !prod.url.startsWith("https://")
  ) {
    console.error(`skip ${app} (production blocked or no https url)`);
    continue;
  }
  const parsed = new URL(prod.url);
  if (parsed.hostname.startsWith("private.")) {
    console.error(`skip ${app} (private host)`);
    continue;
  }
  const base = prod.url.replace(/\/+$/, "");
  targets.push({ label: `${app}-home`, url: `${base}/` });
}

targets.push(
  { label: "basenative-docs-home", url: "https://basenative-docs.pages.dev/" },
  { label: "basenative-docs-docs", url: "https://basenative-docs.pages.dev/docs/" },
);

const subdomain = (process.env.CF_WORKERS_SUBDOMAIN || "").trim();
if (subdomain) {
  targets.push({
    label: "greenput-staging-demo",
    url: `https://greenput-tenant-staging.${subdomain}.workers.dev/?slug=demo`,
  });
}

process.stdout.write(JSON.stringify(targets));
' "$apps_json")

export LIGHTHOUSE_TARGETS="$targets"
node tools/audit/lighthouse.mjs
