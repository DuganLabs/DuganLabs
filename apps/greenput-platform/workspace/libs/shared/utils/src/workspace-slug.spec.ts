import { describe, it, expect } from 'vitest';
import { isValidSlug } from './slug';
import {
  MAX_WORKSPACE_SLUG_BASE,
  RESERVED_SUBDOMAINS,
  UNAVAILABLE_WORKSPACE_SLUGS,
  isReservedSlug,
  isWorkspaceSlugUnavailable,
  workspaceSlugBase,
  workspaceSlugCandidates,
} from './workspace-slug';

// A real v4 UUID, the shape `newId()` produces. The suffixes are cut from it,
// so the expected values below are computable rather than guessed.
const ID = '3f8a2c91-7b4d-4e2a-9c11-5d6e7f809a1b';
const SUFFIXES = ['3f8a2c', '917b4d', '4e2a9c', '115d6e'];

describe('RESERVED_SUBDOMAINS', () => {
  it('holds the subdomains apps/tenant-site refuses to resolve', () => {
    expect([...RESERVED_SUBDOMAINS].sort()).toEqual([
      'admin',
      'api',
      'app',
      'brand',
      'fallback',
      'greenput',
      'mail',
      'marketing',
      'staging',
      'www',
    ]);
  });

  it('does NOT contain demo, which is a real tenant the Worker must resolve', () => {
    // demo.greenput.com is the one tenant hostname bound in
    // apps/tenant-site/wrangler.toml and CI seeds a workspace with slug `demo`
    // into both live databases. Putting `demo` in this set would 404 the only
    // micro-site that resolves today. It belongs in
    // UNAVAILABLE_WORKSPACE_SLUGS, which is about allocation, not resolution.
    expect(RESERVED_SUBDOMAINS.has('demo')).toBe(false);
    expect(isReservedSlug('demo')).toBe(false);
  });

  it('matches case-insensitively', () => {
    expect(isReservedSlug('WWW')).toBe(true);
    expect(isReservedSlug(' api ')).toBe(true);
    expect(isReservedSlug('acme-electric')).toBe(false);
  });
});

describe('UNAVAILABLE_WORKSPACE_SLUGS', () => {
  it('is a superset of the Worker refusal list, plus the names the platform owns', () => {
    for (const reserved of RESERVED_SUBDOMAINS) {
      expect(UNAVAILABLE_WORKSPACE_SLUGS.has(reserved)).toBe(true);
    }
    // `demo`: Greenput's showcase tenant, seeded into production.
    // `greenput`: what apps/tenant-site derives from a request to greenput.com.
    expect(isWorkspaceSlugUnavailable('demo')).toBe(true);
    expect(isWorkspaceSlugUnavailable('greenput')).toBe(true);
    expect(isWorkspaceSlugUnavailable('acme-electric')).toBe(false);
  });

  // Load-bearing, not tidiness: every suffixed candidate contains a hyphen, and
  // that is the whole argument for why a suffixed candidate can never be an
  // unavailable name.
  it('contains no entry with a hyphen', () => {
    for (const name of UNAVAILABLE_WORKSPACE_SLUGS) {
      expect(name).not.toContain('-');
      expect(isValidSlug(name)).toBe(true);
    }
  });
});

describe('workspaceSlugBase', () => {
  it('slugifies a company name', () => {
    expect(workspaceSlugBase('Acme Electric')).toBe('acme-electric');
  });

  it.each([
    // The apostrophe cases. Both forms are deleted rather than turned into a
    // word boundary, so the company's name survives: `bob-s-plumbing` was the
    // old output for the straight form and the curly form is what an iOS or
    // macOS keyboard actually types.
    ["Bob's Plumbing & Co.", 'bobs-plumbing-co'],
    ['Bob’s Plumbing & Co.', 'bobs-plumbing-co'],
    ['O’Brien Electric', 'obrien-electric'],
    ['Bobʼs Plumbing', 'bobs-plumbing'],
    // Accents fold to the letter rather than being dropped: `caf-lectrique`
    // was the old output for the first of these.
    ['Café Électrique', 'cafe-electrique'],
    ['Müller Elektro', 'muller-elektro'],
    ['Père & Fils Électricité', 'pere-fils-electricite'],
    ['Señor Sparks', 'senor-sparks'],
    // Letters NFKD cannot decompose, because they are letters in their own
    // right rather than accented ASCII.
    ['Straße Elektro', 'strasse-elektro'],
    ['Blåbær Strøm', 'blabaer-strom'],
    ['Łukasz Wiring', 'lukasz-wiring'],
    ['Þór Electric', 'thor-electric'],
    ['Œuvre Électrique', 'oeuvre-electrique'],
    // Dashes and symbols.
    ['ACME – Electric', 'acme-electric'],
    ['ACME ‐ Electric', 'acme-electric'],
    ['ACME — Electric', 'acme-electric'],
    ['Acme™ Electric', 'acme-electric'],
    ['Acme® Electric', 'acme-electric'],
    ['Acme © Electric', 'acme-electric'],
    // Whitespace of any kind is still a word boundary.
    ['Acme\tElectric', 'acme-electric'],
    ['Acme\nElectric', 'acme-electric'],
    ['Acme Electric', 'acme-electric'],
  ])('folds %s to %s', (name, expected) => {
    expect(workspaceSlugBase(name)).toBe(expected);
  });

  it('is empty for a name with nothing slug-able in it', () => {
    expect(workspaceSlugBase('!!!')).toBe('');
    expect(workspaceSlugBase('株式会社テスト')).toBe('');
    expect(workspaceSlugBase('   ')).toBe('');
  });

  it('does not transliterate a script it cannot, rather than inventing a name', () => {
    // Transliterating Cyrillic or Greek would hand the contractor a name they
    // never chose, and would open a homoglyph route to a reserved label
    // (Cyrillic `аpi` -> `api`). These fall through to the `site-` fallback.
    expect(workspaceSlugBase('Электрика')).toBe('');
    expect(workspaceSlugBase('Ηλεκτρικά')).toBe('');
    expect(workspaceSlugBase('аpi')).not.toBe('api');
  });

  it('truncates a long name without leaving a trailing hyphen', () => {
    const base = workspaceSlugBase(
      'The Extremely Long Name Of A Very Thorough Electrical Contracting Company',
    );
    expect(base.length).toBeLessThanOrEqual(MAX_WORKSPACE_SLUG_BASE);
    expect(base.endsWith('-')).toBe(false);
    expect(isValidSlug(base)).toBe(true);
  });
});

