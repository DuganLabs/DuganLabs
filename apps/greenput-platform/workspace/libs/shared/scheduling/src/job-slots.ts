/// <reference types="@cloudflare/workers-types" />
import { SLOT_GRID_MINUTES } from './slots';

/**
 * Double-booking guard (GP-104).
 *
 * `job_slots` holds one row per half-hour a job occupies, per lane, with
 * `PRIMARY KEY (workspace_id, slot_start, lane)`. That key is the whole
 * mechanism: a booking inserts the job and its slot rows in ONE
 * `db.batch()`, D1 runs a batch as a transaction, and a colliding row fails
 * the batch — so the job row never lands. There is deliberately no
 * SELECT-then-INSERT anywhere: two requests interleaved between a check and
 * a write both pass, and the only reason two people pick the same slot is
 * that they were looking at the same time.
 *
 * Lanes run 0..`workspaces.concurrent_jobs`-1 (GP-101). Lane assignment is
 * "lowest free": try lane 0, move up on conflict, stop when the lanes run
 * out. The bound is small, so the retry is bounded too.
 *
 * Shared between the API (jobs, opportunity conversion) and the tenant site
 * (a homeowner booking the job they were just quoted, GP-103): every path
 * that writes a scheduled job goes through this one guard.
 */

export const SLOT_MINUTES = SLOT_GRID_MINUTES;
const SLOT_MS = SLOT_MINUTES * 60_000;

/** The wire code a full slot answers with; the platform reloads on it. */
export const SLOT_TAKEN_CODE = 'SLOT_TAKEN';
export const SLOT_TAKEN_MESSAGE = 'That time just went — pick another';

/**
 * Every half-hour grid start a job occupies, as UTC ISO strings
 * (`YYYY-MM-DDTHH:MM:00.000Z`). The start is floored to the grid; a slot is
 * claimed while it begins before the end. A zero-length or sub-half-hour job
 * still claims one slot — a job with no slot rows is a job the guard does
 * not see. 09:00–11:30 writes five rows.
 *
 * Mirrors the SQL backfill in migrations/028-job-slots.sql: both must put the
 * same instant on the same grid line, or a migrated row and a runtime row for
 * the same half-hour would not collide.
 */
export function slotStartsFor(
  scheduledStart: string,
  scheduledEnd: string,
): string[] {
  const start = Date.parse(scheduledStart);
  const end = Date.parse(scheduledEnd);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new TypeError(
      `slotStartsFor: unparseable schedule ${scheduledStart} – ${scheduledEnd}`,
    );
  }
  const first = Math.floor(start / SLOT_MS) * SLOT_MS;
  const slots = [new Date(first).toISOString()];
  for (let t = first + SLOT_MS; t < end; t += SLOT_MS) {
    slots.push(new Date(t).toISOString());
  }
  return slots;
}

export interface SlotInsertArgs {
  workspaceId: string;
  jobId: string;
  lane: number;
  slotStarts: readonly string[];
}

/** One INSERT per slot row, to go in the same batch as the job's own write. */
export function slotInsertStatements(
  db: D1Database,
  { workspaceId, jobId, lane, slotStarts }: SlotInsertArgs,
): D1PreparedStatement[] {
  return slotStarts.map((slotStart) =>
    db
      .prepare(
        'INSERT INTO job_slots (workspace_id, slot_start, lane, job_id) VALUES (?, ?, ?, ?)',
      )
      .bind(workspaceId, slotStart, lane, jobId),
  );
}

/** The DELETE that frees a job's half-hours (reschedule, cancel). */
export function slotDeleteStatement(
  db: D1Database,
  jobId: string,
): D1PreparedStatement {
  return db.prepare('DELETE FROM job_slots WHERE job_id = ?').bind(jobId);
}

/**
 * True only for the `job_slots` primary-key collision. Any other constraint
 * (a bad opportunity_id, a NOT NULL) is a real error and must not be retried
 * on another lane or reported as "that time just went". D1 reports it as
 * `D1_ERROR: UNIQUE constraint failed: job_slots.workspace_id, …:
 * SQLITE_CONSTRAINT`; node:sqlite (the test shim) as the same text without
 * the prefix and suffix.
 */
export function isSlotConflict(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /UNIQUE constraint failed: job_slots\./.test(message);
}

/**
 * Run `statementsFor(lane)` as one atomic batch in the lowest free lane.
 * Resolves to the lane that took the booking, or `null` when every lane up
 * to `workspaces.concurrent_jobs` is taken — in which case nothing was
 * written (the failed batch rolled back). Any error other than a slot
 * collision is rethrown untouched.
 *
 * `concurrent_jobs` is read only on the first collision: the happy path
 * costs one round trip, and the read is not a check — the batch is.
 */
export async function bookInFreeLane(
  db: D1Database,
  workspaceId: string,
  statementsFor: (lane: number) => D1PreparedStatement[],
): Promise<number | null> {
  let lanes: number | null = null;
  for (let lane = 0; ; lane++) {
    try {
      await db.batch(statementsFor(lane));
      return lane;
    } catch (err) {
      if (!isSlotConflict(err)) throw err;
      lanes ??= await concurrentJobs(db, workspaceId);
      if (lane + 1 >= lanes) return null;
    }
  }
}

async function concurrentJobs(
  db: D1Database,
  workspaceId: string,
): Promise<number> {
  const row = await db
    .prepare('SELECT concurrent_jobs FROM workspaces WHERE id = ?')
    .bind(workspaceId)
    .first<{ concurrent_jobs: number | null }>();
  const n = Number(row?.concurrent_jobs ?? 1);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}
