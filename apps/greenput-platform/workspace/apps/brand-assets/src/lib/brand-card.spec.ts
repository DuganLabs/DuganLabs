import { describe, expect, it } from 'vitest';
import {
  GP_MARK_ASSET_SIZE,
  GP_SHARE_CARD_SIZE,
  generatedIdentityFor,
  generatedMarkSvg,
  shareCardFactsFor,
  type GpBrandAssetSource,
} from '@greenput/shared/design';
import { BRAND_ASSET_CASES } from '../../../../libs/shared/design/src/brand-assets.fixtures';

import {
  CARD_FONT_FAMILY,
  drawableText,
  markAssetSvg,
  shareCardSvg,
} from './brand-card';

const REED: GpBrandAssetSource & { name: string } = {
  name: 'Reed HVAC',
  slug: 'reed-hvac',
  trade: 'hvac',
  city: 'Austin',
  state: 'TX',
  logo_url: null,
  custom_hostname: null,
  custom_domain_status: null,
};

/** Rough well-formedness: every opened element is closed, one root. */
function assertWellFormedSvg(svg: string): void {
  expect(svg.startsWith('<svg ')).toBe(true);
  expect(svg.endsWith('</svg>')).toBe(true);
  expect(svg.match(/<svg/g)).toHaveLength(1);
  const opens = (svg.match(/<[a-z]/g) ?? []).length;
  const selfClosing = (svg.match(/\/>/g) ?? []).length;
  const closes = (svg.match(/<\//g) ?? []).length;
  expect(opens).toBe(selfClosing + closes);
}

describe('shareCardSvg', () => {
  it('is 1200x630 with a matching viewBox', () => {
    const svg = shareCardSvg(shareCardFactsFor(REED));
    expect(svg).toContain(
      `width="${GP_SHARE_CARD_SIZE.width}" height="${GP_SHARE_CARD_SIZE.height}"`,
    );
    expect(svg).toContain(
      `viewBox="0 0 ${GP_SHARE_CARD_SIZE.width} ${GP_SHARE_CARD_SIZE.height}"`,
    );
  });

  it('shows the business name, the trade label and the area', () => {
    const svg = shareCardSvg(shareCardFactsFor(REED));
    expect(svg).toContain('Reed HVAC');
    expect(svg).toContain('HVAC · Austin, TX');
    expect(svg).toContain('reed-hvac.greenput.com');
  });

  it('NEVER shows the phone number', () => {
    // Two guards, because this is the one thing on the row that must not
    // syndicate: the facts object has no phone key (asserted in
    // brand-assets.spec.ts) and the scene takes only the facts.
    const svg = shareCardSvg(
      shareCardFactsFor({
        ...REED,
        ...({ phone: '+15125550142' } as Record<string, unknown>),
      } as GpBrandAssetSource),
    );
    expect(svg).not.toContain('5125550142');
    expect(svg).not.toContain('512');
    expect(svg).not.toMatch(/\+\d/);
  });

  it('draws the generated tile in the identity colour', () => {
    const identity = generatedIdentityFor(REED);
    const svg = shareCardSvg(shareCardFactsFor(REED));
    expect(svg).toContain(`fill="${identity.variant.bg}"`);
    expect(svg).toContain(`>${identity.initials}</text>`);
  });

  it('agrees with generatedMarkSvg on colour and letters', () => {
    // The card draws the tile as plain geometry rather than nesting an <svg>,
    // so the two drawings are pinned to each other here: an edit to one that
    // does not match the other fails.
    const identity = generatedIdentityFor(REED);
    const card = shareCardSvg(shareCardFactsFor(REED));
    const mark = generatedMarkSvg(identity, { fontFamily: CARD_FONT_FAMILY });
    expect(card).toContain(`fill="${identity.variant.bg}"`);
    expect(mark).toContain(`fill="${identity.variant.bg}"`);
    expect(card).toContain(`fill="${identity.variant.fg}"`);
    expect(mark).toContain(`fill="${identity.variant.fg}"`);
    expect(card).toContain(`>${identity.initials}</text>`);
    expect(mark).toContain(`>${identity.initials}</text>`);
    // The tile's letters are centred by arithmetic in BOTH drawings: no
    // `dominant-baseline` on that run, `text-anchor="middle"`, and the same
    // baseline fraction. (The card's other runs DO carry
    // `dominant-baseline="hanging"` — that is @basenative/og-image's own
    // primitive, and `hanging` is a value resvg implements.)
    for (const svg of [card, mark]) {
      const tileRun = svg.match(/<text[^>]*text-anchor="middle"[^>]*>/)?.[0];
      expect(tileRun).toBeDefined();
      expect(tileRun).not.toContain('dominant-baseline');
    }
  });

  it('embeds an uploaded logo instead of the tile, and never crops it', () => {
    const facts = shareCardFactsFor({
      ...REED,
      logo_url: 'https://cdn.example/logo.png',
    });
    const identity = generatedIdentityFor(REED);
    const svg = shareCardSvg(facts, {
      logoDataUri: 'data:image/png;base64,AAAA',
    });
    expect(svg).toContain('<image');
    expect(svg).toContain('href="data:image/png;base64,AAAA"');
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
    // The generated letters are not drawn over their own logo.
    expect(svg).not.toContain(`>${identity.initials}</text>`);
    // The business name and trade still are — that is the point of the card.
    expect(svg).toContain('Reed HVAC');
  });

  it('falls back to the generated tile when no logo bytes were obtained', () => {
    const facts = shareCardFactsFor({
      ...REED,
      logo_url: 'https://cdn.example/logo.png',
    });
    const svg = shareCardSvg(facts);
    expect(svg).not.toContain('<image');
    expect(svg).toContain(`fill="${generatedIdentityFor(REED).variant.bg}"`);
  });

  it('names exactly one font family — a CSS stack means nothing to resvg', () => {
    const svg = shareCardSvg(shareCardFactsFor(REED));
    expect(svg).toContain(`font-family="${CARD_FONT_FAMILY}"`);
    expect(svg).not.toContain('system-ui');
  });

  it('always draws the ASCII host line, so a card always identifies someone', () => {
    // The shipped font is Latin. resvg draws a glyph it has no font for as
    // nothing at all, so a name in another script would be an empty line — the
    // host line is what keeps the card from being anonymous.
    const svg = shareCardSvg(shareCardFactsFor({ ...REED, name: 'שרברב טוב' }));
    expect(svg).toContain('reed-hvac.greenput.com');
  });
});

describe('markAssetSvg', () => {
  it('is 512 square and carries only the mark', () => {
    const svg = markAssetSvg(shareCardFactsFor(REED));
    expect(svg).toContain(
      `width="${GP_MARK_ASSET_SIZE.width}" height="${GP_MARK_ASSET_SIZE.height}"`,
    );
    expect(svg).not.toContain('Reed HVAC');
    expect(svg).toContain(`>${generatedIdentityFor(REED).initials}</text>`);
  });

  it('embeds an uploaded logo when there is one', () => {
    const svg = markAssetSvg(
      shareCardFactsFor({ ...REED, logo_url: 'https://cdn.example/l.png' }),
      { logoDataUri: 'data:image/jpeg;base64,BBBB' },
    );
    expect(svg).toContain('href="data:image/jpeg;base64,BBBB"');
  });
});

describe('every brand-asset case renders a well-formed, uninjectable card', () => {
  it.each(BRAND_ASSET_CASES.map((c) => [c.label, c] as const))(
    '%s',
    (_label, testCase) => {
      const facts = shareCardFactsFor(testCase.workspace);
      const card = shareCardSvg(facts);
      for (const svg of [card, markAssetSvg(facts)]) {
        assertWellFormedSvg(svg);
        // No element or attribute the scene did not write itself.
        expect(svg).not.toContain('<script');
        expect(svg).not.toContain('onerror');
        expect(svg).not.toContain('onload');
      }
      // A hostile name reaches the card only through escapeXml. (The mark
      // asset carries no name at all — only the derived `[A-Z0-9]` initials.)
      if (testCase.workspace.name.includes('<script>')) {
        expect(card).toContain('&lt;script&gt;');
      }
      if (testCase.workspace.name.includes('&')) {
        expect(card).toContain('&amp;');
      }
      if (testCase.workspace.name.includes('"')) {
        expect(card).toContain('&quot;');
      }
    },
  );

  it('keeps a 200-character name inside the canvas', () => {
    const longCase = BRAND_ASSET_CASES.find(
      (c) => c.label === 'very long name',
    );
    const svg = shareCardSvg(shareCardFactsFor(longCase?.workspace ?? REED));
    // Every text run's baseline must sit inside the 630px canvas, and no run may
    // start left of the 72px gutter.
    const ys = [...svg.matchAll(/<text[^>]*\by="([\d.-]+)"/g)].map((m) =>
      Number(m[1]),
    );
    const xs = [...svg.matchAll(/<text[^>]*\bx="([\d.-]+)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) {
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(GP_SHARE_CARD_SIZE.height);
    }
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(72);
      expect(x).toBeLessThan(GP_SHARE_CARD_SIZE.width);
    }
  });

  it('keeps every run inside the canvas for every case', () => {
    for (const testCase of BRAND_ASSET_CASES) {
      const svg = shareCardSvg(shareCardFactsFor(testCase.workspace));
      for (const match of svg.matchAll(/<text[^>]*\by="([\d.-]+)"/g)) {
        expect(Number(match[1]), testCase.label).toBeLessThan(
          GP_SHARE_CARD_SIZE.height,
        );
      }
    }
  });
});

describe('nothing the font cannot draw ever reaches the canvas', () => {
  // resvg draws a glyph it has no font for as the font's `.notdef` box, NOT as
  // nothing. Before this filter, "שרברב טוב" rendered as eight hollow boxes at
  // 1200x630 on workerd and "🌿" as one — measured, not assumed.
  it.each([
    ['ordinary', 'Reed HVAC', 'Reed HVAC'],
    ['accented Latin survives intact', 'Ångström Elektro', 'Ångström Elektro'],
    ['curly quotes survive', 'O’Brien — “Electric”', 'O’Brien — “Electric”'],
    ['emoji is dropped', '🌿', ''],
    [
      'emoji inside a name leaves a space, not a join',
      'Reed🌿HVAC',
      'Reed HVAC',
    ],
    ['hebrew is dropped', 'שרברב טוב', ''],
    ['CJK is dropped', '電気工事', ''],
    ['mixed keeps the Latin run', '電気工事 Electric', 'Electric'],
    ['punctuation survives', '24/7 & "Sons" <Co>', '24/7 & "Sons" <Co>'],
    ['whitespace collapses', '  Reed   HVAC  ', 'Reed HVAC'],
  ])('%s', (_label, input, expected) => {
    expect(drawableText(input)).toBe(expected);
  });

  function textRuns(svg: string): string[] {
    return [...svg.matchAll(/>([^<]*)<\/text>/g)].map((m) =>
      String(m[1])
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&'),
    );
  }

  it('falls back to the hostname when nothing of the name is drawable', () => {
    for (const name of ['🌿', 'שרברב טוב', '電気工事', '!!!']) {
      const runs = textRuns(shareCardSvg(shareCardFactsFor({ ...REED, name })));
      // The hostname becomes the title, and is not then repeated as a footer.
      expect(runs, name).toContain('reed-hvac.greenput.com');
      expect(
        runs.filter((t) => t === 'reed-hvac.greenput.com'),
        name,
      ).toHaveLength(1);
      for (const t of runs) {
        expect(drawableText(t), `${name} -> ${t}`).toBe(t);
      }
    }
  });

  it('keeps the footer when the name is drawable', () => {
    const runs = textRuns(shareCardSvg(shareCardFactsFor(REED)));
    expect(runs).toContain('Reed HVAC');
    expect(runs).toContain('reed-hvac.greenput.com');
  });

  it('filters a free-text trade too', () => {
    // `workspaces.trade` is free text — whatever the owner typed.
    const runs = textRuns(
      shareCardSvg(shareCardFactsFor({ ...REED, trade: '電気工事' })),
    );
    expect(runs).toContain('Austin, TX');
    for (const t of runs) expect(drawableText(t)).toBe(t);
  });

  it('draws every fixture case with only drawable glyphs, and always names someone', () => {
    for (const testCase of BRAND_ASSET_CASES) {
      const runs = textRuns(
        shareCardSvg(shareCardFactsFor(testCase.workspace)),
      );
      for (const t of runs) {
        expect(drawableText(t), `${testCase.label} -> ${t}`).toBe(t);
      }
      expect(runs.length, testCase.label).toBeGreaterThan(0);
    }
  });
});
