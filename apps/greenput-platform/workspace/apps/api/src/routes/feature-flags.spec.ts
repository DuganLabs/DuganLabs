import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { featureFlagsRouter } from './feature-flags';

/**
 * The owner turning a dark feature on without anyone running a command.
 *
 * The standing rule this route exists to honour: nothing ships that hands the
 * owner a manual `wrangler` step. `intake_panel_photo` merges off, and these
 * two endpoints are how it goes on.
 */

const SCHEMA = join(resolve(__dirname, '..', '..', '..', '..'), 'schema.sql');

let sqlite: SqliteD1;
let env: { DB: D1Database; ENVIRONMENT: string };

beforeEach(() => {
  sqlite = createSqliteD1({
    files: [SCHEMA],
    sql: [
      `INSERT INTO workspaces (id, name, slug) VALUES ('ws1', 'Acme', 'acme');`,
      `INSERT INTO users (id, workspace_id, email, first_name, last_name, role, password_hash)
         VALUES ('u-owner', 'ws1', 'o@example.com', 'Olive', 'Owner', 'owner', 'x');`,
      `INSERT INTO users (id, workspace_id, email, first_name, last_name, role, password_hash)
         VALUES ('u-tech', 'ws1', 't@example.com', 'Theo', 'Tech', 'tech', 'x');`,
      `INSERT INTO admin_users (id, email, display_name) VALUES ('adm-1', 'ops@greenput.com', 'Pat Ops');`,
    ],
  });
  env = { DB: sqlite.db, ENVIRONMENT: 'test' };
});

afterEach(() => sqlite.close());

/**
 * `role` is the WORKSPACE role on the request — what any customer can hold.
 * `platformAdmin` attaches the gp_admin_session requireAdmin would have set.
 * The point of GP-107 is that the first never suffices and the second is
 * what these routes actually require.
 */
function authed(
  method: string,
  path: string,
  body?: unknown,
  role = 'owner',
  platformAdmin = true,
): Request {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  const req = new Request(
    `https://api.greenput.com${path}`,
    init,
  ) as Request & {
    workspaceId: string;
    user: { id: string; role: string };
    adminSession?: { isAdmin: true; adminId: string; email: string };
  };
  req.workspaceId = 'ws1';
  req.user = { id: role === 'tech' ? 'u-tech' : 'u-owner', role };
  if (platformAdmin)
    req.adminSession = {
      isAdmin: true,
      adminId: 'adm-1',
      email: 'ops@greenput.com',
    };
  return req;
}

const bodyOf = async <T>(res: Response) =>
  (await res.json()) as { data: T; error?: { code: string; message: string } };

describe('GET /api/feature-flags', () => {
  it('lists the known flags as off before anyone has touched them', async () => {
    const res = await featureFlagsRouter.fetch(
      authed('GET', '/api/admin/feature-flags'),
      env,
    );
    expect(res.status).toBe(200);
    const { data } = await bodyOf<
      Array<{
        name: string;
        enabled: boolean;
        configured: boolean;
        description: string;
      }>
    >(res);
    const photo = data.find((f) => f.name === 'intake_panel_photo');
    expect(photo).toBeDefined();
    expect(photo?.enabled).toBe(false);
    // No row at all: the ship-dark default, not somebody's explicit "off".
    expect(photo?.configured).toBe(false);
    expect(photo?.description).toMatch(/panel/i);
  });

  it('is not something a workspace role can read — owner, admin or tech', async () => {
    for (const role of ['owner', 'admin', 'tech']) {
      const r = await featureFlagsRouter.fetch(
        authed('GET', '/api/admin/feature-flags', undefined, role, false),
        env,
      );
      expect(r.status, role).toBe(401);
    }
    const res = await featureFlagsRouter.fetch(
      authed('GET', '/api/admin/feature-flags', undefined, 'tech', false),
      env,
    );
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/feature-flags/:name', () => {
  it('turns the panel photo on, and the next read sees it', async () => {
    const res = await featureFlagsRouter.fetch(
      authed('PATCH', '/api/admin/feature-flags/intake_panel_photo', {
        enabled: true,
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect((await bodyOf<{ enabled: boolean }>(res)).data.enabled).toBe(true);

    const listed = await featureFlagsRouter.fetch(
      authed('GET', '/api/admin/feature-flags'),
      env,
    );
    const { data } =
      await bodyOf<
        Array<{ name: string; enabled: boolean; configured: boolean }>
      >(listed);
    expect(data.find((f) => f.name === 'intake_panel_photo')).toMatchObject({
      enabled: true,
      configured: true,
    });

    const row = sqlite.rows<Record<string, unknown>>('feature_flags')[0];
    expect(row['updated_by']).toBe('adm-1');
    expect(row['description']).toMatch(/panel/i);

    // No activity_log row: that table is per-workspace (workspace_id NOT
    // NULL) and a platform admin has none. The flag row's updated_by /
    // updated_at is the record — asserted above.
    expect(sqlite.rows('activity_log')).toHaveLength(0);
  });

  it('stores a partial rollout in the shape the package honours', async () => {
    await featureFlagsRouter.fetch(
      authed('PATCH', '/api/admin/feature-flags/intake_panel_photo', {
        enabled: true,
        percentage: 10,
      }),
      env,
    );
    const row = sqlite.rows<Record<string, unknown>>('feature_flags')[0];
    // Not `{enabled: true, percentage: 10}`, which @basenative/flags 0.4.0
    // reads as a plain boolean and rolls out to everyone.
    expect(JSON.parse(String(row['config_json']))).toEqual({ percentage: 10 });
  });

  it('refuses a body that does not say what it wants', async () => {
    for (const body of [
      {},
      { enabled: 'yes' },
      { enabled: true, percentage: 101 },
    ]) {
      const res = await featureFlagsRouter.fetch(
        authed('PATCH', '/api/admin/feature-flags/intake_panel_photo', body),
        env,
      );
      expect(res.status).toBe(400);
    }
    expect(sqlite.rows('feature_flags')).toHaveLength(0);
  });

  it('404s an unknown flag rather than inventing one nobody reads', async () => {
    const res = await featureFlagsRouter.fetch(
      authed('PATCH', '/api/admin/feature-flags/intake_pannel_photo', {
        enabled: true,
      }),
      env,
    );
    expect(res.status).toBe(404);
    expect(sqlite.rows('feature_flags')).toHaveLength(0);
  });

  it('is not something a workspace admin can flip for every other tenant', async () => {
    const owner = await featureFlagsRouter.fetch(
      authed(
        'PATCH',
        '/api/admin/feature-flags/intake_panel_photo',
        { enabled: true },
        'admin',
        false,
      ),
      env,
    );
    expect(owner.status).toBe(401);
    expect(sqlite.rows('feature_flags')).toHaveLength(0);
    // …and the workspace role on the request is irrelevant once the platform
    // session is there: it was never the authority.
    const res = await featureFlagsRouter.fetch(
      authed(
        'PATCH',
        '/api/admin/feature-flags/intake_panel_photo',
        { enabled: true },
        'tech',
      ),
      env,
    );
    expect(res.status).toBe(200);
    expect(sqlite.rows('feature_flags')).toHaveLength(1);
  });
});

describe('who is recorded', () => {
  it('stores the platform admin as updated_by, not a workspace user', async () => {
    await featureFlagsRouter.fetch(
      authed('PATCH', '/api/admin/feature-flags/intake_panel_photo', {
        enabled: true,
      }),
      env,
    );
    const row = sqlite.rows<Record<string, unknown>>('feature_flags')[0];
    expect(row['updated_by']).toBe('adm-1');
  });
});
