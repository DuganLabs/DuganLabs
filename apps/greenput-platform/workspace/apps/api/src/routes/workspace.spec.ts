import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import { createSqliteD1 } from '@greenput/shared/testing';
import { workspaceRouter } from './workspace';

function makeEnv() {
  const firstMock = vi.fn().mockResolvedValue(null);
  const allMock = vi.fn().mockResolvedValue({ results: [] });
  const runMock = vi.fn().mockResolvedValue({});
  const bindMock = vi
    .fn()
    .mockReturnValue({ first: firstMock, all: allMock, run: runMock });
  const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });
  return {
    env: {
      DB: { prepare: prepareMock },
      SESSIONS: {},
      ENVIRONMENT: 'development',
    },
    firstMock,
    allMock,
    runMock,
    bindMock,
    prepareMock,
  };
}

function makeReq(
  path: string,
  init: RequestInit = {},
  role = 'owner',
  userId = 'user-1',
) {
  const req = new Request(
    `https://api.greenput.com/api/workspace${path}`,
    init,
  );
  (req as unknown as Record<string, unknown>)['workspaceId'] = 'ws-1';
  (req as unknown as Record<string, unknown>)['user'] = { id: userId, role };
  return req;
}

function patchReq(path: string, body: unknown, role = 'owner') {
  return makeReq(
    path,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    role,
  );
}

function postReq(path: string, body: unknown, role = 'owner') {
  return makeReq(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    role,
  );
}

describe('workspaceRouter', () => {
  it('exports workspaceRouter with fetch', () => {
    expect(workspaceRouter).toBeDefined();
    expect(typeof workspaceRouter.fetch).toBe('function');
  });
});

describe('GET /api/workspace', () => {
  it('returns 404 when workspace not found', async () => {
    const { env } = makeEnv();
    const res = await workspaceRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with workspace data when found', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValue({
      id: 'ws-1',
      name: 'Smith Electric',
      trade: 'Electrical',
    });
    const res = await workspaceRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string } };
    expect(body.data.name).toBe('Smith Electric');
  });
});