describe('workspaceSlugCandidates', () => {
  it('offers the bare slug first, then id-derived alternates', () => {
    expect(workspaceSlugCandidates('Acme Electric', ID)).toEqual([
      'acme-electric',
      ...SUFFIXES.map((s) => `acme-electric-${s}`),
    ]);
  });

  it('is deterministic for a given name and id', () => {
    expect(workspaceSlugCandidates('Acme Electric', ID)).toEqual(
      workspaceSlugCandidates('Acme Electric', ID),
    );
  });

  it('gives two workspaces of the same name disjoint alternates', () => {
    const other = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const first = workspaceSlugCandidates('Acme Electric', ID);
    const second = workspaceSlugCandidates('Acme Electric', other);
    // Only the bare slug is contested; whoever loses it has somewhere to go.
    expect(first.filter((s) => second.includes(s))).toEqual(['acme-electric']);
  });

  it('never offers an unavailable name, bare or suffixed', () => {
    for (const unavailable of UNAVAILABLE_WORKSPACE_SLUGS) {
      const candidates = workspaceSlugCandidates(unavailable, ID);
      expect(candidates).not.toContain(unavailable);
      expect(candidates[0]).toBe(`${unavailable}-${SUFFIXES[0]}`);
      for (const candidate of candidates) {
        expect(isWorkspaceSlugUnavailable(candidate)).toBe(false);
      }
    }
  });

  it('refuses the showcase tenant address to a company called Demo', () => {
    // Before UNAVAILABLE_WORKSPACE_SLUGS existed, this returned `demo` first
    // and only a SELECT against the seeded row stood in the way.
    expect(workspaceSlugCandidates('Demo', ID)[0]).toBe(`demo-${SUFFIXES[0]}`);
    expect(workspaceSlugCandidates('GreenPut', ID)[0]).toBe(
      `greenput-${SUFFIXES[0]}`,
    );
  });

  it('still produces something usable when the name slugifies to nothing', () => {
    for (const name of ['!!!', '株式会社テスト', '   ', '.', '()']) {
      const candidates = workspaceSlugCandidates(name, ID);
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0]).toBe(`site-${SUFFIXES[0]}`);
      for (const candidate of candidates) {
        expect(isValidSlug(candidate)).toBe(true);
      }
    }
  });

  it('suffixes a name too short to hand out bare', () => {
    expect(workspaceSlugCandidates('A', ID)[0]).toBe(`a-${SUFFIXES[0]}`);
    expect(workspaceSlugCandidates('AB', ID)[0]).toBe(`ab-${SUFFIXES[0]}`);
    expect(workspaceSlugCandidates('ABC', ID)[0]).toBe('abc');
  });

  it('returns valid, distinct, never-unavailable slugs for hostile names too', () => {
    const names = [
      'Acme Electric',
      "Bob's Plumbing & Co.",
      'Smith & Sons HVAC, Inc.',
      'O(1) Wiring + Solar/Battery',
      '株式会社テスト',
      '!!!',
      'WWW',
      '123',
      'A-B',
      'X'.repeat(200),
      '-'.repeat(50),
      '--acme--',
      'ＡＰＩ', // fullwidth: NFKD folds it to `api`, which must be caught
      'ᴀᴘɪ', // small caps
      'аpi', // Cyrillic homoglyph
      'ＤＥＭＯ',
      'Ｇｒｅｅｎｐｕｔ',
      '../../etc/passwd',
      '<script>alert(1)</script>',
      'null',
      'undefined',
      '🙂🙂🙂',
      'Café'.repeat(30),
      'ß'.repeat(40),
    ];
    for (const name of names) {
      const candidates = workspaceSlugCandidates(name, ID);
      expect(candidates.length, name).toBeGreaterThan(0);
      expect(new Set(candidates).size).toBe(candidates.length);
      for (const candidate of candidates) {
        expect(isValidSlug(candidate), `${name} -> ${candidate}`).toBe(true);
        expect(
          isWorkspaceSlugUnavailable(candidate),
          `${name} -> ${candidate}`,
        ).toBe(false);
        // A DNS label is 63 characters; every slug has to fit in one.
        expect(candidate.length, `${name} -> ${candidate}`).toBeLessThanOrEqual(
          63,
        );
      }
    }
  });

  it('still returns a candidate for an id too short to cut a suffix from', () => {
    // Not a shape `newId()` produces, but a fixture id in a test is, and
    // returning an empty candidate list would be a silent 409.
    expect(workspaceSlugCandidates('Acme Electric', 'ws-1')).toEqual([
      'acme-electric',
      'acme-electric-ws1',
    ]);
  });
});
