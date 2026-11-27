import { describe, expect, it } from 'vitest';
import {
  GP_BASE_CSS,
  GP_BRAND_INK,
  GP_BRAND_LEAF,
  GP_FONT_HREF,
  GP_FONT_STACK,
  GP_TOKENS_CSS,
  GP_FONT_HEAD_HTML,
} from './tokens.js';
import {
  contrastRatio,
  parseFirstCustomProperties,
  resolveColor,
} from './contrast.js';
import { GP_PLATFORM_CSS, GP_PLAT_TINT } from './platform.js';
import { GP_ICONS, type GpIconName } from './icons.js';
import { greenputMark, initialsFor } from './mark.js';

const props = new Map<string, string>([
  ...parseFirstCustomProperties(GP_PLATFORM_CSS),
  ...parseFirstCustomProperties(GP_TOKENS_CSS),
]);
const c = (name: string): string => resolveColor(name, props);

/**
 * Every colour pairing the visual language actually ships, with the WCAG 2.2
 * threshold that applies to it: 4.5 for body text, 3 for large text and for
 * the boundary of an interactive control (1.4.11 Non-text Contrast).
 *
 * This table is the accessibility contract. Adding a pairing to a stylesheet
 * without adding it here is the only way to regress it silently, so treat a
 * new colour pairing as requiring a new row.
 */
const PAIRINGS: ReadonlyArray<readonly [string, string, string, number]> = [
  ['body text on paper', '--gp-text', '--gp-surface', 4.5],
  ['body text on app ground', '--gp-text', '--gp-bg', 4.5],
  ['body text on sunk surface', '--gp-text', '--gp-surface-sunk', 4.5],
  ['heading on paper', '--gp-text-strong', '--gp-surface', 4.5],
  ['muted text on paper', '--gp-text-muted', '--gp-surface', 4.5],
  ['muted text on app ground', '--gp-text-muted', '--gp-bg', 4.5],
  ['muted text on sunk surface', '--gp-text-muted', '--gp-surface-sunk', 4.5],
  ['subtle text on paper', '--gp-text-subtle', '--gp-surface', 4.5],
  ['subtle text on app ground', '--gp-text-subtle', '--gp-bg', 4.5],
  ['link on paper', '--gp-primary-text', '--gp-surface', 4.5],
  ['link on app ground', '--gp-primary-text', '--gp-bg', 4.5],
  ['link on sunk surface', '--gp-primary-text', '--gp-surface-sunk', 4.5],
  ['primary button label', '--gp-primary-fg', '--gp-primary', 4.5],
  ['primary button label, hover', '--gp-primary-fg', '--gp-primary-hover', 4.5],
  ['prominent button label', '--gp-button-fg', '--gp-button-fill', 4.5],
  [
    'prominent button label, hover',
    '--gp-button-fg',
    '--gp-button-fill-hover',
    4.5,
  ],
  ['text on the ink band', '--gp-text-on-ink', '--gp-surface-ink', 4.5],
  [
    'muted text on the ink band',
    '--gp-text-on-ink-muted',
    '--gp-surface-ink',
    4.5,
  ],
  [
    'brand text on the ink band',
    '--gp-primary-on-ink',
    '--gp-surface-ink',
    4.5,
  ],
  [
    'text on the raised ink band',
    '--gp-text-on-ink',
    '--gp-surface-ink-raised',
    4.5,
  ],
  // Added after a Lighthouse run caught --gp-ink-400 at 4.07:1 on the band,
  // which is fine as a border and not as 11px type. Anything read on the ink
  // now stops at --gp-text-on-ink-subtle, and these rows keep it there.
  [
    'subtle text on the ink band',
    '--gp-text-on-ink-subtle',
    '--gp-surface-ink',
    4.5,
  ],
  [
    'subtle text on the raised ink band',
    '--gp-text-on-ink-subtle',
    '--gp-surface-ink-raised',
    4.5,
  ],
  [
    'muted text on the raised ink band',
    '--gp-text-on-ink-muted',
    '--gp-surface-ink-raised',
    4.5,
  ],
  [
    'brand text on the raised ink band',
    '--gp-primary-on-ink',
    '--gp-surface-ink-raised',
    4.5,
  ],
  ['idle badge', '--gp-idle-ink', '--gp-idle-bg', 4.5],
  ['in-motion badge', '--gp-move-ink', '--gp-move-bg', 4.5],
  ['good badge', '--gp-good-ink', '--gp-good-bg', 4.5],
  ['dead badge', '--gp-dead-ink', '--gp-dead-bg', 4.5],
  ['neutral badge', '--gp-null-ink', '--gp-null-bg', 4.5],
  ['good text on paper', '--gp-good-ink', '--gp-surface', 4.5],
  ['in-motion text on paper', '--gp-move-ink', '--gp-surface', 4.5],
  ['dead text on paper', '--gp-dead-ink', '--gp-surface', 4.5],
  ['success text on paper', '--gp-success', '--gp-surface', 4.5],
  ['warning text on paper', '--gp-warning', '--gp-surface', 4.5],
  ['danger text on paper', '--gp-danger', '--gp-surface', 4.5],
  ['info text on paper', '--gp-info', '--gp-surface', 4.5],
  // 1.4.11 — the visible boundary of a control, and the focus indicator.
  ['control border on paper', '--gp-border-control', '--gp-surface', 3],
  ['control border on app ground', '--gp-border-control', '--gp-bg', 3],
  ['focus ring on paper', '--gp-focus', '--gp-surface', 3],
  ['focus ring on app ground', '--gp-focus', '--gp-bg', 3],
  ['focus ring on the ink band', '--gp-focus-on-ink', '--gp-surface-ink', 3],
  ['mark on the ink band', '--gp-mark', '--gp-surface-ink', 3],
  ['idle rule on paper', '--gp-idle-line', '--gp-surface', 3],
  ['in-motion rule on paper', '--gp-move-line', '--gp-surface', 3],
  ['good rule on paper', '--gp-good-line', '--gp-surface', 3],
  ['dead rule on paper', '--gp-dead-line', '--gp-surface', 3],
  ['selected-row text', '--gp-text', '--gp-primary-tint', 4.5],
];

