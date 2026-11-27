import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import type { Env } from '../env';
import { invitationsRouter } from './invitations';
import { issueInvitation } from '../lib/invitations';

// GP-008. Over the real schema.sql: the single-use guarantee is a conditional
// UPDATE on `user_invitations.accepted_at`, and only a real database can show
// that the second accept changes no row and mints no session.
describe('/api/auth/invite/:token against schema.sql (GP-008)', () => {
  const ROOT = resolve(__dirname, '../../../..');
  const WS = '00000000-0000-4000-8000-000000000001';
  const OWNER = '00000000-0000-4000-8000-000000000002';
  const INVITEE = '00000000-0000-4000-8000-0000000000a1';

  let sqlite: SqliteD1;
  let env: Env;
  let put: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
      sql: [
        `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
         VALUES ('${INVITEE}', '${WS}', 'Bea', 'Smith', 'bea@example.com', 'tech', '', '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')`,
      ],
    });
    put = vi.fn().mockResolvedValue(undefined);
    env = {
      DB: sqlite.db,
      SESSIONS: { put, get: vi.fn().mockResolvedValue(null), delete: vi.fn() },
      ENVIRONMENT: 'production',
    } as unknown as Env;
  });
  afterEach(() => sqlite.close());

  async function issued(now = new Date().toISOString()) {
    return issueInvitation(env, {
      workspaceId: WS,
      userId: INVITEE,
      invitedBy: OWNER,
      now,
    });
  }

  const preview = (token: string) =>
    invitationsRouter.fetch(
      new Request(`https://api.greenput.com/api/auth/invite/${token}`),
      env,
    );
  const accept = (token: string) =>
    invitationsRouter.fetch(
      new Request(`https://api.greenput.com/api/auth/invite/${token}/accept`, {
        method: 'POST',
      }),
      env,
    );

  it('previews who the invitation is for, without the email or the user id', async () => {
    const { token, expiresAt } = await issued();
    const res = await preview(token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data).toEqual({
      firstName: 'Bea',
      lastName: 'Smith',
      workspaceName: expect.any(String),
      expiresAt,
    });
  });

  it('404s an unknown token on both routes', async () => {
    expect((await preview('nope')).status).toBe(404);
    expect((await accept('nope')).status).toBe(404);
    expect(put).not.toHaveBeenCalled();
  });

  it('accepts once: stamps the row, mints a session, sets the cookie', async () => {
    const { token } = await issued();
    const res = await accept(token);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/^gp_session=/);
    expect(put).toHaveBeenCalledTimes(1);
    const body = (await res.json()) as {
      data: { user: { id: string; workspaceId: string; role: string } };
    };
    expect(body.data.user).toMatchObject({
      id: INVITEE,
      workspaceId: WS,
      role: 'tech',
    });

    const rows = sqlite
      .rows<{ token: string; accepted_at: string | null }>('user_invitations')
      .filter((r) => r.token === token);
    expect(rows[0]?.accepted_at).toBeTruthy();
    expect(
      sqlite
        .rows<{ action: string; entity_id: string }>('activity_log')
        .some((a) => a.action === 'invite_accepted' && a.entity_id === INVITEE),
    ).toBe(true);
  });

  it('refuses the second accept of the same token and mints nothing', async () => {
    const { token } = await issued();
    expect((await accept(token)).status).toBe(200);

    const res = await accept(token);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVITE_USED');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(put).toHaveBeenCalledTimes(1);

    // The preview says the same thing, so the screen can explain it.
    expect((await preview(token)).status).toBe(410);
  });

  it('refuses an expired invitation', async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 86400_000).toISOString();
    const { token } = await issued(eightDaysAgo);
    const res = await accept(token);
    expect(res.status).toBe(410);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'INVITE_EXPIRED',
    );
    expect(put).not.toHaveBeenCalled();
  });

  it('refuses an open invitation whose user already has a passkey', async () => {
    const { token } = await issued();
    sqlite.raw
      .prepare(
        `INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key)
         VALUES ('cred-1', ?, 'cred-id-1', 'pk')`,
      )
      .run(INVITEE);
    const res = await accept(token);
    expect(res.status).toBe(409);
    expect(put).not.toHaveBeenCalled();
    // Not consumed either — nothing happened.
    const rows = sqlite
      .rows<{ token: string; accepted_at: string | null }>('user_invitations')
      .filter((r) => r.token === token);
    expect(rows[0]?.accepted_at).toBeNull();
  });

  it('re-issuing retires the earlier token, so only the newest link opens', async () => {
    const first = await issued();
    const second = await issued();
    expect((await accept(first.token)).status).toBe(404);
    expect((await accept(second.token)).status).toBe(200);
  });
});
