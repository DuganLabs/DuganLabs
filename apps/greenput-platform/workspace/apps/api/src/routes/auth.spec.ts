import { afterEach, describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { DEFAULT_BRAND_PRIMARY_COLOR } from '@greenput/shared/models';
import { authRouter } from './auth';

function makeEnv() {
  return {
    DB: {
      prepare: vi.fn().mockReturnValue({
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({}),
      }),
      // register() writes workspace + user + activity_log in one batch so a
      // failure cannot leave an orphan workspace behind.
      batch: vi
        .fn()
        .mockImplementation(async (statements: unknown[]) =>
          statements.map(() => ({ success: true, results: [], meta: {} })),
        ),
    },
    SESSIONS: {
      put: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
    },
    ENVIRONMENT: 'development',
  };
}

function makeReq(
  path: string,
  init: RequestInit = {},
  user?: Record<string, unknown>,
) {
  const req = new Request(`https://api.greenput.com/api/auth${path}`, init);
  if (user) {
    (req as unknown as Record<string, unknown>)['user'] = user;
  }
  return req;
}

describe('authRouter', () => {
  it('exports authRouter with fetch', () => {
    expect(authRouter).toBeDefined();
    expect(typeof authRouter.fetch).toBe('function');
  });
});

describe('POST /api/auth/logout', () => {
  it('returns 200 and clears session cookie', async () => {
    const env = makeEnv();
    const res = await authRouter.fetch(
      makeReq('/logout', { method: 'POST' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { ok: boolean } };
    expect(body.data.ok).toBe(true);
    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('gp_session=');
    expect(cookie).toContain('Max-Age=0');
  });

  it('deletes the session AND writes a revocation tombstone', async () => {
    const env = makeEnv();
    await authRouter.fetch(
      makeReq('/logout', {
        method: 'POST',
        headers: { Cookie: 'gp_session=tok-abc123' },
      }),
      env,
    );
    expect(env.SESSIONS.delete).toHaveBeenCalledWith('session:tok-abc123');
    // The delete alone is not final — a renewal in flight puts the record back.
    // See apps/api/src/lib/session.ts.
    expect(env.SESSIONS.put).toHaveBeenCalledWith(
      'revoked:tok-abc123',
      expect.any(String),
      expect.objectContaining({ expirationTtl: expect.any(Number) }),
    );
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 when not authenticated', async () => {
    const env = makeEnv();
    const res = await authRouter.fetch(makeReq('/me'), env);
    expect(res.status).toBe(401);
  });

  it('returns 200 with user when authenticated', async () => {
    const env = makeEnv();
    const res = await authRouter.fetch(
      makeReq(
        '/me',
        {},
        { id: 'user-1', email: 'user@example.com', role: 'owner' },
      ),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { user: { id: string } } };
    expect(body.data.user.id).toBe('user-1');
  });
});

describe('POST /api/auth/register', () => {
  it('returns 400 when required fields are missing', async () => {
    const env = makeEnv();
    const res = await authRouter.fetch(
      makeReq('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@example.com' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 409 when email is already taken', async () => {
    const env = makeEnv();
    (
      env.DB.prepare('').bind().first as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ id: 'existing-user' });
    const res = await authRouter.fetch(
      makeReq('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'taken@example.com',
          workspaceName: 'Smith Electric',
          trade: 'electrician',
          phone: '555-0001',
        }),
      }),
      env,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('DUPLICATE');
  });

  it('accepts a passwordless registration and creates a session', async () => {
    const env = makeEnv();
    const res = await authRouter.fetch(
      makeReq('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'new@example.com',
          workspaceName: 'Smith Electric',
          trade: 'electrician',
          phone: '555-0001',
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);
    expect(res.headers.get('Set-Cookie')).toContain('gp_session');
    expect(env.SESSIONS.put).toHaveBeenCalledWith(
      expect.stringContaining('session:'),
      expect.stringContaining('"email":"new@example.com"'),
      expect.objectContaining({ expiration: expect.any(Number) }),
    );
  });

  it('persists submitted address fields on the new workspace row', async () => {
    const env = makeEnv();
    const res = await authRouter.fetch(
      makeReq('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'address@example.com',
          workspaceName: 'Smith Electric',
          trade: 'electrician',
          phone: '555-0001',
          street: '123 Main St',
          city: 'Denver',
          state: 'CO',
          zip: '80202',
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);

    const prepareCalls = (env.DB.prepare as ReturnType<typeof vi.fn>).mock
      .calls;
    const insertWorkspaceIndex = prepareCalls.findIndex(([sql]: [string]) =>
      sql.includes('INSERT INTO workspaces'),
    );
    expect(insertWorkspaceIndex).toBeGreaterThanOrEqual(0);

    const bindCalls = (
      env.DB.prepare('').bind as unknown as ReturnType<typeof vi.fn>
    ).mock.calls;
    expect(bindCalls[insertWorkspaceIndex]).toEqual(
      expect.arrayContaining(['123 Main St', 'Denver', 'CO', '80202']),
    );
  });

  it('registers successfully with address fields omitted, defaulting them to empty strings', async () => {
    const env = makeEnv();
    const res = await authRouter.fetch(
      makeReq('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'no-address@example.com',
          workspaceName: 'Smith Electric',
          trade: 'electrician',
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);

    const prepareCalls = (env.DB.prepare as ReturnType<typeof vi.fn>).mock
      .calls;
    const insertWorkspaceIndex = prepareCalls.findIndex(([sql]: [string]) =>
      sql.includes('INSERT INTO workspaces'),
    );
    const bindCalls = (
      env.DB.prepare('').bind as unknown as ReturnType<typeof vi.fn>
    ).mock.calls;
    // No street/city/state/zip/phone provided — all four address columns
    // (plus phone) should have been bound as '', never undefined/null.
    const boundArgs = bindCalls[insertWorkspaceIndex] as unknown[];
    expect(boundArgs.filter((v) => v === '').length).toBeGreaterThanOrEqual(4);
    expect(boundArgs).not.toContain(undefined);
  });

  it('returns 400 when an address field exceeds the max length', async () => {
    const env = makeEnv();
    const res = await authRouter.fetch(
      makeReq('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'toolong@example.com',
          workspaceName: 'Smith Electric',
          trade: 'electrician',
          zip: 'a'.repeat(21),
        }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/register — phone is stored normalised', () => {
  /** The value bound into the `workspaces` INSERT for the `phone` column. */
  async function storedPhone(typed: string): Promise<unknown> {
    const env = makeEnv();
    const res = await authRouter.fetch(
      makeReq('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Jane',
          lastName: 'Smith',
          email: `phone-${Math.random()}@example.com`,
          workspaceName: 'Smith Electric',
          trade: 'electrician',
          phone: typed,
        }),
      }),
      env,
    );
    expect(res.status).toBe(201);

    const prepareCalls = (env.DB.prepare as ReturnType<typeof vi.fn>).mock
      .calls;
    const idx = prepareCalls.findIndex(([sql]: [string]) =>
      sql.includes('INSERT INTO workspaces'),
    );
    const bindCalls = (
      env.DB.prepare('').bind as unknown as ReturnType<typeof vi.fn>
    ).mock.calls;
    // Read the bind position out of the statement's own column list rather
    // than hard-coding it: this assertion used to say `[3]`, and adding
    // `slug` to the insert silently made it read `trade` instead.
    const columns = /INSERT INTO workspaces \(([^)]*)\)/
      .exec(prepareCalls[idx][0] as string)![1]
      .split(',')
      .map((column) => column.trim());
    return (bindCalls[idx] as unknown[])[columns.indexOf('phone')];
  }

  it.each([
    '9495550187',
    '(949) 555-0187',
    '949-555-0187',
    '949.555.0187',
    '+1 949 555 0187',
    '19495550187',
  ])('stores %s as E.164', async (typed) => {
    // The whole recovery bug in one assertion: /register wrote the number as
    // typed while every lookup normalised first, so one number had two
    // spellings and they never met.
    expect(await storedPhone(typed)).toBe('+19495550187');
  });

  it('keeps an un-normalisable number verbatim rather than dropping it', async () => {
    // workspaces.phone is a display field too (micro-site, estimates). Losing
    // what the contractor typed is worse than storing it unnormalised.
    expect(await storedPhone('x99')).toBe('x99');
  });

  it('still stores the empty string when no phone is given', async () => {
    expect(await storedPhone('')).toBe('');
  });
});

describe('auth schema validation', () => {
  it('RegisterSchema requires the core profile fields', async () => {
    const { RegisterSchema } = await import('@greenput/shared/validators');
    expect(RegisterSchema.safeParse({ email: 'a@b.com' }).success).toBe(false);
  });
});

describe('there is no password sign-in', () => {
  it('has no /login route at all', async () => {
    // itty-router returns undefined for an unmatched path; index.ts turns
    // that into a 404. The assertion is that nothing here handles it.
    const res = await authRouter.fetch(
      new Request('https://api.greenput.com/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'demo@greenput.com',
          password: 'demo1234',
        }),
      }),
      makeEnv(),
    );
    expect(res === undefined || res.status === 404).toBe(true);
  });

  it('stores no password when a registration carries one', async () => {
    const env = makeEnv();
    const writes: unknown[][] = [];
    env.DB.prepare = ((sql: string) => ({
      bind: (...args: unknown[]) => {
        if (sql.includes('INSERT INTO users')) writes.push(args);
        return {
          first: async () => null,
          run: async () => ({ meta: { changes: 1 } }),
          all: async () => ({ results: [] }),
        };
      },
      first: async () => null,
      run: async () => ({ meta: { changes: 1 } }),
      all: async () => ({ results: [] }),
    })) as unknown as typeof env.DB.prepare;

    await authRouter.fetch(
      new Request('https://api.greenput.com/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          firstName: 'Ada',
          lastName: 'Byron',
          email: 'ada@example.com',
          workspaceName: 'Byron Electric',
          trade: 'electrical',
          password: 'hunter2hunter2',
        }),
      }),
      env,
    );

    // Whatever else the insert binds, the plaintext must not be among it and
    // nothing must look like a PBKDF2 `salt:key`.
    for (const args of writes) {
      for (const a of args) {
        expect(String(a)).not.toContain('hunter2hunter2');
        expect(String(a)).not.toMatch(
          /^[A-Za-z0-9+/=]{20,}:[A-Za-z0-9+/=]{20,}$/,
        );
      }
    }
  });
});