describe('Greenput token layer', () => {
  it('keeps the org brand lineage', () => {
    expect(GP_TOKENS_CSS).toContain(GP_BRAND_INK);
    expect(GP_TOKENS_CSS).toContain(GP_BRAND_LEAF);
    expect(c('--gp-ink-900')).toBe(GP_BRAND_INK.toUpperCase());
    expect(c('--gp-green-400')).toBe(GP_BRAND_LEAF.toUpperCase());
    expect(c('--gp-mark')).toBe(GP_BRAND_LEAF.toUpperCase());
  });

  it('resolves every semantic colour to a literal hex', () => {
    for (const [, fg, bg] of PAIRINGS) {
      expect(c(fg)).toMatch(/^#[0-9A-F]{6}$/);
      expect(c(bg)).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it.each(PAIRINGS)('%s meets WCAG AA', (_label, fg, bg, min) => {
    const ratio = contrastRatio(c(fg), c(bg));
    expect(
      ratio,
      `${fg} on ${bg} is ${ratio.toFixed(2)}:1, below ${min}:1`,
    ).toBeGreaterThanOrEqual(min);
  });

  it('keeps Archivo for the rasterizer and the platform stack for UI', () => {
    expect(GP_FONT_HREF).toContain('family=Archivo');
    expect(GP_FONT_HREF.match(/family=/g)).toHaveLength(1);
    expect(GP_FONT_HREF).toContain('display=swap');
    expect(GP_FONT_STACK).toContain('Archivo');
    expect(GP_TOKENS_CSS).toContain(
      '--gp-font-sans: var(--bn-plat-font-family);',
    );
    expect(c('--gp-mark')).toBe(GP_PLAT_TINT.toUpperCase());
  });

  it('follows the system scheme instead of locking light', () => {
    expect(GP_TOKENS_CSS).toContain('color-scheme: light dark;');
    expect(GP_PLATFORM_CSS).toContain('prefers-color-scheme: dark');
    expect(GP_PLATFORM_CSS).toContain('prefers-contrast: more');
    expect(GP_TOKENS_CSS).not.toContain('light-dark(');
  });

  it('declares a 44px minimum tap target', () => {
    expect(props.get('--gp-tap-min')).toBe('2.75rem');
  });

  it('fixes the toolbar at 52px with 32px controls', () => {
    expect(props.get('--gp-toolbar-h')).toBe('3.25rem');
    expect(props.get('--gp-toolbar-control')).toBe('2rem');
    expect(props.get('--gp-toolbar-gap')).toBe('var(--gp-space-2)');
    expect(props.get('--gp-capsule-blur')).toBe('48px');
    expect(props.get('--gp-capsule-h')).toBe('4.25rem');
    expect(props.get('--gp-capsule-inset')).toBe('0.75rem');
    expect(props.get('--gp-tab-icon')).toBe('1.75rem');
    expect(props.get('--gp-tab-stroke')).toBe('2.25');
    expect(props.get('--gp-mark-tile')).toBe('2.25rem');
    expect(props.get('--gp-cluster-min')).toBe('12.5rem');
  });

  it('keeps one hero glow and the glass material on the token scale', () => {
    expect(GP_TOKENS_CSS.match(/radial-gradient\(/g)).toHaveLength(1);
    expect(props.get('--gp-hero-glow')).toContain('var(--gp-primary) 5%');
    expect(props.get('--gp-hero-glow')).toContain('at 50% 34%');
    expect(props.get('--gp-hero-glow')).toContain('transparent 100%');
    expect(props.get('--gp-text-display')).toBe(
      'clamp(2.25rem, 4.4vw, 3.5rem)',
    );
    expect(props.get('--gp-card-inset')).toBe('var(--gp-space-6)');
    expect(GP_TOKENS_CSS).toContain(
      '--gp-bg: var(--bn-plat-color-backgrounds-secondary);',
    );
    expect(GP_TOKENS_CSS).toContain(
      '--gp-surface: var(--bn-plat-color-backgrounds-tertiary);',
    );
    expect(props.get('--gp-glass-fill')).not.toContain('--gp-primary');
    expect(props.get('--gp-shadow-glass')).toBe(
      'var(--gp-shadow-highlight), var(--gp-shadow-md)',
    );
    expect(props.get('--gp-z-float')).toBe('70');
  });

  it('makes every figure tabular and honours reduced motion', () => {
    expect(GP_BASE_CSS).toContain('tabular-nums');
    expect(GP_BASE_CSS).toContain('prefers-reduced-motion');
    expect(GP_BASE_CSS).toContain('transition-property: none !important');
    expect(GP_BASE_CSS).not.toContain('transition-duration: 0.01ms');
  });
});

describe('Greenput mark and icons', () => {
  it('draws the leaf with the brand accent by default', () => {
    const svg = greenputMark();
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('var(--gp-mark)');
    expect(svg).toContain('aria-hidden="true"');
  });

  it('labels the mark when given a title', () => {
    expect(greenputMark({ title: 'Greenput' })).toContain(
      'role="img" aria-label="Greenput"',
    );
  });

  it('derives contractor initials from a business name', () => {
    expect(initialsFor('Redhill Electric')).toBe('RE');
    expect(initialsFor('Vega')).toBe('VE');
    expect(initialsFor("O'Brien & Sons Plumbing")).toBe('OP');
    expect(initialsFor('   ')).toBe('?');
  });

  it('draws every nav icon on one grid at one stroke weight', () => {
    const names = Object.keys(GP_ICONS) as GpIconName[];
    expect(names.length).toBeGreaterThanOrEqual(15);
    for (const name of names) {
      const svg = GP_ICONS[name];
      expect(svg, name).toContain('viewBox="0 0 24 24"');
      expect(svg, name).toContain('stroke-width="1.75"');
      expect(svg, name).toContain('stroke="currentColor"');
      expect(svg, name).toContain('aria-hidden="true"');
      expect(svg, name).not.toContain('fill="#');
    }
  });
});

// Every Greenput surface is served under a CSP carrying a nonce. Under that,
// inline event handlers never run — `'unsafe-inline'` in script-src is ignored
// once a nonce or hash is present. So any head markup that depends on one is
// dead code that fails silently.
//
// This is not hypothetical. GP_FONT_HEAD_HTML used the common
// `media="print" onload="this.media='all'"` deferral, the handler was blocked,
// the link stayed at media="print", and Archivo never applied on greenput.com.
// getComputedStyle still reported "Archivo" the whole time, because that is
// only the declared stack — which is why it survived review.
describe('GP_FONT_HEAD_HTML is CSP-safe', () => {
  it('contains no inline event handler', () => {
    expect(GP_FONT_HEAD_HTML).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it('does not defer a stylesheet behind media="print"', () => {
    expect(GP_FONT_HEAD_HTML).not.toMatch(/media\s*=\s*["']print["']/i);
  });

  it('does not request a webfont — UI type is the platform stack', () => {
    expect(GP_FONT_HEAD_HTML).not.toContain('fonts.googleapis.com');
    expect(GP_FONT_HEAD_HTML.trim()).toBe('');
  });

  it('keeps display=swap on the rasterizer family', () => {
    expect(GP_FONT_HREF).toContain('display=swap');
  });
});
