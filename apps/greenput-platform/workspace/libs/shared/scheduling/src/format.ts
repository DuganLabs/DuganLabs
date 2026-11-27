import type { Slot } from './slots';
import { assertTimezone, localDateOf } from './timezone';

// Slots as a homeowner reads them: in the WORKSPACE'S zone, grouped by the
// calendar day they fall on there. The stored instants stay UTC; only the
// labels are local. Pure, so the tenant site and the API (GP-105's
// reschedule) print the same words for the same instant.

/** One offered time with the words to show for it. */
export interface LabelledSlot extends Slot {
  /** "9:00 AM – 11:00 AM" — the work, not the travel after it. */
  readonly label: string;
}

/** Every slot on one local calendar day. */
export interface SlotDay {
  /** Local `YYYY-MM-DD`, the grouping key and the `<fieldset>` id. */
  readonly date: string;
  /** "Tuesday, 6 October" */
  readonly label: string;
  readonly slots: readonly LabelledSlot[];
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = dayFormatters.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    dayFormatters.set(timezone, fmt);
  }
  return fmt;
}

function timeFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = timeFormatters.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
    });
    timeFormatters.set(timezone, fmt);
  }
  return fmt;
}

function instantOf(iso: string): Date {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new RangeError(`Not an instant: "${iso}"`);
  return new Date(ms);
}

/** "Tuesday, October 6" for the local day an instant falls on. */
export function localDayLabel(iso: string, timezone: string): string {
  return dayFormatter(assertTimezone(timezone)).format(instantOf(iso));
}

/** "9:00 AM" for an instant, in the zone. */
export function localTimeLabel(iso: string, timezone: string): string {
  // Newer ICU puts a narrow no-break space before AM/PM; a plain space reads
  // the same and survives a test's string comparison.
  return timeFormatter(assertTimezone(timezone))
    .format(instantOf(iso))
    .replace(/[\u202f\u00a0]/g, ' ');
}

/** "9:00 AM – 11:00 AM" for a slot, in the zone. */
export function slotLabel(slot: Slot, timezone: string): string {
  return `${localTimeLabel(slot.startUtc, timezone)} – ${localTimeLabel(
    slot.endUtc,
    timezone,
  )}`;
}

/**
 * Slots grouped by the local calendar day they start on, in the order
 * `generateSlots` produced them (chronological). A day with no slot is
 * simply absent — the picker shows what can be booked, not a calendar.
 */
export function groupSlotsByLocalDay(
  slots: readonly Slot[],
  timezone: string,
): SlotDay[] {
  const zone = assertTimezone(timezone);
  const days: Array<{ date: string; label: string; slots: LabelledSlot[] }> =
    [];
  for (const slot of slots) {
    const date = localDateOf(instantOf(slot.startUtc), zone);
    let day = days[days.length - 1];
    if (!day || day.date !== date) {
      day = { date, label: localDayLabel(slot.startUtc, zone), slots: [] };
      days.push(day);
    }
    day.slots.push({ ...slot, label: slotLabel(slot, zone) });
  }
  return days;
}
