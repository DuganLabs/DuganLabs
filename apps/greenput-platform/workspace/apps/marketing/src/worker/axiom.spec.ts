/**
 * Axiom lint for GreenPut-authored marketing markup and the shared surface.
 *
 * Published package output is out of scope: these checks read the files
 * GreenPut writes and the HTML the marketing worker actually serves.
 * A `<div>`, `<span>`, inline `style`, custom element, or an unlayered
 * rule in the surface sheet fails here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SURFACE_CSS } from '@greenput/shared/design';
import handler from './index.js';
import type { Env } from './env.js';
import { GUIDES } from './geo/guides.js';

const workerDir = dirname(fileURLToPath(import.meta.url));
const surfaceDir = resolve(
  workerDir,
  '../../../../libs/shared/design/src/surface',
);

const env: Env = { DB: {} as D1Database, ENVIRONMENT: 'test' };
const ctx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.endsWith('.spec.ts')) continue;
    if (entry.startsWith('og-images')) continue;
    out.push(path);
  }
  return out;
}

const AUTHORED = [...sourceFiles(workerDir), ...sourceFiles(surfaceDir)];

function violations(source: string): string[] {
  const found: string[] = [];
  if (/<div\b/i.test(source)) found.push('<div>');
  if (/<span\b/i.test(source)) found.push('<span>');
  if (/\bstyle\s*=/.test(source)) found.push('style=');
  if (/<style\b/i.test(source)) found.push('<style>');
  const custom = source.match(/<\/?[a-z]+-[a-z0-9-]+\b/gi);
  if (custom) found.push(...custom.slice(0, 5));
  return found;
}

/** CSS left over once every `@layer` block has been removed. */
function outsideLayers(css: string): string {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  let out = '';
  while (i < stripped.length) {
    const rest = stripped.slice(i);
    const at = rest.search(/@layer\b/);
    if (at === -1) {
      out += rest;
      break;
    }
    out += rest.slice(0, at);
    i += at;
    const open = stripped.indexOf('{', i);
    if (open === -1) break;
    i = open + 1;
    let depth = 1;
    while (i < stripped.length && depth > 0) {
      if (stripped[i] === '{') depth++;
      else if (stripped[i] === '}') depth--;
      i++;
    }
  }
  return out.replace(/\s+/g, '');
}

describe('axiom lint', () => {
  it('GreenPut-authored marketing and surface sources stay semantic', () => {
    const failures = AUTHORED.flatMap((path) => {
      const found = violations(readFileSync(path, 'utf8'));
      return found.length ? [`${path}: ${found.join(', ')}`] : [];
    });
    expect(failures).toEqual([]);
  });

  it('organism names are attributes on semantic elements, never custom tags', async () => {
    const organisms = [
      'bn-metric',
      'bn-metrics',
      'bn-card-grid',
      'bn-info-card',
      'bn-icon-tile',
      'bn-inset-list',
      'bn-inset-row',
      'bn-badge',
      'bn-large-title',
      'bn-panel',
    ];
    const stillUsed = ['bn-metric', 'bn-metrics'];
    const semantic =
      'section|article|ul|ol|li|dl|dt|dd|figure|nav|header|h1|h2|p|a|b|aside|button|blockquote';
    const pages = await Promise.all(
      ['/technology', '/ai', '/pricing', '/'].map(async (path) => {
        const res = await handler.fetch(
          new Request(`https://greenput.com${path}`),
          env,
          ctx,
        );
        return res.text();
      }),
    );
    const html = pages.join('\n');
    const ds = pages.slice(0, 3).join('\n');
    for (const name of organisms) {
      expect(html, name).not.toMatch(new RegExp(`<${name}\\b`, 'i'));
      if (!ds.includes(`data-bn="${name}"`)) continue;
      const hosts = [
        ...ds.matchAll(
          new RegExp(`<(${semantic})\\b[^>]*data-bn="${name}"`, 'gi'),
        ),
      ];
      expect(hosts.length, `${name} is not on a semantic host`).toBeGreaterThan(
        0,
      );
    }
    for (const name of stillUsed) {
      expect(ds, name).toContain(`data-bn="${name}"`);
    }
  });

  it('the shared surface stylesheet is entirely inside @layer', () => {
    expect(SURFACE_CSS).toContain('@layer components');
    expect(outsideLayers(SURFACE_CSS)).toBe('');
  });

  it('every served marketing page is free of div, span, and inline style', async () => {
    const paths = [
      '/',
      '/features',
      '/pricing',
      '/contact',
      '/about',
      '/technology',
      '/ai',
      '/investors',
      '/privacy',
      '/terms',
      ...GUIDES.map((guide) => guide.path),
      '/no-such-page',
    ];
    const failures: string[] = [];
    for (const path of paths) {
      const res = await handler.fetch(
        new Request(`https://greenput.com${path}`),
        env,
        ctx,
      );
      const html = await res.text();
      const found = violations(html);
      if (found.length) failures.push(`${path}: ${found.join(', ')}`);
    }
    expect(failures).toEqual([]);
  });
});
