import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  TOKEN_CSS,
  adoptDesignTokens,
  resetTokensForTesting,
} from './tokens.js';

/**
 * Every `--bn-*` name @basenative/components 0.11 consumes that must resolve
 * to the Greenput palette.
 */
const BRIDGED = [
  '--bn-color-surface',
  '--bn-color-text',
  '--bn-color-border',
  '--bn-color-border-control',
  '--bn-color-error-fg',
  '--bn-color-primary-600',
  '--bn-color-success-badge-bg',
  '--bn-font-family',
  '--bn-radius-control',
  '--bn-radius-container',
  '--bn-radius-modal',
  '--bn-shadow-modal',
  '--bn-motion-fast',
  '--bn-motion-base',
  '--bn-motion-slow',
  '--bn-control-height',
  '--bn-scrim',
  '--bn-z-modal',
];

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) out.push(full);
  }
  return out;
}

describe('design tokens', () => {
  afterEach(() => {
    resetTokensForTesting();
  });

  it('bridges every consumed --bn-* name onto a --gp-* token', () => {
    const bridge = TOKEN_CSS.slice(TOKEN_CSS.indexOf('components bridge'));
    for (const name of BRIDGED) {
      expect(bridge, name).toMatch(new RegExp(`${name}:[^;]*var\\(--gp-`));
    }
  });

  it('declares no --bn-* component name outside the bridge block', () => {
    const before = TOKEN_CSS.slice(0, TOKEN_CSS.indexOf('components bridge'));
    // `--bn-plat-*` is the Apple 27 sheet, not a name this app invented.
    const withoutKit = before.replace(/--bn-plat-[a-z0-9-]*/g, '');
    expect(withoutKit).not.toMatch(/--bn-[a-z]/);
  });

  it('sizes controls for a gloved thumb', () => {
    expect(TOKEN_CSS).toContain('--gp-tap-min: 2.75rem;');
    expect(TOKEN_CSS).toContain('--gp-control-h: 2.75rem;');
    // The hit expander is what lets a 34px row button still answer at 44px.
    expect(TOKEN_CSS).toContain('[data-bn-tap]::after');
    expect(TOKEN_CSS).toMatch(/min-width: var\(--gp-tap-min\)/);
  });

  /**
   * The whole platform styles itself from `var(--gp-*)`. A renamed or
   * mistyped token is silently transparent in CSS — the button just loses
   * its fill — so every reference is checked against the declarations the
   * token sheet actually ships.
   */
  it('references only custom properties the token sheet declares', () => {
    const declared = new Set(
      [...TOKEN_CSS.matchAll(/(--gp-[a-z0-9-]+)\s*:/g)].map((m) => m[1]),
    );
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file.endsWith(join('styles', 'tokens.ts'))) continue;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/var\((--gp-[a-z0-9-]+)\)/g)) {
        if (!declared.has(match[1])) {
          offenders.push(`${file.slice(SRC.length + 1)} → ${match[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('leaves no hard-coded hsl()/hex colour in a route stylesheet', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const source = readFileSync(file, 'utf8');
      // Only inside adopted stylesheets — SVG markup legitimately carries
      // `currentColor` and the mark's own brand hexes.
      for (const sheet of source.matchAll(/defineSheet\(`([\s\S]*?)`\)/g)) {
        const css = sheet[1] ?? '';
        for (const colour of css.matchAll(
          /(?:hsl\([^)]*\)|#[0-9a-fA-F]{3,8}\b)/g,
        )) {
          offenders.push(`${file.slice(SRC.length + 1)} → ${colour[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('adopts the sheet only once per document', () => {
    resetTokensForTesting();
    const initial = document.adoptedStyleSheets.length;
    adoptDesignTokens(document);
    adoptDesignTokens(document);
    expect(document.adoptedStyleSheets.length).toBe(initial + 1);
  });
});
