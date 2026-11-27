/// <reference types="@cloudflare/workers-types" />
import {
  SLOT_TAKEN_CODE,
  SLOT_TAKEN_MESSAGE,
} from '@greenput/shared/scheduling';
import { error } from './response';

/**
 * Double-booking guard (GP-104) — the API's face of it.
 *
 * The guard itself lives in `libs/shared/scheduling` (`job-slots.ts`) so the
 * tenant site, which books a homeowner's own quote (GP-103), writes through
 * the same `job_slots` batch as `POST /api/jobs` and the opportunity
 * conversion. Only the HTTP answer is this Worker's.
 */
export {
  SLOT_MINUTES,
  SLOT_TAKEN_CODE,
  SLOT_TAKEN_MESSAGE,
  bookInFreeLane,
  isSlotConflict,
  slotDeleteStatement,
  slotInsertStatements,
  slotStartsFor,
} from '@greenput/shared/scheduling';
export type { SlotInsertArgs } from '@greenput/shared/scheduling';

/** 409 for a slot with no free lane. The message is what the platform shows. */
export function slotTaken(): Response {
  return error(SLOT_TAKEN_MESSAGE, 409, SLOT_TAKEN_CODE);
}