// ── GP-039: the whole wizard reaches the database ─────────────────────────
//
// Six onboarding answers used to be collected, read back on the review step
// and thrown away: the register body was ten fields and RegisterSchema
// stripped anything else. These run over a real SQLite database built from
// schema.sql, because a vi.fn() DB cannot tell a column that was written from
// one that was never named — and the defect here was exactly a value that
// never reached a column.
describe('POST /api/auth/register stores the whole wizard (GP-039), against schema.sql', () => {
  const SCHEMA = join(__dirname, '..', '..', '..', '..', 'schema.sql');

  interface WorkspaceRow {
    id: string;
    trade: string;
    logo_url: string | null;
    service_area: string | null;
    service_radius_miles: number | null;
    service_types: string;
  }
  interface BrandingRow {
    workspace_id: string;
    logo_url: string | null;
    primary_color: string;
  }

  let sqlite: SqliteD1 | null = null;
  afterEach(() => {
    sqlite?.close();
    sqlite = null;
  });

  function realEnv() {
    sqlite = createSqliteD1({ files: [SCHEMA] });
    return {
      DB: sqlite.db,
      SESSIONS: {
        put: async () => undefined,
        get: async () => null,
        delete: async () => undefined,
      },
      ENVIRONMENT: 'test',
    } as unknown as Parameters<typeof authRouter.fetch>[1];
  }

  /** Everything the wizard asks, as apps/platform sends it. */
  const WIZARD = {
    firstName: 'Alex',
    lastName: 'Reed',
    email: 'alex@reed.example',
    workspaceName: 'Reed HVAC',
    trade: 'HVAC',
    serviceTypes: ['HVAC', 'Plumbing'],
    phone: '(949) 555-0199',
    street: '742 Evergreen Terrace',
    city: 'Springfield',
    state: 'OR',
    zip: '97477',
    serviceArea: 'Springfield metro',
    serviceRadiusMiles: 40,
    brandColor: '#3d8b5e',
    logoUrl: 'https://reed.example/logo.png',
  };

  function register(
    env: Parameters<typeof authRouter.fetch>[1],
    body: Record<string, unknown> = WIZARD,
  ): Promise<Response> {
    return authRouter.fetch(
      makeReq('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      env,
    );
  }

  it('writes the service area, radius and every service to the workspace row', async () => {
    const env = realEnv();
    const res = await register(env);
    expect(res.status).toBe(201);

    const [row] = sqlite!.rows<WorkspaceRow>('workspaces');
    expect(row.service_area).toBe('Springfield metro');
    expect(row.service_radius_miles).toBe(40);
    // Both, not the first: the "pick all that apply" grid is the normal case.
    expect(JSON.parse(row.service_types)).toEqual(['HVAC', 'Plumbing']);
    expect(row.trade).toBe('HVAC');
  });

  it('keeps trade as the first service even when the caller lists it later', async () => {
    const env = realEnv();
    await register(env, {
      ...WIZARD,
      trade: 'Plumbing',
      serviceTypes: ['HVAC', 'Plumbing'],
    });
    const [row] = sqlite!.rows<WorkspaceRow>('workspaces');
    expect(row.trade).toBe('Plumbing');
    expect(JSON.parse(row.service_types)).toEqual(['Plumbing', 'HVAC']);
  });

  it('stores NULL, not an invented value, for an area and radius that were not given', async () => {
    const env = realEnv();
    const {
      serviceTypes: _types,
      serviceArea: _area,
      serviceRadiusMiles: _radius,
      ...tradeOnly
    } = WIZARD;
    const res = await register(env, tradeOnly);
    expect(res.status).toBe(201);
    const [row] = sqlite!.rows<WorkspaceRow>('workspaces');
    expect(row.service_area).toBeNull();
    expect(row.service_radius_miles).toBeNull();
    // A caller that sends only `trade` still gets a one-entry list, so the
    // two columns agree from the first row.
    expect(JSON.parse(row.service_types)).toEqual(['HVAC']);
  });

  it('writes a branding row carrying the chosen colour, not the schema default', async () => {
    const env = realEnv();
    await register(env);

    const branding = sqlite!.rows<BrandingRow>('branding');
    const [workspace] = sqlite!.rows<WorkspaceRow>('workspaces');
    // Before GP-039 this array was empty: the colour was discarded at "All
    // set" and Settings → Branding showed the schema default instead.
    expect(branding).toHaveLength(1);
    expect(branding[0].workspace_id).toBe(workspace.id);
    expect(branding[0].primary_color).toBe('#3d8b5e');
    expect(branding[0].primary_color).not.toBe('#10b981');
    expect(branding[0].logo_url).toBe('https://reed.example/logo.png');
    // `branding.logo_url`, never `workspaces.logo_url`: that column is the one
    // bit that says whether the contractor uploaded an image (see auth.ts).
    expect(workspace.logo_url).toBeNull();
  });

  it('falls back to the one shared default when no colour was chosen, and it IS the schema default', async () => {
    const env = realEnv();
    const { brandColor: _colour, logoUrl: _logo, ...noColour } = WIZARD;
    await register(env, noColour);

    const [branding] = sqlite!.rows<BrandingRow>('branding');
    expect(branding.primary_color).toBe(DEFAULT_BRAND_PRIMARY_COLOR);
    expect(branding.logo_url).toBeNull();

    // The wizard used to default to #3d8b5e and the table to #10b981 — two
    // greens in two places. The constant apps/platform shows on the swatch
    // must be the value schema.sql writes when nothing is chosen.
    const declared = sqlite!.raw
      .prepare(
        "SELECT dflt_value FROM pragma_table_info('branding') WHERE name = 'primary_color'",
      )
      .get() as { dflt_value: string };
    expect(declared.dflt_value.replace(/^'|'$/g, '')).toBe(
      DEFAULT_BRAND_PRIMARY_COLOR,
    );
  });

  it('writes the branding row in the SAME batch: when it fails, no workspace and no user exist', async () => {
    const env = realEnv();
    // Fail the last statement of the batch at execution time, after the
    // workspace and user inserts have run. If branding were a follow-up
    // write, the two rows before it would already be committed here — the
    // orphan-workspace failure the single batch was introduced to prevent.
    sqlite!.raw.exec(
      `CREATE TRIGGER refuse_branding BEFORE INSERT ON branding
       BEGIN SELECT RAISE(ABORT, 'branding refused'); END`,
    );

    await expect(register(env)).rejects.toThrow(/branding refused/);

    expect(sqlite!.rows('workspaces')).toHaveLength(0);
    expect(sqlite!.rows('users')).toHaveLength(0);
    expect(sqlite!.rows('activity_log')).toHaveLength(0);
    expect(sqlite!.rows('branding')).toHaveLength(0);
  });
});
