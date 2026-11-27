// Slot generation: a workspace's opening hours minus its booked work, as the
// list of times a homeowner can pick. Pure — the clock is injected — so the
// API and the tenant site compute the same slots from the same function.
export { generateSlots, SLOT_GRID_MINUTES } from './slots';
export type { BookedInterval, GenerateSlotsInput, Slot } from './slots';
export {
  InvalidTimezoneError,
  addDays,
  assertTimezone,
  localDateOf,
  minutesOfDay,
  zonedTimeToUtc,
} from './timezone';
// Schedule-aware delivery: slot-finding against the per-user scheduling
// tables (windows/blackouts/buffers/settings) inside the scope a shop
// exposed to auto-booking. Pure, like generateSlots — the clock is
// injected and the caller supplies only in-scope windows.
export { findAutoBookSlot } from './auto-book';
export type {
  AutoBookBlackout,
  AutoBookBuffers,
  AutoBookJob,
  AutoBookSettings,
  AutoBookSlot,
  AutoBookWindow,
  FindAutoBookSlotInput,
} from './auto-book';
// The words a homeowner sees for a slot, in the workspace's zone.
export {
  groupSlotsByLocalDay,
  localDayLabel,
  localTimeLabel,
  slotLabel,
} from './format';
export type { LabelledSlot, SlotDay } from './format';
// The double-booking guard (GP-104): the one batch every scheduled job is
// written through, on the API and on the tenant site alike.
export {
  SLOT_MINUTES,
  SLOT_TAKEN_CODE,
  SLOT_TAKEN_MESSAGE,
  bookInFreeLane,
  isSlotConflict,
  slotDeleteStatement,
  slotInsertStatements,
  slotStartsFor,
} from './job-slots';
export type { SlotInsertArgs } from './job-slots';
