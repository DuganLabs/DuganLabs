import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import {
  brandAssetUrls,
  brandAssetVersion,
  generatedIdentityFor,
  shareCardFactsFor,
  GP_MARK_PALETTE,
  type GpBrandAssetSource,
} from '@greenput/shared/design';

import { authRouter } from './auth';
// The Worker that answers the URL /register hands back. A relative import into
// a sibling app, on purpose: this is the one test that drives signup and the
// card from the same database row, and it is a spec, so the rasterizer never
// enters this Worker's bundle (apps/api/tsconfig.json excludes *.spec.ts).
import { handleRequest as brandWorker } from '../../../brand-assets/src/index';

/**
 * What `/api/auth/register` does about a logo, asserted against a real SQLite
 * database built from `schema.sql` — not a `vi.fn()` DB, which never parses the
 * SQL it is handed.
 *
 * The claim under test is a NEGATIVE one as much as a positive one: signup mints
 * a mark and writes NO logo. A test that only checked the response body would
 * pass even if the route had quietly stamped a generated URL into
 * `workspaces.logo_url` — which is the thing that must never happen, because
 * that column is the only record of whether the contractor gave us an image.
 */
const REPO = join(__dirname, '..', '..', '..', '..');
const SCHEMA = join(REPO, 'schema.sql');
const API_ORIGIN = 'https://api.greenput.com';
const BRAND_ORIGIN = 'https://brand.greenput.com';

interface WorkspaceRow {
  id: string;
  name: string;
  slug: string | null;
  trade: string;
  city: string;
  state: string;
  logo_url: string | null;
  custom_hostname: string | null;
  custom_domain_status: string | null;
}

interface RegisterLogo {
  generated: boolean;
  initials: string;
  color: string;
  onColor: string;
  markUrl?: string;
  cardUrl?: string;
}

let sqlite: SqliteD1 | null = null;

afterEach(() => {
  sqlite?.close();
  sqlite = null;
});

function makeEnv() {
  sqlite = createSqliteD1({ files: [SCHEMA] });
  return {
    env: {
      DB: sqlite.db,
      SESSIONS: {
        put: async () => undefined,
        get: async () => null,
        delete: async () => undefined,
      },
      ENVIRONMENT: 'test',
      BRAND_ORIGIN,
    } as unknown as Parameters<typeof authRouter.fetch>[1],
    sqlite,
  };
}

