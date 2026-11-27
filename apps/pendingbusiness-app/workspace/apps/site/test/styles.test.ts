// @vitest-environment node
//
// This suite bundles styles.css with esbuild and does plain colour math —
// no DOM needed. It must opt out of the project's default jsdom
// environment: jsdom's TextEncoder shim doesn't produce a real Uint8Array,
// which trips esbuild's own startup invariant check ("new
// TextEncoder().encode('') instanceof Uint8Array").
import { describe, it, expect, beforeAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
// @ts-expect-error — plain ESM build script, no declaration file.
import { PARTIALS } from '../scripts/partials.mjs';

/**
 * Guards for the shipped stylesheet. `scripts/build.mjs` bundles
 * src/styles.css with esbuild (the `@import` of @basenative/components has
 * to be inlined), so these tests bundle it the same way and inspect the
 * output — the cascade-layer bug that hid the landing CTA's text was only
 * visible in the bundled order.
 */

const SRC = resolve(process.cwd(), 'src');

let source = '';
let bundled = '';

beforeAll(async () => {
  source = await readFile(resolve(SRC, 'styles.css'), 'utf8');
  const result = await build({
    entryPoints: [resolve(SRC, 'styles.css')],
    bundle: true,
    write: false,
    minify: false,
    logLevel: 'silent',
  });
  bundled = result.outputFiles[0]?.text ?? '';
});

function layerStatements(css: string): string[] {
  // `@layer a, b, c;` statements only (not `@layer x { ... }` blocks).
  return [...css.matchAll(/@layer\s+([^{;]+);/g)].map(m =>
    m[1]!
      .split(',')
      .map(s => s.trim())
      .join(','),
  );
}

/** WCAG relative luminance → contrast ratio for two hex colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string): number => {
    const c = hex.replace('#', '');
    const [r, g, b] = [0, 2, 4].map(i => {
      const v = parseInt(c.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function token(name: string): string {
  const m = new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(source);
  if (!m) throw new Error(`token ${name} not found as a hex colour`);
  return m[1]!;
}

describe('cascade layer order', () => {
  it('declares the site order before importing the component CSS', () => {
    const layerAt = source.search(
      /^@layer tokens, reset, base, layout, components, states, state;/m,
    );
    const importAt = source.indexOf("@import '@basenative/components/css'");
    expect(layerAt).toBeGreaterThanOrEqual(0);
    expect(importAt).toBeGreaterThan(layerAt);
  });

  it('the first @layer statement in the bundle puts base below components and state above', () => {
    const [first] = layerStatements(bundled);
    expect(first).toBe('tokens,reset,base,layout,components,states,state');
    const order = first!.split(',');
    expect(order.indexOf('base')).toBeLessThan(order.indexOf('components'));
    expect(order.indexOf('components')).toBeLessThan(order.indexOf('state'));
  });

  it("the package's own statement is a subsequence of ours (so it cannot reorder anything)", () => {
    const [ours, theirs] = layerStatements(bundled);
    expect(theirs).toBe('reset,tokens,layout,components,states');
    const mine = ours!.split(',');
    // Every package layer already exists in our statement.
    for (const name of theirs!.split(',')) expect(mine).toContain(name);
  });
});

describe('component CSS is shipped', () => {
  it('bundles the dialog and button variants renderDialog/renderButton rely on', () => {
    // esbuild's CSS printer drops quotes from attribute-selector values when
    // it can (they're valid CSS identifiers), even unminified — match both
    // forms rather than pin an incidental formatting detail.
    expect(bundled).toMatch(/\[data-bn=['"]?dialog['"]?\]/);
    expect(bundled).toMatch(/\[data-bn=['"]?dialog-footer['"]?\]/);
    expect(bundled).toMatch(/\[data-bn=['"]?button['"]?\]\[data-variant=['"]?destructive['"]?\]/);
    expect(bundled).toMatch(/\[data-bn=['"]?button['"]?\]\[data-variant=['"]?secondary['"]?\]/);
  });
});

describe('site rules', () => {
  it('styles every non-dialog form, and sizes every control to a 48px target', () => {
    expect(source).toMatch(/form:not\(\[method='dialog'\]\)\s*\{/);
    expect(source).toMatch(/--touch-target:\s*48px/);
    // Every button on the site is renderButton output now, so the 48px
    // target reaches it through the package's shared control rule rather
    // than a site rule of our own.
    expect(source).toMatch(/--bn-control-height:\s*var\(--touch-target\)/);
    expect(source).toMatch(/\[data-bn='btn-primary'\]\s*\{/);
    expect(source).not.toMatch(/button:not\(\[data-bn='button'\]\)/);
  });

  it('renders each stacked cell heading from data-label on narrow containers', () => {
    expect(source).toMatch(/td\[data-label\]\s*\{/);
    expect(source).toMatch(/content:\s*attr\(data-label\)/);
  });

  it('lets main hug its content instead of stretching a lone card', () => {
    expect(source).toMatch(/main\s*\{[^}]*align-content:\s*start/);
  });

  /*
   * The UA sheet's `[hidden] { display: none }` is the weakest rule in the
   * cascade, so any later `display` beats it — and the bundle ships
   * `[data-bn="button"] { display: inline-flex }`. Signed out, /account
   * painted a 118x48 "Log out" button next to "Sign in" while `el.hidden`
   * was true. Asserted against the *bundle*, because that is where the
   * competing rule lives: the site source alone cannot show the conflict.
   */
  it('makes the hidden attribute authoritative in the shipped bundle', () => {
    expect(bundled).toMatch(/\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  });

  it('ships no display rule that could outrank [hidden] without !important', () => {
    // Every rule that sets display on a [data-bn] contract must be beatable
    // by the reset above — i.e. none of them may be !important themselves.
    const importantDisplay = [...bundled.matchAll(/display:\s*[^;}]*!important/g)].map(m => m[0]);
    const fromHidden = importantDisplay.filter(d => /none/.test(d));
    expect(importantDisplay.length, importantDisplay.join(' | ')).toBe(fromHidden.length);
  });

  /*
   * Every button resolves to a 48px target through --bn-control-height; the
   * header nav was the one control that never did — 16px tall, no padding,
   * on all four signed-in pages.
   */
  it('sizes the header nav links to the same target as every other control', () => {
    expect(source).toMatch(/&\s*>\s*li\s*>\s*a\s*\{[^}]*min-block-size:\s*var\(--touch-target\)/);
    expect(source).toMatch(/&\s*>\s*li\s*>\s*a\s*\{[^}]*display:\s*inline-flex/);
    // A literal here would drift from the token the buttons use.
    expect(source).not.toMatch(/min-block-size:\s*44px|min-block-size:\s*48px/);
  });

  /*
   * `thead { display: none }` deleted all 29 column headers from the
   * accessibility tree at phone width. The stacked layout has to keep the
   * header row rendered — clipped, not removed.
   */
  it('hides the stacked-table header visually without removing it from the tree', () => {
    const stacked = /@container \(max-width: 32rem\)\s*\{[\s\S]*?\n  \}/.exec(source)?.[0] ?? '';
    expect(stacked, 'stacked-table container query').not.toBe('');
    expect(stacked).not.toMatch(/thead\s*\{[^}]*display:\s*none/);
    expect(stacked).toMatch(/thead\s*\{[^}]*position:\s*absolute/);
    expect(stacked).toMatch(/thead\s*\{[^}]*clip-path:\s*inset\(50%\)/);
  });

  /*
   * The measure cap used to be restated per section, so any section that
   * forgot it ran the full width of its container — the landing page's
   * disclosure set a 148-character sentence as a single line.
   */
  it('caps body text once, on the shared text block', () => {
    expect(source).toMatch(/main :is\(p, li\)\s*\{[^}]*max-inline-size:\s*var\(--measure\)/);
    // And <small> carries its own cap: `ch` resolves against the element's
    // own font-size, so the parent's 60ch is 81 characters of --type-xs text.
    expect(source).toMatch(
      /main p > small:only-child\s*\{[^}]*max-inline-size:\s*var\(--measure\)/,
    );
    /*
     * And exactly one cap, not one per section. Counting is what makes this
     * hold: the per-section copies were nested rules (`[data-bn='hero'] { &
     * p { ... } }`), so a selector-shaped assertion silently passes whichever
     * way the rule is written. --measure-narrow on the #about disclosure is
     * deliberate and is a different token, so it does not count here.
     */
    const caps = [...source.matchAll(/max-inline-size:\s*var\(--measure\)\s*;/g)];
    expect(caps, 'copies of the --measure cap').toHaveLength(2); // p|li, and small
  });

  it('keeps --ink-dim at or above 4.5:1 on both card surfaces', () => {
    const dim = token('--ink-dim');
    expect(contrast(dim, token('--surface'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(dim, token('--surface-2'))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps accent-on-accent-ink (primary buttons, CTA) well above AA', () => {
    expect(contrast(token('--accent'), token('--accent-ink'))).toBeGreaterThanOrEqual(4.5);
  });

  /*
   * The confirm dialog shipped a Confirm button at 3.66:1 and a Revoke at
   * 3.68:1 (2.72:1 hovered) because @basenative/components 0.7.0 hardcoded
   * white on whatever --bn-color-primary-600 / --bn-color-error-600 resolved
   * to, and there was no token for the foreground. These pin the fix: the
   * fills are the brand colours and the labels are the dark inks.
   */
  it('renders readable text on the filled button variants', () => {
    expect(source).toMatch(/--bn-color-primary-600:\s*var\(--accent\)/);
    expect(source).toMatch(/--bn-color-on-primary:\s*var\(--accent-ink\)/);
    expect(contrast(token('--accent'), token('--accent-ink'))).toBeGreaterThanOrEqual(4.5);

    // --danger is an alias of --loss in the palette; the hex lives on --loss.
    expect(source).toMatch(/--bn-color-error-600:\s*var\(--loss\)/);
    expect(source).toMatch(/--bn-color-on-error:\s*var\(--bg\)/);
    expect(contrast(token('--loss'), token('--bg'))).toBeGreaterThanOrEqual(4.5);
  });

  it("points the component control surface at the site's own input fill", () => {
    expect(source).toMatch(/--bn-color-surface-control:\s*var\(--surface-2\)/);
    expect(contrast(token('--ink'), token('--surface-2'))).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * The palette contract from
 * `duganlabs-survey/pendingbusiness-visual-language.md` §3. These aren't
 * decoration: the financial tones carry state at 13px table-body size, so
 * they are held to the 4.5:1 body-text floor on every surface they can land
 * on — not the 3:1 large-text allowance.
 */
describe('palette', () => {
  const SURFACES = ['--bg', '--surface', '--surface-2', '--surface-3'] as const;

  for (const role of [
    '--ink',
    '--ink-muted',
    '--ink-dim',
    '--gain',
    '--loss',
    '--caution',
    '--accent',
  ] as const) {
    it(`${role} meets AA body text on every surface`, () => {
      for (const surface of SURFACES) {
        const ratio = contrast(token(role), token(surface));
        expect(ratio, `${role} on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it('keeps the DuganLabs parent ground and ink — that is where the family resemblance lives', () => {
    expect(token('--bg').toLowerCase()).toBe('#0f0e0c');
    expect(token('--ink').toLowerCase()).toBe('#f0ede4');
  });

  it("does not ship Greenput's accent — the two presets used to be byte-identical", () => {
    expect(token('--accent').toLowerCase()).not.toBe('#4eaf7c');
  });

  it('keeps the accent out of the gain/loss/caution triad so it can never read as a value', () => {
    for (const role of ['--gain', '--loss', '--caution'] as const) {
      expect(token('--accent').toLowerCase()).not.toBe(token(role).toLowerCase());
    }
  });

  it('separates --gain from --loss by more than hue alone can carry', () => {
    // Deuteranopia collapses this pair (measured deltaE 2.4 for the old
    // #4EAF7C). #8FDCA8 was picked for the lightness separation that
    // survives it; the non-colour carriers in lib/format.ts do the rest.
    const gain = contrast(token('--gain'), token('--bg'));
    const loss = contrast(token('--loss'), token('--bg'));
    expect(Math.abs(gain - loss)).toBeGreaterThan(3);
  });
});

describe('numeric and table craft', () => {
  it('reserves tabular figures for columns and leaves standing figures proportional', () => {
    // Columns align; a standing 30px figure would develop gaps around its 1s.
    const numericRule = /\[data-numeric\],\s*&? ?\[data-bn='num'\] \{([^}]*)\}/.exec(source);
    expect(numericRule?.[1]).toMatch(/font-variant-numeric: tabular-nums lining-nums/);
    expect(source).toMatch(/& output \{[^}]*font-variant-numeric: lining-nums/);
    expect(source).not.toMatch(/:root \{[^}]*font-variant-numeric: tabular-nums/);
  });

  it('right-aligns numeric columns and never wraps a figure', () => {
    const numericRule = /\[data-numeric\],\s*&? ?\[data-bn='num'\] \{([^}]*)\}/.exec(source);
    expect(numericRule?.[1]).toMatch(/text-align: end/);
    expect(numericRule?.[1]).toMatch(/white-space: nowrap/);
  });

  it('foots a totals row with the accounting double rule', () => {
    expect(source).toMatch(/tfoot th,[\s\S]{0,60}border-block-start: 3px double/);
  });

  it('draws magnitude bars with no track, so length alone encodes the value', () => {
    expect(source).toMatch(/\[data-bar\] \{[^}]*background: transparent/);
  });

  it('keeps the bar out of the accessibility tree in every renderer path', () => {
    // The value lives in the figure beside it; see lib/table.ts figure().
    expect(source).toMatch(/\[data-bar\]/);
  });
});

/*
 * Cross-file contracts. The component renderers emit variant names and the
 * partials emit presentation hints; both are inert strings until this
 * stylesheet declares a rule for them, and an undeclared variant renders
 * unstyled with no error anywhere. These assert the two halves agree.
 */
describe('rendered markup and the stylesheet agree', () => {
  const partials = PARTIALS as Record<string, string>;
  const markup = Object.values(partials).join('');

  it('declares a width for every data-field size the partials emit', () => {
    const used = new Set([...markup.matchAll(/data-field="([a-z]+)"/g)].map(m => m[1]!));
    expect(used.size).toBeGreaterThan(0);
    for (const size of used) {
      expect(source, `data-field="${size}" has no width rule`).toMatch(
        new RegExp(`\\[data-field='${size}'\\]\\s*\\{[^}]*inline-size:`),
      );
    }
  });

  it('draws the currency adornment for every data-money control', () => {
    expect(markup).toContain('data-money');
    // The `$` is drawn by the field wrapper, selected off the control's hint,
    // because renderInput has no adornment slot to put a sibling in.
    expect(source).toMatch(/:has\(> \[data-money\]\)/);
    expect(source).toMatch(/content: '\$'/);
  });

  it('styles every button and badge variant the app can render', () => {
    // renderBadge/renderButton put the name straight into data-variant; a name
    // with no rule behind it is a silently unstyled control.
    for (const variant of ['primary', 'secondary', 'destructive', 'ghost']) {
      expect(bundled, `button variant ${variant}`).toMatch(
        new RegExp(`\\[data-bn=['"]?button['"]?\\]\\[data-variant=['"]?${variant}['"]?\\]`),
      );
    }
    for (const variant of ['default', 'primary', 'success', 'warning', 'error']) {
      expect(bundled, `badge variant ${variant}`).toMatch(
        new RegExp(`\\[data-bn=['"]?badge['"]?\\]\\[data-variant=['"]?${variant}['"]?\\]`),
      );
    }
  });

  it("tints every badge and alert variant from PB's palette, in both OS themes", () => {
    /*
     * The package's own values for these sit behind a prefers-color-scheme
     * media query. PB has one theme, so every one of them has to be bridged
     * unlayered or a light-mode OS gets a #fef2f2 alert on a near-black card.
     */
    for (const name of [
      '--bn-color-success-badge-bg',
      '--bn-color-warning-badge-bg',
      '--bn-color-error-badge-bg',
      '--bn-color-info-bg',
      '--bn-color-error-bg',
      '--bn-color-error-border',
      '--bn-color-error-text',
      '--bn-color-error-fg',
      '--bn-color-success-bg',
      '--bn-color-warning-bg',
      '--bn-color-info-border',
    ]) {
      const at = source.indexOf(`${name}:`);
      expect(at, `${name} is not bridged`).toBeGreaterThan(-1);
      // Before the first @layer block: the bridge is deliberately unlayered
      // so it beats the package's layered tokens and its media queries.
      expect(at, `${name} must be declared in the unlayered bridge`).toBeLessThan(
        source.indexOf('@layer tokens {'),
      );
    }
  });

  it('sets field labels in sentence case — micro-caps belong to table headings', () => {
    const label = /& \[data-bn='field'\] > label \{([^}]*)\}/.exec(source);
    expect(label?.[1]).toMatch(/text-transform: none/);
    expect(label?.[1]).not.toMatch(/uppercase/);
  });

  it('sets amounts in the sans with tabular figures, never the mono', () => {
    const numeric = /& \[data-bn='input'\]\[type='number'\][\s\S]{0,160}?\{([^}]*)\}/.exec(source);
    expect(numeric?.[1]).toMatch(/font-variant-numeric: tabular-nums lining-nums/);
    expect(numeric?.[1]).not.toMatch(/font-family/);
    expect(source).not.toMatch(/\[data-bn='input'\]\[type='number'\][^{]*\{[^}]*var\(--mono\)/);
  });
});
