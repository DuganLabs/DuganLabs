// Contrast is a property of the token pairs the stylesheets actually paint,
// so these tests read pages/css and compute WCAG ratios from whatever is
// declared there today — they do not pin a hex value. Changing --accent to
// another colour is fine; changing it to one that cannot carry its own
// foreground is what fails.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  read, themes, resolveToken, contrastRatio, declarationBlocks,
} from './helpers/css.mjs';

const AA = 4.5;
const { dark, light } = themes();
const PALETTES = { dark, light };

function ratioOf(theme, fgToken, bgToken) {
  const fg = resolveToken(PALETTES[theme], fgToken);
  const bg = resolveToken(PALETTES[theme], bgToken);
  assert.ok(fg, `${fgToken} is not declared for the ${theme} theme`);
  assert.ok(bg, `${bgToken} is not declared for the ${theme} theme`);
  return contrastRatio(fg, bg);
}

describe('--on-accent carries text on an --accent background', () => {
  for (const theme of Object.keys(PALETTES)) {
    it(`${theme}: --on-accent on --accent clears AA`, () => {
      const ratio = ratioOf(theme, '--on-accent', '--accent');
      assert.ok(
        ratio >= AA,
        `--on-accent on --accent is ${ratio}:1 in the ${theme} theme, needs ${AA}:1`,
      );
    });
  }

  // The bug this guards: a control painted the brand amber as its background
  // and hardcoded #fff on top of it (2.46:1). Any rule that fills with
  // --accent has to take its foreground from the token that is defined per
  // theme for exactly that job.
  it('every rule that fills with --accent declares color: var(--on-accent)', () => {
    const offenders = [];
    for (const { selector, body } of declarationBlocks(read('pages/css/components.css'))) {
      const fillsWithAccent = /(?:^|[\s;])background(?:-color)?\s*:\s*var\(\s*--accent\s*\)/.test(body);
      if (!fillsWithAccent) continue;
      const foreground = body.match(/(?:^|[\s;])color\s*:\s*([^;}]+)/);
      const usesOnAccent = foreground && /var\(\s*--on-accent\s*\)/.test(foreground[1]);
      if (!usesOnAccent) {
        offenders.push(`${selector} → color: ${foreground ? foreground[1].trim() : '(none)'}`);
      }
    }
    assert.deepEqual(offenders, [], 'rules filling with --accent without --on-accent');
  });
});

describe('light-theme text accents are readable on paper', () => {
  // These are the colours that carried meaning in the comparison tables and
  // still carry it in any status text: they are used as text on the page and
  // card surfaces, so they are held to the text threshold.
  const TEXT_ACCENTS = ['--accent', '--green', '--amber'];
  const SURFACES = ['--surface-0', '--surface-1', '--surface-2'];

  for (const theme of Object.keys(PALETTES)) {
    for (const token of TEXT_ACCENTS) {
      for (const surface of SURFACES) {
        it(`${theme}: ${token} on ${surface} clears AA`, () => {
          const ratio = ratioOf(theme, token, surface);
          assert.ok(
            ratio >= AA,
            `${token} on ${surface} is ${ratio}:1 in the ${theme} theme, needs ${AA}:1`,
          );
        });
      }
    }
  }
});

describe('contrast helper', () => {
  it('matches the WCAG reference values', () => {
    assert.equal(contrastRatio('#ffffff', '#000000'), 21);
    assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
  });
});
