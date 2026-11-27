/**
 * GP-104: the API answers 409 `SLOT_TAKEN` when every lane for a half-hour
 * is already booked. The message on it is the one the user should read
 * ("That time just went — pick another"), and the calendar the user was
 * looking at is now stale — so the caller reloads the schedule.
 *
 * Structural rather than `instanceof ApiError`: `@basenative/fetch` is
 * reached under two names in this workspace, so an identity check can fail
 * on exactly the object we mean (see routes/recover/recover.ts).
 */
export function isSlotTaken(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { name?: unknown; status?: unknown; code?: unknown };
  return e.name === 'ApiError' && (e.code === 'SLOT_TAKEN' || e.status === 409);
}