describe('PATCH /api/workspace', () => {
  it('returns 400 when body is empty', async () => {
    const { env } = makeEnv();
    const res = await workspaceRouter.fetch(patchReq('/', {}), env);
    expect(res.status).toBe(400);
  });

  it('returns 403 for tech role', async () => {
    const { env } = makeEnv();
    const res = await workspaceRouter.fetch(
      patchReq('/', { name: 'New Name' }, 'tech'),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('returns 403 for office role', async () => {
    const { env } = makeEnv();
    const res = await workspaceRouter.fetch(
      patchReq('/', { name: 'New Name' }, 'office'),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('returns 200 for owner role', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValueOnce({ id: 'ws-1', name: 'New Name' });
    const res = await workspaceRouter.fetch(
      patchReq('/', { name: 'New Name' }, 'owner'),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('returns 200 for admin role', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValueOnce({ id: 'ws-1', name: 'New Name' });
    const res = await workspaceRouter.fetch(
      patchReq('/', { name: 'New Name' }, 'admin'),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('rejects invalid email', async () => {
    const { env } = makeEnv();
    const res = await workspaceRouter.fetch(
      patchReq('/', { email: 'bad-email' }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('logs update to activity_log', async () => {
    const { env, firstMock, runMock } = makeEnv();
    firstMock.mockResolvedValueOnce({ id: 'ws-1', name: 'Updated' });
    await workspaceRouter.fetch(patchReq('/', { name: 'Updated' }), env);
    // UPDATE workspace + INSERT activity_log
    expect(runMock).toHaveBeenCalledTimes(2);
  });
});

/**
 * The suite above mocks env.DB, so `prepare()` returns a stub that never parses
 * the SQL it is handed. Every test in it passed for the whole life of this
 * endpoint while PATCH /api/workspace returned 500 on every real call: the
 * handler's UPDATE opens with `updated_at = ?` and `workspaces` had no such
 * column. A mock cannot know that. A schema can.
 *
 * So this block runs the same handler against the real schema.sql in SQLite —
 * same D1 surface, foreign keys on — where a column that does not exist is an
 * error, exactly as it is in production.
 */
describe('PATCH /api/workspace, against the real schema', () => {
  const SCHEMA = join(__dirname, '..', '..', '..', '..', 'schema.sql');

  function realEnv() {
    const sqlite = createSqliteD1({ files: [SCHEMA] });
    sqlite.raw.exec(
      `INSERT INTO workspaces (id, name, slug, created_at)
       VALUES ('ws-1', 'Acme Electric', 'acme', '2026-01-01T00:00:00.000Z')`,
    );
    sqlite.raw.exec(
      // password_hash is NOT NULL with no default — '' is the NO_PASSWORD
      // sentinel a passkey-only account carries.
      `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash)
       VALUES ('user-1', 'ws-1', 'W', 'D', 'w@example.com', 'owner', '')`,
    );
    return {
      sqlite,
      env: { DB: sqlite.db, SESSIONS: {}, ENVIRONMENT: 'development' },
    };
  }

  it('actually writes the fields it is given', async () => {
    const { sqlite, env } = realEnv();
    try {
      const res = await workspaceRouter.fetch(
        patchReq('/', { name: 'Acme Electrical Co', city: 'Irvine' }),
        env,
      );
      expect(res.status).toBe(200);

      const row = sqlite.rows<{ name: string; city: string }>('workspaces')[0];
      expect(row.name).toBe('Acme Electrical Co');
      expect(row.city).toBe('Irvine');
    } finally {
      sqlite.close();
    }
  });

  it('stamps updated_at, and the column exists to be stamped', async () => {
    const { sqlite, env } = realEnv();
    try {
      await workspaceRouter.fetch(patchReq('/', { name: 'Renamed' }), env);
      const row = sqlite.rows<{ updated_at: string | null }>('workspaces')[0];
      expect(row.updated_at).toBeTruthy();
    } finally {
      sqlite.close();
    }
  });

  it('records the edit in activity_log', async () => {
    const { sqlite, env } = realEnv();
    try {
      await workspaceRouter.fetch(patchReq('/', { name: 'Renamed' }), env);
      const log = sqlite.rows<{ entity_type: string; action: string }>(
        'activity_log',
      );
      expect(log).toHaveLength(1);
      expect(log[0].entity_type).toBe('workspace');
      expect(log[0].action).toBe('updated');
    } finally {
      sqlite.close();
    }
  });

  // ── GP-039: service area, radius and the whole service list ─────────────

  interface ServiceRow {
    trade: string;
    service_area: string | null;
    service_radius_miles: number | null;
    service_types: string;
  }
  interface ServiceBody {
    data: {
      trade: string;
      serviceTypes: string[];
      serviceArea?: string;
      serviceRadiusMiles?: number;
    };
  }

  it('writes the service area, radius and the whole service list, and hands them back parsed', async () => {
    const { sqlite, env } = realEnv();
    try {
      const res = await workspaceRouter.fetch(
        patchReq('/', {
          serviceArea: 'Springfield metro',
          serviceRadiusMiles: 40,
          serviceTypes: ['Plumbing', 'HVAC'],
        }),
        env,
      );
      expect(res.status).toBe(200);

      const [row] = sqlite.rows<ServiceRow>('workspaces');
      expect(row.service_area).toBe('Springfield metro');
      expect(row.service_radius_miles).toBe(40);
      expect(JSON.parse(row.service_types)).toEqual(['Plumbing', 'HVAC']);
      // `trade` is the list's first entry (see /api/auth/register), so
      // replacing the list moves it — apps/tenant-site still reads `trade`.
      expect(row.trade).toBe('Plumbing');

      const body = (await res.json()) as ServiceBody;
      expect(body.data.serviceTypes).toEqual(['Plumbing', 'HVAC']);
      expect(body.data.serviceArea).toBe('Springfield metro');
      expect(body.data.serviceRadiusMiles).toBe(40);
    } finally {
      sqlite.close();
    }
  });

  it('leaves trade alone when the caller names it alongside the list', async () => {
    const { sqlite, env } = realEnv();
    try {
      await workspaceRouter.fetch(
        patchReq('/', { trade: 'Electrical', serviceTypes: ['HVAC'] }),
        env,
      );
      const [row] = sqlite.rows<ServiceRow>('workspaces');
      expect(row.trade).toBe('Electrical');
      expect(JSON.parse(row.service_types)).toEqual(['HVAC']);
    } finally {
      sqlite.close();
    }
  });

  it('clears the area and radius with null, and then omits them from the response', async () => {
    const { sqlite, env } = realEnv();
    try {
      await workspaceRouter.fetch(
        patchReq('/', { serviceArea: 'Springfield', serviceRadiusMiles: 25 }),
        env,
      );
      const res = await workspaceRouter.fetch(
        patchReq('/', { serviceArea: null, serviceRadiusMiles: null }),
        env,
      );
      expect(res.status).toBe(200);
      const [row] = sqlite.rows<ServiceRow>('workspaces');
      expect(row.service_area).toBeNull();
      expect(row.service_radius_miles).toBeNull();
      const body = (await res.json()) as ServiceBody;
      expect('serviceArea' in body.data).toBe(false);
      expect('serviceRadiusMiles' in body.data).toBe(false);
    } finally {
      sqlite.close();
    }
  });

  it('GET hands the service list out as an array, not a JSON string', async () => {
    const { sqlite, env } = realEnv();
    try {
      sqlite.raw.exec(
        `UPDATE workspaces SET service_types = '["HVAC","Plumbing"]' WHERE id = 'ws-1'`,
      );
      const res = await workspaceRouter.fetch(makeReq('/'), env);
      expect(res.status).toBe(200);
      const body = (await res.json()) as ServiceBody;
      expect(body.data.serviceTypes).toEqual(['HVAC', 'Plumbing']);
    } finally {
      sqlite.close();
    }
  });
});

describe('GET /api/workspace/users', () => {
  it('returns 200 with empty user list', async () => {
    const { env } = makeEnv();
    const res = await workspaceRouter.fetch(makeReq('/users'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('returns list of workspace members', async () => {
    const { env, allMock } = makeEnv();
    allMock.mockResolvedValue({
      results: [
        {
          id: 'u1',
          first_name: 'John',
          last_name: 'Doe',
          email: 'john@example.com',
          role: 'owner',
        },
        {
          id: 'u2',
          first_name: 'Jane',
          last_name: 'Smith',
          email: 'jane@example.com',
          role: 'tech',
        },
      ],
    });
    const res = await workspaceRouter.fetch(makeReq('/users'), env);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(2);
  });
});

describe('POST /api/workspace/users', () => {
  it('returns 400 when required fields missing', async () => {
    const { env } = makeEnv();
    const res = await workspaceRouter.fetch(postReq('/users', {}), env);
    expect(res.status).toBe(400);
  });

  it('returns 403 for tech role', async () => {
    const { env } = makeEnv();
    const res = await workspaceRouter.fetch(
      postReq(
        '/users',
        { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
        'tech',
      ),
      env,
    );
    expect(res.status).toBe(403);
  });
});

// GP-008. Inviting used to create a user row and nothing else — no token, no
// link, and sign-in is passkeys only, so the invitee could never get in; a
// second invite for them was a 409. These run the handler over the real
// schema.sql because the invitation is a `user_invitations` row with a
// conditional UPDATE behind it, and a mocked `prepare()` cannot show a token
// being retired or a row being written at all.
describe('POST /api/workspace/users against schema.sql (GP-008)', () => {
  const ROOT = join(__dirname, '../../../..');
  const WS = '00000000-0000-4000-8000-000000000001';
  const OWNER = '00000000-0000-4000-8000-000000000002';

  let sqlite: ReturnType<typeof createSqliteD1>;
  let env: {
    DB: D1Database;
    SESSIONS: Record<string, never>;
    ENVIRONMENT: string;
  };

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [join(ROOT, 'schema.sql'), join(ROOT, 'scripts/preview/seed.sql')],
    });
    env = { DB: sqlite.db, SESSIONS: {}, ENVIRONMENT: 'production' };
  });
  afterEach(() => sqlite.close());

  function invite(
    body: Record<string, unknown>,
    origin = 'https://app.greenput.com',
  ) {
    const req = new Request('https://api.greenput.com/api/workspace/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify(body),
    });
    (req as unknown as Record<string, unknown>)['workspaceId'] = WS;
    (req as unknown as Record<string, unknown>)['user'] = {
      id: OWNER,
      role: 'owner',
    };
    return req;
  }

  type Invited = {
    data: {
      id: string;
      firstName: string;
      avatarInitials: string;
      role: string;
    };
    share?: { url: string; message: string; expiresAt?: string };
  };

  interface InvitationRow {
    user_id: string;
    token: string;
    accepted_at: string | null;
    expires_at: string;
  }

  it('creates the user AND an invitation, and answers with the accept link', async () => {
    const res = await workspaceRouter.fetch(
      invite({
        firstName: 'Alice',
        lastName: 'Brown',
        email: 'alice@example.com',
      }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Invited;
    expect(body.data.firstName).toBe('Alice');
    expect(body.data.avatarInitials).toBe('AB');
    expect(body.data.role).toBe('tech');

    const rows = sqlite
      .rows<InvitationRow>('user_invitations')
      .filter((r) => r.user_id === body.data.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.accepted_at).toBeNull();
    expect(body.share?.url).toBe(
      `https://app.greenput.com/accept-invite/${rows[0]?.token}`,
    );
    expect(body.share?.expiresAt).toBe(rows[0]?.expires_at);
    // The link is in the message, and the message never says it was sent.
    expect(body.share?.message).toContain(body.share?.url);
    expect(body.share?.message).toContain('Hi Alice');
    expect(body.share?.message).not.toMatch(/\bsent\b/i);
  });

  it('points the link at a known platform Origin, never at an arbitrary one', async () => {
    const preview = (await (
      await workspaceRouter.fetch(
        invite(
          { firstName: 'A', lastName: 'B', email: 'a@example.com' },
          'https://abc123.greenput-app.pages.dev',
        ),
        env,
      )
    ).json()) as Invited;
    expect(preview.share?.url).toMatch(
      /^https:\/\/abc123\.greenput-app\.pages\.dev\/accept-invite\//,
    );

    const evil = (await (
      await workspaceRouter.fetch(
        invite(
          { firstName: 'C', lastName: 'D', email: 'c@example.com' },
          'https://evil.example',
        ),
        env,
      )
    ).json()) as Invited;
    expect(evil.share?.url).toMatch(/^https:\/\/app\.greenput\.com\//);
  });

  it('re-issues the invitation for an existing user who has never enrolled a passkey', async () => {
    const first = (await (
      await workspaceRouter.fetch(
        invite({
          firstName: 'Bea',
          lastName: 'Smith',
          email: 'bea@example.com',
        }),
        env,
      )
    ).json()) as Invited;

    const res = await workspaceRouter.fetch(
      invite({ firstName: 'Bea', lastName: 'Smith', email: 'bea@example.com' }),
      env,
    );
    expect(res.status).toBe(200);
    const second = (await res.json()) as Invited;
    expect(second.data.id).toBe(first.data.id);
    expect(second.share?.url).toBeTruthy();
    expect(second.share?.url).not.toBe(first.share?.url);

    // Exactly one live way in: the old token is gone, not merely superseded.
    const rows = sqlite
      .rows<InvitationRow>('user_invitations')
      .filter((r) => r.user_id === first.data.id);
    expect(rows).toHaveLength(1);
    expect(second.share?.url.endsWith(rows[0]?.token ?? '')).toBe(true);
    // And no second user row was written.
    expect(
      sqlite
        .rows<{ email: string }>('users')
        .filter((u) => u.email === 'bea@example.com'),
    ).toHaveLength(1);
  });

  it('still answers 409 DUPLICATE once that user has a passkey', async () => {
    const first = (await (
      await workspaceRouter.fetch(
        invite({ firstName: 'Cy', lastName: 'Lee', email: 'cy@example.com' }),
        env,
      )
    ).json()) as Invited;
    sqlite.raw
      .prepare(
        `INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key)
         VALUES ('cred-1', ?, 'cred-id-1', 'pk')`,
      )
      .run(first.data.id);

    const res = await workspaceRouter.fetch(
      invite({ firstName: 'Cy', lastName: 'Lee', email: 'cy@example.com' }),
      env,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('DUPLICATE');
    // The live invitation was not disturbed either.
    expect(
      sqlite
        .rows<InvitationRow>('user_invitations')
        .filter((r) => r.user_id === first.data.id),
    ).toHaveLength(1);
  });
});

describe('PATCH /api/workspace/users/:id', () => {
  it('returns 403 for non-owner role', async () => {
    const { env } = makeEnv();
    const res = await workspaceRouter.fetch(
      patchReq('/users/u2', { role: 'admin' }, 'admin'),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid role value', async () => {
    const { env } = makeEnv();
    const res = await workspaceRouter.fetch(
      patchReq('/users/u2', { role: 'superadmin' }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when target user not found', async () => {
    const { env } = makeEnv();
    const res = await workspaceRouter.fetch(
      patchReq('/users/nonexistent', { role: 'admin' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when demoting last owner', async () => {
    const { env, firstMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({ id: 'u1', role: 'owner' }) // target user
      .mockResolvedValueOnce({ cnt: 1 }); // owner count
    const res = await workspaceRouter.fetch(
      patchReq('/users/u1', { role: 'admin' }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 when updating role successfully', async () => {
    const { env, firstMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({ id: 'u2', role: 'tech' })
      .mockResolvedValueOnce({
        id: 'u2',
        first_name: 'Casey',
        last_name: 'Ng',
        email: 'casey@example.com',
        role: 'admin',
        last_seen_at: null,
        created_at: '2026-09-12T00:00:00.000Z',
        updated_at: '2026-09-12T00:00:00.000Z',
      });
    const res = await workspaceRouter.fetch(
      patchReq('/users/u2', { role: 'admin' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { role: string } };
    expect(body.data.role).toBe('admin');
  });

  it('allows demoting owner when multiple owners exist', async () => {
    const { env, firstMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({ id: 'u2', role: 'owner' }) // target user
      .mockResolvedValueOnce({ cnt: 2 }); // owner count
    const res = await workspaceRouter.fetch(
      patchReq('/users/u2', { role: 'admin' }),
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/workspace/users/:id', () => {
  it('returns 403 for non-owner role', async () => {
    const { env } = makeEnv();
    const res = await workspaceRouter.fetch(
      makeReq('/users/u2', { method: 'DELETE' }, 'admin'),
      env,
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 when trying to remove yourself', async () => {
    const { env } = makeEnv();
    // userId='user-1', targetId='user-1' → same ID
    const res = await workspaceRouter.fetch(
      makeReq('/users/user-1', { method: 'DELETE' }, 'owner', 'user-1'),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when target user not found', async () => {
    const { env } = makeEnv();
    const res = await workspaceRouter.fetch(
      makeReq('/users/nonexistent', { method: 'DELETE' }, 'owner', 'user-1'),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when removing last owner', async () => {
    const { env, firstMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({ id: 'u2', role: 'owner' })
      .mockResolvedValueOnce({ cnt: 1 });
    const res = await workspaceRouter.fetch(
      makeReq('/users/u2', { method: 'DELETE' }, 'owner', 'user-1'),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 200 with deleted:true on success', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValueOnce({ id: 'u2', role: 'tech' });
    const res = await workspaceRouter.fetch(
      makeReq('/users/u2', { method: 'DELETE' }, 'owner', 'user-1'),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });

  it('allows removing owner when multiple owners exist', async () => {
    const { env, firstMock } = makeEnv();
    firstMock
      .mockResolvedValueOnce({ id: 'u2', role: 'owner' })
      .mockResolvedValueOnce({ cnt: 2 });
    const res = await workspaceRouter.fetch(
      makeReq('/users/u2', { method: 'DELETE' }, 'owner', 'user-1'),
      env,
    );
    expect(res.status).toBe(200);
  });
});
