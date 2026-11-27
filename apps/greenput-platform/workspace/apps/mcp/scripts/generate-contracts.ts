import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { format } from 'prettier';
import { buildContractJsonSchemas } from '../src/contracts.js';

/**
 * Writes contracts/*.json from the zod schemas in src/contracts.ts.
 * The zod schemas are the source of truth; these files are their published
 * twins for anyone (or any host) that reads JSON Schema. The contract test
 * regenerates the same map in memory and fails if disk has drifted.
 * Output is run through prettier (the repo's format) so the checked-in
 * files are format-clean by construction. The drift test compares parsed
 * JSON, not bytes.
 * Run: npm run generate:contracts
 */
const here = dirname(fileURLToPath(import.meta.url));
const contractsDir = join(here, '..', 'contracts');

mkdirSync(contractsDir, { recursive: true });
for (const [name, schema] of Object.entries(buildContractJsonSchemas())) {
  const path = join(contractsDir, `${name}.json`);
  const text = await format(JSON.stringify(schema), {
    parser: 'json',
    singleQuote: true,
  });
  writeFileSync(path, text, 'utf8');
  console.log(`wrote contracts/${name}.json`);
}
