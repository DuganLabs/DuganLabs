import { describe, expect, it } from 'vitest';

import {
  GP_MARK_PALETTE,
  GP_MARK_RESERVED_HEXES,
  generatedIdentityFor,
  generatedMarkSvg,
} from './brand-identity.js';
import { contrastRatio } from './contrast.js';
import { GP_BRAND_INK, GP_BRAND_LEAF } from './tokens.js';

describe('GP_MARK_PALETTE', () => {
  it('gives every letterform at least AA contrast on its tile', () => {
    for (const variant of GP_MARK_PALETTE) {
      const ratio = contrastRatio(variant.fg, variant.bg);
      expect(
        ratio,
        `${variant.id} (${variant.fg} on ${variant.bg}) is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("never uses Greenput's own two brand hexes as a tile", () => {
    // A contractor's mark must not be mistakable for the platform's leaf.
    expect(GP_MARK_RESERVED_HEXES).toEqual([GP_BRAND_INK, GP_BRAND_LEAF]);
    for (const variant of GP_MARK_PALETTE) {
      expect(GP_MARK_RESERVED_HEXES).not.toContain(variant.bg.toUpperCase());
    }
  });

  it('has distinct ids and enough colourways to separate businesses', () => {
    const ids = GP_MARK_PALETTE.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(GP_MARK_PALETTE.length).toBeGreaterThanOrEqual(12);
  });
});

describe('generatedIdentityFor — determinism', () => {
  it('gives the same business the same mark every time', () => {
    const a = generatedIdentityFor({ name: 'Reed HVAC', slug: 'reed-hvac' });
    const b = generatedIdentityFor({ name: 'Reed HVAC', slug: 'reed-hvac' });
    expect(a).toEqual(b);
  });

  it('keeps the colourway across a rename, and moves the letters', () => {
    // The seed is the slug, which /api/auth/register assigns once and nothing
    // rewrites. This is the whole reason the seed is not the name: a rename must
    // not repaint a mark that is already on shared cards.
    const before = generatedIdentityFor({
      name: 'Reed HVAC',
      slug: 'reed-hvac',
    });
    const after = generatedIdentityFor({
      name: 'Reed Heating & Air',
      slug: 'reed-hvac',
    });
    expect(after.variant).toEqual(before.variant);
    expect(before.initials).toBe('RH');
    expect(after.initials).toBe('RA');
  });

  it('is insensitive to case and whitespace spelling of the seed', () => {
    expect(
      generatedIdentityFor({ slug: 'Reed-HVAC', name: 'x' }).variant,
    ).toEqual(generatedIdentityFor({ slug: 'reed-hvac', name: 'x' }).variant);
    expect(generatedIdentityFor({ name: '  Acme  Electric ' }).variant).toEqual(
      generatedIdentityFor({ name: 'acme electric' }).variant,
    );
  });

  it('spreads a realistic set of business names across the palette', () => {
    // Not a uniformity proof — a guard that the hash is not degenerate. A
    // single-bucket bug (a hash that overflows to NaN, say) fails here.
    const slugs = Array.from({ length: 400 }, (_, i) => `contractor-${i}-llc`);
    const used = new Set(
      slugs.map(
        (slug) => generatedIdentityFor({ name: slug, slug }).variant.id,
      ),
    );
    expect(used.size).toBe(GP_MARK_PALETTE.length);
  });

  it('is stable against a hand-computed FNV-1a bucket', () => {
    // Pins the arithmetic itself. If Math.imul were replaced by `*`, or the
    // canonicalisation changed, this moves — and moving it repaints every
    // existing contractor's logo, which is exactly what must not happen
    // silently.
    expect(
      generatedIdentityFor({ name: 'Demo Electric', slug: 'demo' }).seed,
    ).toBe('demo');
    expect(
      generatedIdentityFor({ name: 'Demo Electric', slug: 'demo' }).variant.id,
    ).toBe(GP_MARK_PALETTE[fnvBucket('demo')]?.id);
  });
});

/** An independent reimplementation, so the spec is not the code under test. */
function fnvBucket(seed: string): number {
  let hash = 0x811c9dc5;
  for (const ch of seed) {
    hash ^= ch.codePointAt(0) as number;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % GP_MARK_PALETTE.length;
}

describe('generatedIdentityFor — the names that break things', () => {
  const cases: [
    label: string,
    name: string,
    slug: string | null,
    initials: string,
  ][] = [
    ['ordinary two words', 'Reed HVAC', 'reed-hvac', 'RH'],
    ['single word', 'Voltage', 'voltage', 'VO'],
    ['single letter', 'Q', 'q-a1b2c3', 'Q'],
    ['digits lead', '24/7 Plumbing', '247-plumbing', '2P'],
    ['accented Latin', 'Ångström Elektro', 'angstrom-elektro', 'AE'],
    ['curly apostrophe', 'O’Brien Electric', 'obrien-electric', 'OE'],
    // Every one of these has no Latin alphanumeric in the NAME, so the
    // letters come from the slug — which /api/auth/register guarantees is
    // `[a-z0-9-]`, and gives `site-<hex>` when the name slugifies to nothing.
    ['one emoji', '🌿', 'site-a1b2c3', 'SA'],
    ['pure punctuation', '!!!???', 'site-d4e5f6', 'SD'],
    ['right-to-left', 'שרברב טוב', 'site-9a8b7c', 'S9'],
    ['CJK', '電気工事', 'site-112233', 'S1'],
    [
      'html metacharacters',
      '<script>alert(1)</script>',
      'script-alert-1',
      'SS',
    ],
    ['ampersand and quotes', 'Bob & "Sons"', 'bob-sons', 'BS'],
    ['empty name, slug only', '', 'acme-electric', 'AE'],
    ['empty name and no slug', '', null, ''],
    ['emoji name and no slug', '🌿', null, ''],
    ['200 characters', `${'Long'.repeat(48)} Electric`, 'long-electric', 'LE'],
  ];

  it.each(cases)('%s → %s', (_label, name, slug, initials) => {
    const identity = generatedIdentityFor({ name, slug });
    expect(identity.initials).toBe(initials);
    // Whatever the input, the mark is drawable: a real palette entry, and
    // letters that a Latin font can actually render.
    expect(GP_MARK_PALETTE).toContain(identity.variant);
    expect(identity.initials).toMatch(/^[A-Z0-9]{0,2}$/);
  });

  it('never throws on a name of 5000 characters', () => {
    const name = 'é🌿<>&"'.repeat(800);
    expect(() =>
      generatedIdentityFor({ name, slug: 'site-x1y2z3' }),
    ).not.toThrow();
  });
});

describe('generatedMarkSvg', () => {
  const identity = generatedIdentityFor({
    name: 'Reed HVAC',
    slug: 'reed-hvac',
  });

  it('draws a tile in the identity colour with the identity letters', () => {
    const svg = generatedMarkSvg(identity, { size: 48 });
    expect(svg).toContain(`fill="${identity.variant.bg}"`);
    expect(svg).toContain(`fill="${identity.variant.fg}"`);
    expect(svg).toContain('>RH</text>');
    expect(svg).toContain('width="48" height="48"');
    expect(svg).toContain('viewBox="0 0 48 48"');
  });

  it('centres the letters with arithmetic, not dominant-baseline', () => {
    // resvg ignores `dominant-baseline: central`; a mark that relied on it would
    // look right in Chrome and sit on the tile's bottom edge in the PNG.
    const svg = generatedMarkSvg(identity);
    expect(svg).not.toContain('dominant-baseline');
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toMatch(/y="31\.35"/);
  });

  it('is aria-hidden unless given a title, and escapes that title', () => {
    expect(generatedMarkSvg(identity)).toContain('aria-hidden="true"');
    const titled = generatedMarkSvg(identity, {
      title: 'Bob & "Sons" <Electric>',
    });
    expect(titled).toContain('role="img"');
    expect(titled).toContain(
      'aria-label="Bob &amp; &quot;Sons&quot; &lt;Electric&gt;"',
    );
    expect(titled).not.toContain('<Electric>');
  });

  it('draws a bare tile when there are no letters to draw', () => {
    const blank = generatedIdentityFor({ name: '🌿', slug: null });
    const svg = generatedMarkSvg(blank);
    expect(svg).not.toContain('<text');
    expect(svg).toContain('<rect');
  });

  it('cannot be broken out of by a hostile name or title', () => {
    const hostile = generatedIdentityFor({
      name: '"><script>alert(1)</script>',
      slug: 'x-script-alert-1',
    });
    const svg = generatedMarkSvg(hostile, { title: '"><img onerror=x>' });
    // No new element and no attribute boundary can be opened: the only `<` and
    // `"` characters left are the ones this function wrote itself.
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('<img');
    // Exactly the elements a benign name with the same slug gets — the
    // treatment adds geometry, the hostile input adds nothing.
    const benign = generatedMarkSvg(
      generatedIdentityFor({ name: 'Ok Name', slug: 'x-script-alert-1' }),
      { title: 'ok' },
    );
    expect(svg.match(/</g)).toHaveLength(benign.match(/</g)?.length ?? -1);
    expect(svg.match(/<svg/g)).toHaveLength(1);
    expect(svg).toContain('&lt;img onerror=x&gt;');
    expect(svg).toContain('&quot;&gt;');
  });
});

// ─────────────────────────────────────────────────────────────
// GP-109 — two contractors must not get the same mark.
//
// Initials × 15 colourways collided at the designed rate (~0.73 expected full
// collisions at 50 tenants, quadratic after that). The treatment and shape
// axes are asserted as a PROPERTY over a plausible population, not as the
// instance that happened to collide.
// ─────────────────────────────────────────────────────────────
describe('generatedIdentityFor — no two businesses share a mark (GP-109)', () => {
  const ADJ = [
    'cascade',
    'clearwater',
    'summit',
    'pioneer',
    'lone-star',
    'evergreen',
    'bluebonnet',
    'hill-country',
    'riverside',
    'northstar',
    'apex',
    'liberty',
    'precision',
    'reliable',
    'premier',
    'metro',
    'valley',
    'coastal',
    'heritage',
    'allied',
    'true-north',
    'brightline',
    'copper-ridge',
    'granite',
    'redwood',
  ];
  const TRADE = [
    'plumbing',
    'electric',
    'hvac',
    'roofing',
    'solar',
    'fence',
    'drain',
    'electrical',
    'mechanical',
    'services',
  ];
  const TOWN = ['austin', 'tyler', 'waco'];
  const slugs: string[] = [];
  for (const a of ADJ) for (const t of TRADE) slugs.push(`${a}-${t}`);
  for (const a of ADJ.slice(0, 10))
    for (const t of TRADE.slice(0, 5))
      for (const town of TOWN) slugs.push(`${a}-${t}-${town}`);
  const population = slugs.slice(0, 500);

  const key = (id: ReturnType<typeof generatedIdentityFor>) =>
    `${id.initials}|${id.variant.id}|${id.treatment}|${id.accent.id}|${id.shape}|${id.orientation}`;

  it('has a population worth testing', () => {
    expect(population.length).toBeGreaterThanOrEqual(400);
  });

  it('the known real pair — cascade-plumbing and clearwater-plumbing — no longer collide', () => {
    const a = generatedIdentityFor({
      name: 'Cascade Plumbing',
      slug: 'cascade-plumbing',
    });
    const b = generatedIdentityFor({
      name: 'Clearwater Plumbing',
      slug: 'clearwater-plumbing',
    });
    expect(a.initials).toBe(b.initials); // that part is real
    expect(key(a)).not.toBe(key(b));
    expect(generatedMarkSvg(a)).not.toBe(generatedMarkSvg(b));
  });

  it('over the population, no two businesses share initials, colourway, treatment, accent AND shape', () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];
    for (const slug of population) {
      const name = slug
        .split('-')
        .map((w) => w[0]?.toUpperCase() + w.slice(1))
        .join(' ');
      const k = key(generatedIdentityFor({ name, slug }));
      const prior = seen.get(k);
      if (prior) collisions.push(`${prior} = ${slug} (${k})`);
      else seen.set(k, slug);
    }
    expect(collisions, collisions.join('; ')).toEqual([]);
  });

  it('draws every treatment and shape, and the colourway is untouched by them', () => {
    const treatments = new Set<string>();
    const shapes = new Set<string>();
    for (const slug of population) {
      const id = generatedIdentityFor({ name: slug, slug });
      treatments.add(id.treatment);
      shapes.add(id.shape);
      // The colourway is still the low-bits bucket the palette shipped with.
      expect(id.variant.id).toBe(GP_MARK_PALETTE[fnvBucket(slug)]?.id);
    }
    expect([...treatments].sort()).toEqual([
      'notch',
      'ring',
      'split',
      'stripe',
    ]);
    expect([...shapes].sort()).toEqual(['round', 'rounded']);
  });
});
