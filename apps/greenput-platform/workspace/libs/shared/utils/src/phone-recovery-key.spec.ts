import { describe, it, expect, afterEach } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { toE164 } from './phone';

/**
 * `toE164` against the real `users` table, not a mock of it.
 *
 * The half of this defect a pure-function test cannot reach: two accounts each
 * binding the SAME physical handset. What stops that is
 * `idx_users_recovery_phone`, a partial UNIQUE index on `recovery_phone` —
 * declared in schema.sql AND verified present on the live `greenput` database
 * (`CREATE UNIQUE INDEX idx_users_recovery_phone ON users(recovery_phone)
 * WHERE recovery_phone IS NOT NULL`, read from `sqlite_master` on 2026-09-11).
 * That check matters: it was created by its own statement rather than by an
 * `ALTER TABLE ADD COLUMN`, which is why — unlike four constraints on
 * `workspaces` — it really does exist in production and not only in the file.
 *
 * An index can only catch a duplicate that arrives as the same STRING. While
 * '+19495550777' and '0019495550777' normalised to two different strings, the
 * index was structurally unable to see the collision.
 *
 * `/api/auth/otp/recovery/confirm` re-checks uniqueness in application code
 * before this UPDATE, but that check reads `WHERE recovery_phone = ?` with the
 * same normalised string, so it was blind in exactly the same way. The index is
 * the last line, and this is a test of the last line.
 *
 * NOTE ON SCOPE. This proves the index is enforceable for the class of
 * spellings `toE164` accepts. It does NOT prove no two accounts can ever bind
 * one handset: `phone.spec.ts` pins two spellings that still produce two keys
 * (a trunk zero kept after the country code) and one pair of different handsets
 * that still produce one key (a 10-digit non-NANP number read as NANP). Neither
 * is fixable without a country-code table.
 */
const SCHEMA = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../schema.sql',
);

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function seed(): SqliteD1 {
  const sqlite = createSqliteD1({ files: [SCHEMA] });
  sqlite.raw.exec(`
    INSERT INTO workspaces (id, name, trade, phone)
    VALUES ('${WORKSPACE_ID}', 'Warren Electric', 'electrical', '');
    INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash)
    VALUES
      ('owner-a', '${WORKSPACE_ID}', 'Warren', 'A', 'a@example.com', 'owner', ''),
      ('owner-b', '${WORKSPACE_ID}', 'Someone', 'B', 'b@example.com', 'owner', '');
  `);
  return sqlite;
}

/** Exactly the UPDATE that `/api/auth/otp/recovery/confirm` runs. */
function bind(sqlite: SqliteD1, userId: string, phone: string): Promise<void> {
  return sqlite.db
    .prepare('UPDATE users SET recovery_phone = ?, updated_at = ? WHERE id = ?')
    .bind(phone, '2026-09-11T00:00:00.000Z', userId)
    .run()
    .then(() => undefined);
}

describe('recovery_phone as a key, against the real schema', () => {
  let sqlite: SqliteD1 | undefined;

  afterEach(() => {
    sqlite?.close();
    sqlite = undefined;
  });

  it('the index really is a partial UNIQUE index in the schema under test', () => {
    // Asserted rather than assumed: every test below is meaningless if the
    // harness built a constraint-free table, which is exactly what
    // scripts/db/test-migrate.sh does.
    sqlite = seed();
    const ddl = sqlite.raw
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_users_recovery_phone'",
      )
      .get() as { sql: string } | undefined;
    expect(ddl?.sql).toMatch(/UNIQUE INDEX/i);
    expect(ddl?.sql).toMatch(/WHERE recovery_phone IS NOT NULL/i);
  });

  it('refuses a second account the handset the first one already bound, however it was typed', async () => {
    sqlite = seed();

    // Every spelling of a NANP handset that this function accepts collapses to
    // one string, so the index can see the duplicate.
    const spellings = [
      '+1 (949) 555-0777',
      '9495550777',
      '19495550777',
      '949.555.0777',
      '+19495550777',
    ];
    const keys = new Set(spellings.map((s) => toE164(s)));
    expect([...keys]).toEqual(['+19495550777']);

    await bind(sqlite, 'owner-a', '+19495550777');
    for (const spelling of spellings) {
      await expect(
        bind(sqlite, 'owner-b', toE164(spelling) as string),
        spelling,
      ).rejects.toThrow(/UNIQUE/i);
    }

    const bound = sqlite
      .rows<{ id: string; recovery_phone: string | null }>('users')
      .filter((row) => row.recovery_phone !== null)
      .map((row) => [row.id, row.recovery_phone]);
    expect(bound).toEqual([['owner-a', '+19495550777']]);
  });

  it('gives the dialled-out spelling no second key, because it never reaches the UPDATE', async () => {
    // The old function turned '0019495550777' into '+0019495550777', a second
    // key for one handset that the index could not relate to the first. It is
    // now refused before any SQL runs, so /recovery/confirm answers
    // 400 INVALID_PHONE and there is no second row to insert.
    expect(toE164('0019495550777')).toBeNull();
    expect(toE164('00 949 555 0777')).toBeNull();
    expect(toE164('011 949 555 0777')).toBeNull();

    // And this is the state that used to be reachable, which is what a
    // rejection prevents: two accounts, one handset, both rows accepted.
    sqlite = seed();
    await bind(sqlite, 'owner-a', '+19495550777');
    await bind(sqlite, 'owner-b', '+0019495550777');
    const bound = sqlite
      .rows<{ recovery_phone: string | null }>('users')
      .map((row) => row.recovery_phone)
      .filter((phone): phone is string => phone !== null);
    expect(bound).toHaveLength(2);
    // Neither row is reachable by the other's spelling, which is the lockout:
    // findByRecoveryPhone matches the column exactly.
    const lookup = await sqlite.db
      .prepare('SELECT id FROM users WHERE recovery_phone = ? LIMIT 1')
      .bind('+19495550777')
      .first<{ id: string }>();
    expect(lookup?.id).toBe('owner-a');
  });

  it('keeps the published-number guard able to match, and closes the way round it', async () => {
    // `/api/auth/otp/recovery/start` refuses a candidate any workspace
    // publishes, by comparing `workspaces.phone` to `toE164(input)`.
    //
    // Two things have to hold. First, a stored company number must still be
    // producible by this function, or the guard can never match it — which is
    // why the NANP check stops at the area code and does not check the
    // exchange: two production workspaces carry 555-1xx-xxxx placeholders.
    sqlite = seed();
    sqlite.raw.exec(
      `UPDATE workspaces SET phone = '+15551234567' WHERE id = '${WORKSPACE_ID}'`,
    );

    const guard = (input: string) =>
      sqlite?.db
        .prepare('SELECT 1 AS hit FROM workspaces WHERE phone = ? LIMIT 1')
        .bind(toE164(input))
        .first<{ hit: number }>();

    expect(await guard('(555) 123-4567')).toEqual({ hit: 1 });
    expect(await guard('+1 555 123 4567')).toEqual({ hit: 1 });

    // Second — and this is what the old function got wrong — the guard must
    // not be walkable round by respelling the same number. The old function
    // mapped '001 555 123 4567' to '+0015551234567', which matched no row, so
    // the owner could bind their own published business line as their personal
    // recovery channel. That spelling is now refused outright, before the
    // guard, so there is nothing for it to miss.
    expect(toE164('001 555 123 4567')).toBeNull();
    expect(toE164('011 555 123 4567')).toBeNull();
  });
});
