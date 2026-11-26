#!/usr/bin/env node
// Fails the build if an app's content.json breaks the kit contract.
import { readFileSync } from 'node:fs';
import { validateContent } from '../../libs/coming-soon/src/content.js';
let bad = 0;
for (const f of process.argv.slice(2)) {
  const errs = validateContent(JSON.parse(readFileSync(f, 'utf8')));
  if (errs.length) { bad++; console.error(`✗ ${f}\n  - ${errs.join('\n  - ')}`); } else console.log(`✓ ${f}`);
}
process.exit(bad ? 1 : 0);
