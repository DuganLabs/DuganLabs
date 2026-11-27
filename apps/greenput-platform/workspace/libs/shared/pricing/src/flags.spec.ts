import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import {
  PANEL_PHOTO_FLAG,
  createD1Provider,
  createFlags,
  isPanelPhotoEnabled,
  rolloutConfig,
} from './flags.ts';

/**
 * Ship-dark, and stay dark when anything is wrong.
 *
 * The one property that matters: every failure mode of a flag lookup — no
 * table, no row, unparseable config, a D1 that throws — has to resolve to
 * "off". A flag that fails open on a consumer-facing pricing path turns a bug
 * into a price.
 */

const SCHEMA = resolve(__dirname, '../../../..', 'schema.sql');

let sqlite: SqliteD1;
const db = () => sqlite.db;

beforeEach(() => {
  sqlite = createSqliteD1({
    files: [SCHEMA],
    sql: [
      `INSERT INTO workspaces (id, name, slug) VALUES ('ws1', 'Acme', 'acme');`,
      // updated_by references admin_users: a global flag is a platform admin's to
      // set, never a workspace user's (GP-107).
      `INSERT INTO admin_users (id, email, display_name) VALUES ('adm-1', 'ops@greenput.com', 'Pat Ops');`,
      `INSERT INTO users (id, workspace_id, email, first_name, last_name, role, password_hash)
         VALUES ('u1', 'ws1', 'o@example.com', 'Olive', 'Owner', 'owner', 'x');`,
    ],
  });
});

afterEach(() => {
  sqlite.close();
  vi.restoreAllMocks();
});

describe('the D1 provider', () => {
  it('round-trips a flag config through the shared table', async () => {
    const provider = createD1Provider({ db: db(), updatedBy: 'adm-1' });
    expect(await provider.getFlag(PANEL_PHOTO_FLAG)).toBeNull();

    await provider.setFlag?.(PANEL_PHOTO_FLAG, { enabled: true });
    expect(await provider.getFlag(PANEL_PHOTO_FLAG)).toEqual({ enabled: true });
    expect(await provider.getAllFlags()).toEqual({
      [PANEL_PHOTO_FLAG]: { enabled: true },
    });

    const row = sqlite.rows<Record<string, unknown>>('feature_flags')[0];
    expect(row['updated_by']).toBe('adm-1');

    // Setting again updates rather than duplicating.
    await provider.setFlag?.(PANEL_PHOTO_FLAG, {
      enabled: true,
      percentage: 25,
    });
    expect(sqlite.rows('feature_flags')).toHaveLength(1);
    expect(await provider.getFlag(PANEL_PHOTO_FLAG)).toEqual({
      enabled: true,
      percentage: 25,
    });

    await provider.deleteFlag?.(PANEL_PHOTO_FLAG);
    expect(sqlite.rows('feature_flags')).toHaveLength(0);
  });

  it('reads a corrupt config as absent instead of throwing into a request', async () => {
    await db()
      .prepare(
        `INSERT INTO feature_flags (name, config_json) VALUES (?, 'not json')`,
      )
      .bind(PANEL_PHOTO_FLAG)
      .run();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const provider = createD1Provider({ db: db() });
    expect(await provider.getFlag(PANEL_PHOTO_FLAG)).toBeNull();
    expect(await provider.getAllFlags()).toEqual({});
    expect(await isPanelPhotoEnabled(db())).toBe(false);
  });
});

describe('isPanelPhotoEnabled', () => {
  it('is off with no row at all — which is what merging this changes', async () => {
    expect(await isPanelPhotoEnabled(db())).toBe(false);
  });

  it('is on once someone turns it on, and off again when they turn it off', async () => {
    const flags = createFlags({ db: db(), updatedBy: 'adm-1' });
    await flags.setFlag(PANEL_PHOTO_FLAG, { enabled: true });
    expect(await isPanelPhotoEnabled(db())).toBe(true);

    await flags.setFlag(PANEL_PHOTO_FLAG, { enabled: false });
    expect(await isPanelPhotoEnabled(db())).toBe(false);
  });

  it("honours the package's percentage rollout, keyed on the session", async () => {
    await createFlags({ db: db() }).setFlag(
      PANEL_PHOTO_FLAG,
      rolloutConfig(true, 0),
    );
    expect(await isPanelPhotoEnabled(db(), { sessionId: 'a' })).toBe(false);

    await createFlags({ db: db() }).setFlag(
      PANEL_PHOTO_FLAG,
      rolloutConfig(true, 100),
    );
    expect(await isPanelPhotoEnabled(db(), { sessionId: 'a' })).toBe(true);
  });

  it('builds a rollout config the package does not short-circuit past', () => {
    // The bug this works around: `{enabled: true, percentage: 10}` reads as a
    // plain boolean in @basenative/flags 0.4.0 and rolls out to everyone.
    expect(rolloutConfig(true, 10)).toEqual({ percentage: 10 });
    expect(rolloutConfig(true)).toEqual({ enabled: true });
    expect(rolloutConfig(true, 100)).toEqual({ enabled: true });
    expect(rolloutConfig(false, 10)).toEqual({ enabled: false });
  });

  it('treats a database that cannot answer as off, not as an error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = {
      prepare: () => {
        throw new Error('D1_ERROR: no such table: feature_flags');
      },
    } as unknown as D1Database;
    expect(await isPanelPhotoEnabled(broken)).toBe(false);
  });
});
