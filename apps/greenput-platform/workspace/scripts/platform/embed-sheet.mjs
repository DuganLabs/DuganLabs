#!/usr/bin/env node
/**
 * Refresh libs/shared/design/src/platform-sheet.ts from the installed
 * @basenative/platform CSS.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..', '..');
const tokens = readFileSync(require.resolve('@basenative/platform/tokens.css'), 'utf8');
const components = readFileSync(require.resolve('@basenative/platform/components.css'), 'utf8');
const out = `/**
 * Embedded @basenative/platform stylesheets.
 *
 * Generated from the installed @basenative/platform CSS. Workers and the
 * Vite bundle read this module; they do not read the package files at
 * runtime. Regenerate with \`node scripts/platform/embed-sheet.mjs\`.
 * platform-sheet.spec.ts fails if this drifts from the package.
 */
/* eslint-disable */
export const PLATFORM_TOKENS_CSS = ${JSON.stringify(tokens)};
export const PLATFORM_COMPONENTS_CSS = ${JSON.stringify(components)};
`;
writeFileSync(resolve(root, 'libs/shared/design/src/platform-sheet.ts'), out);
console.log('embedded platform CSS', tokens.length + components.length, 'bytes');