async function register(
  env: unknown,
  workspaceName: string,
  email = 'jane@example.test',
  overrides: Record<string, unknown> = {},
): Promise<{ status: number; slug: string; logo: RegisterLogo }> {
  const res = await authRouter.fetch(
    new Request(`${API_ORIGIN}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Jane',
        lastName: 'Smith',
        email,
        workspaceName,
        trade: 'hvac',
        phone: '9495550187',
        street: '1 Main St',
        city: 'Austin',
        state: 'TX',
        zip: '78701',
        ...overrides,
      }),
    }),
    env,
  );
  const body = (await res.json()) as {
    data?: { workspace?: { slug?: string; logo?: RegisterLogo } };
  };
  return {
    status: res.status,
    slug: String(body.data?.workspace?.slug ?? ''),
    logo: body.data?.workspace?.logo as RegisterLogo,
  };
}

function workspaceRow(db: SqliteD1): WorkspaceRow {
  return db.rows<WorkspaceRow>('workspaces')[0] as WorkspaceRow;
}

describe('POST /api/auth/register mints a logo without writing one', () => {
  it('leaves workspaces.logo_url NULL', async () => {
    const { env, sqlite: db } = makeEnv();
    const result = await register(env, 'Reed HVAC');
    expect(result.status).toBe(201);

    const row = workspaceRow(db);
    // The bit that distinguishes "the contractor uploaded a logo" from "we drew
    // one" survives signup. Six call sites in this repo branch on it.
    expect(row.logo_url).toBeNull();
    // And nothing anywhere in the row is a brand-asset URL.
    expect(JSON.stringify(row)).not.toContain('brand.greenput.com');
  });

  it('returns the generated identity the rest of the product will derive', async () => {
    const { env, sqlite: db } = makeEnv();
    const result = await register(env, 'Reed HVAC');
    const row = workspaceRow(db);

    const derived = generatedIdentityFor(row);
    expect(result.logo.generated).toBe(true);
    expect(result.logo.initials).toBe(derived.initials);
    expect(result.logo.initials).toBe('RH');
    expect(result.logo.color).toBe(derived.variant.bg);
    expect(result.logo.onColor).toBe(derived.variant.fg);
    expect(GP_MARK_PALETTE.map((v) => v.bg)).toContain(result.logo.color);
  });

  it('addresses both assets on the brand Worker, not on this one', async () => {
    const { env, sqlite: db } = makeEnv();
    const result = await register(env, 'Reed HVAC');
    const row = workspaceRow(db);
    const urls = brandAssetUrls(BRAND_ORIGIN, row);
    expect(result.logo.cardUrl).toBe(urls?.cardUrl);
    expect(result.logo.markUrl).toBe(urls?.markUrl);
    expect(result.logo.cardUrl).toBe(
      `${BRAND_ORIGIN}/${row.slug}/${urls?.version}/card.png`,
    );
  });

  it('serves the card it just advertised, from the row it just wrote', async () => {
    // Signup → URL → the real brand Worker → 200, in one test. The version in
    // the URL /register handed back must be the version the Worker computes
    // from the row /register inserted.
    const { env, sqlite: db } = makeEnv();
    const result = await register(env, 'Reed HVAC');
    const path = new URL(String(result.logo.cardUrl)).pathname;

    const svgs: string[] = [];
    const res = await brandWorker(
      new Request(`${BRAND_ORIGIN}${path}`),
      env as unknown as Parameters<typeof brandWorker>[1],
      undefined,
      {
        cache: null,
        rasterize: async (svg) => {
          svgs.push(svg);
          return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        },
      },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('immutable');
    expect(res.headers.get('X-Gp-Brand-Version')).toBe(
      brandAssetVersion(shareCardFactsFor(workspaceRow(db))),
    );
    expect(svgs[0]).toContain('Reed HVAC');
    expect(svgs[0]).toContain('HVAC · Austin, TX');
    // The number the contractor publishes on their own site does not syndicate.
    expect(svgs[0]).not.toContain('9495550187');
    expect(svgs[0]).not.toContain('+1949');
  });

  it('does not let a later upload be overwritten, or repaint the colour', async () => {
    const { env, sqlite: db } = makeEnv();
    await register(env, 'Reed HVAC');
    const before = generatedIdentityFor(workspaceRow(db));

    // The contractor uploads a logo later, through the ordinary write path.
    db.raw.exec(
      "UPDATE workspaces SET logo_url = 'https://cdn.example/mine.png'",
    );
    const after = workspaceRow(db);
    expect(after.logo_url).toBe('https://cdn.example/mine.png');
    // Nothing regenerated over it — there is nothing to regenerate, because
    // nothing was stored. And their colourway is unchanged, so the mark on an
    // invoice they already sent still matches.
    expect(generatedIdentityFor(after).variant).toEqual(before.variant);
  });

  it('keeps the colour and moves the card URL when the business is renamed', async () => {
    const { env, sqlite: db } = makeEnv();
    const result = await register(env, 'Reed HVAC');
    const before = workspaceRow(db);

    db.raw.exec("UPDATE workspaces SET name = 'Reed Heating & Air'");
    const after = workspaceRow(db);

    expect(after.slug).toBe(before.slug);
    expect(generatedIdentityFor(after).variant).toEqual(
      generatedIdentityFor(before).variant,
    );
    expect(generatedIdentityFor(after).initials).toBe('RA');
    expect(brandAssetUrls(BRAND_ORIGIN, after)?.cardUrl).not.toBe(
      result.logo.cardUrl,
    );
  });
});

describe('the names that must not break signup', () => {
  it.each([
    ['one emoji', '🌿'],
    ['pure punctuation', '!!!???'],
    ['right-to-left', 'שרברב טוב'],
    ['CJK', '電気工事'],
    ['html metacharacters', '"><script>alert(1)</script>'],
    ['ampersand', 'Bob & "Sons"'],
    // 200 characters exactly — the ceiling RegisterSchema allows.
    [
      '200 characters',
      'R'.repeat(96) +
        ' Mechanical Systems of Greater Austin '.repeat(2) +
        'X'.repeat(28),
    ],
    ['leading digits', '24/7 Plumbing'],
    ['accented', 'Ångström Elektro'],
  ])('%s registers and gets a drawable mark', async (_label, name) => {
    const { env, sqlite: db } = makeEnv();
    const result = await register(env, name);
    expect(result.status).toBe(201);

    const row = workspaceRow(db);
    expect(row.logo_url).toBeNull();
    expect(GP_MARK_PALETTE.map((v) => v.bg)).toContain(result.logo.color);
    // Latin-safe letters, or none — never a glyph the shipped font would draw
    // as nothing.
    expect(result.logo.initials).toMatch(/^[A-Z0-9]{0,2}$/);
    // The slug always supplies letters, so a registered workspace always has
    // some: `workspaceSlugCandidates` falls back to `site-<hex>`.
    expect(result.logo.initials.length).toBeGreaterThan(0);

    // And the card for it renders and serves.
    const svgs: string[] = [];
    const res = await brandWorker(
      new Request(
        `${BRAND_ORIGIN}${new URL(String(result.logo.cardUrl)).pathname}`,
      ),
      env as unknown as Parameters<typeof brandWorker>[1],
      undefined,
      {
        cache: null,
        rasterize: async (svg) => {
          svgs.push(svg);
          return new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        },
      },
    );
    expect(res.status).toBe(200);
    expect(svgs[0]).not.toContain('<script>alert');
    expect(svgs[0]).toContain(`${row.slug}.greenput.com`);
  });
});

describe('existing workspaces need no backfill', () => {
  it('derives a mark for a row that predates this feature', async () => {
    // A row written before any of this: no brand column, because there is no
    // brand column. Nothing to migrate — reading it is enough.
    sqlite = createSqliteD1({ files: [SCHEMA] });
    sqlite.raw.exec(
      `INSERT INTO workspaces (id, name, slug, trade, phone, email, street, city, state, zip, created_at)
       VALUES ('w-old', 'Green Electric', 'green-electric', 'electrical', '+15125550142', 'a@b.c', '1 Main', 'Austin', 'TX', '78701', '2026-03-01T00:00:00Z')`,
    );
    const row = workspaceRow(sqlite);
    expect(row.logo_url).toBeNull();

    const identity = generatedIdentityFor(row);
    expect(identity.initials).toBe('GE');
    expect(GP_MARK_PALETTE).toContain(identity.variant);
    expect(brandAssetUrls(BRAND_ORIGIN, row)).not.toBeNull();
  });

  it('still derives one for the five rows in `greenput` that carry slug NULL', () => {
    const slugless: GpBrandAssetSource & { name: string } = {
      name: 'Legacy Workspace',
      slug: null,
      trade: 'electrical',
      city: 'Austin',
      state: 'TX',
      logo_url: null,
    };
    const identity = generatedIdentityFor(slugless);
    // The seed falls back to the name — which is what a stored column would
    // have been seeded from for these rows anyway.
    expect(identity.seed).toBe('legacy workspace');
    expect(identity.initials).toBe('LW');
    // But there is no route to address, so no card URL is advertised.
    expect(brandAssetUrls(BRAND_ORIGIN, slugless)).toBeNull();
  });
});
