import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import type { Env } from '../env';
import {
  INVITATION_TTL_MS,
  consumeInvitation,
  credentialCount,
  findInvitation,
  invitationState,
  issueInvitation,
} from './invitations';

function must<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('expected a row');
  return value;
}

describe('invitations over schema.sql', () => {
  const ROOT = resolve(__dirname, '../../../..');
  const WS = '00000000-0000-4000-8000-000000000001';
  const OWNER = '00000000-0000-4000-8000-000000000002';
  const NOW = '2026-09-13T12:00:00.000Z';

  let sqlite: SqliteD1;
  let env: Env;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [
        resolve(ROOT, 'schema.sql'),
        resolve(ROOT, 'scripts/preview/seed.sql'),
      ],
    });
    env = { DB: sqlite.db } as unknown as Env;
  });
  afterEach(() => sqlite.close());

  it('issues a token that expires INVITATION_TTL_MS after now, and finds it with its user and workspace', async () => {
    const { token, expiresAt } = await issueInvitation(env, {
      workspaceId: WS,
      userId: OWNER,
      invitedBy: OWNER,
      now: NOW,
    });
    expect(new Date(expiresAt).getTime() - new Date(NOW).getTime()).toBe(
      INVITATION_TTL_MS,
    );
    const row = await findInvitation(env, token);
    expect(row).toMatchObject({
      workspace_id: WS,
      user_id: OWNER,
      accepted_at: null,
      expires_at: expiresAt,
      role: 'owner',
    });
    expect(row?.workspace_name).toBeTruthy();
  });

  it('retires the open tokens of the same user when issuing a new one', async () => {
    const a = await issueInvitation(env, {
      workspaceId: WS,
      userId: OWNER,
      invitedBy: OWNER,
      now: NOW,
    });
    const b = await issueInvitation(env, {
      workspaceId: WS,
      userId: OWNER,
      invitedBy: OWNER,
      now: NOW,
    });
    expect(await findInvitation(env, a.token)).toBeNull();
    expect(await findInvitation(env, b.token)).not.toBeNull();
  });

  it('consumes exactly once', async () => {
    const { token } = await issueInvitation(env, {
      workspaceId: WS,
      userId: OWNER,
      invitedBy: OWNER,
      now: NOW,
    });
    const row = must(await findInvitation(env, token));
    expect(await consumeInvitation(env, row.id, NOW)).toBe(true);
    expect(await consumeInvitation(env, row.id, NOW)).toBe(false);
    expect(invitationState(must(await findInvitation(env, token)), NOW)).toBe(
      'used',
    );
  });

  it('will not consume past the expiry', async () => {
    const { token, expiresAt } = await issueInvitation(env, {
      workspaceId: WS,
      userId: OWNER,
      invitedBy: OWNER,
      now: NOW,
    });
    const row = must(await findInvitation(env, token));
    expect(invitationState(row, expiresAt)).toBe('expired');
    expect(await consumeInvitation(env, row.id, expiresAt)).toBe(false);
  });

  it('counts passkeys per user', async () => {
    expect(await credentialCount(env, OWNER)).toBe(0);
    sqlite.raw
      .prepare(
        `INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key)
         VALUES ('cred-1', ?, 'cred-id-1', 'pk')`,
      )
      .run(OWNER);
    expect(await credentialCount(env, OWNER)).toBe(1);
  });
});
