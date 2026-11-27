/// <reference types="@cloudflare/workers-types" />
import {
  createFlagManager,
  type FlagConfig,
  type FlagContext,
  type FlagManager,
  type FlagProvider,
} from '@basenative/flags';

/**
 * Feature flags, on @basenative/flags.
 *
 * The org rule is "don't introduce a new direct dependency if a @basenative/*
 * package covers it" — this one does, so the enabled/percentage/rule
 * semantics here are the package's `createFlagManager`, not a
 * reimplementation of it. What is local is only the PROVIDER: the package
 * ships memory, remote and Cloudflare-KV providers, and a KV provider is no
 * use for a flag the API Worker and the tenant-site Worker must both agree
 * on — tenant-site has no KV binding, and both Workers do share the `DB` D1
 * binding. So `createD1Provider` implements the package's provider contract
 * against the `feature_flags` table and hands it straight to the package.
 */

export type { FlagConfig, FlagContext, FlagManager, FlagProvider };

/**
 * The flag that gates the panel-photo surface — the upload a homeowner sees
 * and the review queue behind it. Absent row = off, so merging this changes
 * nothing a consumer can reach until it is switched on.
 *
 * The intake form itself is NOT gated: it shipped in #116 and is already
 * live. Retro-gating someone else's shipped behaviour behind a flag that
 * defaults to off would take it away.
 */
export const PANEL_PHOTO_FLAG = 'intake_panel_photo';

export interface D1ProviderOptions {
  readonly db: D1Database;
  /** Stamped onto feature_flags.updated_by when a flag is written: the platform
   *  admin (admin_users.id) who flipped it. Not a workspace user — a global flag
   *  is not a tenant's to set (GP-107). */
  readonly updatedBy?: string | null;
}

function parseConfig(raw: string, name: string): FlagConfig | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed as FlagConfig;
  } catch {
    // A corrupt flag row must fail closed, never throw into a request path.
    console.error('feature flag config is not valid JSON', { name });
    return null;
  }
}

/** A @basenative/flags provider backed by the shared `feature_flags` table. */
export function createD1Provider(options: D1ProviderOptions): FlagProvider {
  const { db, updatedBy = null } = options;
  return {
    async getFlag(name: string): Promise<FlagConfig | null> {
      const row = await db
        .prepare('SELECT config_json FROM feature_flags WHERE name = ?')
        .bind(name)
        .first<{ config_json: string }>();
      return row ? parseConfig(row.config_json, name) : null;
    },
    async getAllFlags(): Promise<Record<string, FlagConfig>> {
      const rows = (
        await db
          .prepare('SELECT name, config_json FROM feature_flags')
          .all<{ name: string; config_json: string }>()
      ).results;
      const flags: Record<string, FlagConfig> = {};
      for (const row of rows) {
        const config = parseConfig(row.config_json, row.name);
        if (config) flags[row.name] = config;
      }
      return flags;
    },
    async setFlag(name: string, config: FlagConfig): Promise<void> {
      await db
        .prepare(
          `INSERT INTO feature_flags (name, config_json, updated_by, updated_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(name) DO UPDATE SET
             config_json = excluded.config_json,
             updated_by = excluded.updated_by,
             updated_at = excluded.updated_at`,
        )
        .bind(name, JSON.stringify(config), updatedBy)
        .run();
    },
    async deleteFlag(name: string): Promise<void> {
      await db
        .prepare('DELETE FROM feature_flags WHERE name = ?')
        .bind(name)
        .run();
    },
  };
}

/**
 * Build a config the package will actually honour.
 *
 * `@basenative/flags` 0.4.0 short-circuits on a boolean: `isEnabled` returns
 * `flag.enabled` immediately when it is a boolean and there are no rules, so
 * `{enabled: true, percentage: 10}` is a 100% rollout and the percentage is
 * dead config. A partial rollout therefore has to be stored as `{percentage}`
 * with no `enabled` key at all, which is the branch that does run. This
 * function is the one place that knows that, so no caller has to.
 *
 * Reported upstream as DuganLabs/BaseNative#209; when the package stops
 * short-circuiting, both shapes behave identically and this collapses to a
 * single object.
 */
export function rolloutConfig(
  enabled: boolean,
  percentage?: number,
): FlagConfig {
  if (!enabled) return { enabled: false };
  if (percentage === undefined || percentage >= 100) return { enabled: true };
  return { percentage };
}

/**
 * Build the flag manager for a Worker request.
 *
 * `defaultValue: false` is the ship-dark guarantee: a missing table, a missing
 * row, or a corrupt config all resolve to "off", so merging this branch
 * changes nothing a consumer can see until the flag is switched on.
 */
export function createFlags(options: D1ProviderOptions): FlagManager {
  return createFlagManager(createD1Provider(options), { defaultValue: false });
}

/**
 * Is the panel-photo surface live for this request?
 *
 * Never throws: a flag lookup that fails (table missing on an un-migrated
 * database, D1 hiccup) is reported and treated as off — failing open on a
 * consumer-facing pricing path is the worse mistake.
 */
export async function isPanelPhotoEnabled(
  db: D1Database,
  context: FlagContext = {},
): Promise<boolean> {
  try {
    return await createFlags({ db }).isEnabled(PANEL_PHOTO_FLAG, context);
  } catch (err) {
    console.error('feature flag lookup failed; treating as disabled', {
      flag: PANEL_PHOTO_FLAG,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
