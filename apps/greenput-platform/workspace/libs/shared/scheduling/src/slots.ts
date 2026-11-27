import {
  resolveAvailabilityForDate,
  type DatedHours,
  type WeekdayHours,
} from '@greenput/shared/utils';
import {
  addDays,
  assertTimezone,
  localDateOf,
  minutesOfDay,
  zonedTimeToUtc,
} from './timezone';

/** Start times sit on the half hour. Not finer — travel makes 15-minute precision false. */
export const SLOT_GRID_MINUTES = 30;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** One offered time. Both ends are ISO-8601 UTC instants; `endUtc` is the work, not the travel after it. */
export interface Slot {
  readonly startUtc: string;
  readonly endUtc: string;
}

/**
 * Work already on the calendar — `jobs.scheduled_start` / `scheduled_end`.
 * The interval is the job itself; the travel buffer is added here, after it.
 */
export interface BookedInterval {
  readonly startUtc: string;
  readonly endUtc: string;
}

export interface GenerateSlotsInput {
  /** The recurring week, one row per weekday (0 = Sunday). */
  readonly availability: readonly WeekdayHours[];
  /** Dated overrides; an exception wins over the weekday row in both directions. */
  readonly exceptions: readonly DatedHours[];
  readonly jobs: readonly BookedInterval[];
  /** How long the work takes — from the quote, never from the homeowner. */
  readonly durationMinutes: number;
  /** IANA zone the hours are written in. Null is refused, never read as UTC. */
  readonly timezone: string | null | undefined;
  /** No slot starts sooner than this after `now`. */
  readonly leadHours: number;
  /** No slot starts later than this after `now`. */
  readonly horizonDays: number;
  /** Travel gap appended after each job, so a day's first slot starts at opening time. */
  readonly travelBufferMinutes: number;
  /** How many jobs may overlap — a two-van shop books two. */
  readonly concurrency: number;
  /** Injected, never `Date.now()`: a test at midnight and a workflow script both need to choose it. */
  readonly now: Date;
}

interface Footprint {
  readonly start: number;
  readonly end: number;
}

function requireNumber(
  value: number,
  name: string,
  { min, integer = false }: { min: number; integer?: boolean },
): number {
  if (
    !Number.isFinite(value) ||
    value < min ||
    (integer && !Number.isInteger(value))
  ) {
    throw new RangeError(
      `${name} must be a${integer ? 'n integer' : ' number'} >= ${min}, got ${value}`,
    );
  }
  return value;
}

function instantOf(iso: string, what: string): number {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms))
    throw new RangeError(`${what} is not an instant: "${iso}"`);
  return ms;
}

/**
 * Every time a job of `durationMinutes` could start, given when the workspace
 * is open and what it has already booked.
 *
 * A slot is offered when, in the workspace's zone, `[start, start + duration
 * + travelBuffer)` lies inside that day's open window, `start` is no earlier
 * than `now + leadHours` and no later than `now + horizonDays`, and fewer than
 * `concurrency` existing jobs — each extended by the same travel buffer —
 * overlap it. So a job ending at 11:00 with a 30-minute buffer blocks an
 * 11:00 start and leaves 11:30 free.
 *
 * The half-hour grid is walked in LOCAL minutes and each start is converted
 * to an instant on its own, so a zone at a quarter-hour offset (Kathmandu,
 * +05:45) still offers 08:00 and 08:30 local, and a day that changes clocks
 * keeps its opening time while the UTC instant moves.
 */
export function generateSlots(input: GenerateSlotsInput): Slot[] {
  const timezone = assertTimezone(input.timezone);
  const duration = requireNumber(input.durationMinutes, 'durationMinutes', {
    min: 1,
  });
  const leadHours = requireNumber(input.leadHours, 'leadHours', { min: 0 });
  const horizonDays = requireNumber(input.horizonDays, 'horizonDays', {
    min: 0,
  });
  const buffer = requireNumber(
    input.travelBufferMinutes,
    'travelBufferMinutes',
    { min: 0 },
  );
  const concurrency = requireNumber(input.concurrency, 'concurrency', {
    min: 1,
    integer: true,
  });
  const nowMs = input.now.getTime();
  if (Number.isNaN(nowMs)) throw new RangeError('now is not a valid Date');

  const earliestStart = nowMs + leadHours * HOUR_MS;
  const latestStart = nowMs + horizonDays * DAY_MS;
  const footprintMs = (duration + buffer) * MINUTE_MS;
  const bufferMs = buffer * MINUTE_MS;

  const booked: Footprint[] = input.jobs.map((job) => ({
    start: instantOf(job.startUtc, 'job startUtc'),
    end: instantOf(job.endUtc, 'job endUtc') + bufferMs,
  }));

  const source = {
    timezone,
    week: input.availability,
    exceptions: input.exceptions,
  };
  const lastDate = localDateOf(new Date(latestStart), timezone);

  const slots: Slot[] = [];
  for (
    let date = localDateOf(new Date(earliestStart), timezone);
    date <= lastDate;
    date = addDays(date, 1)
  ) {
    const day = resolveAvailabilityForDate(source, date);
    if (!day.isOpen || !day.opensAt || !day.closesAt) continue;
    const opens = minutesOfDay(day.opensAt);
    const closes = minutesOfDay(day.closesAt);
    const closeMs = zonedTimeToUtc(date, closes, timezone).getTime();

    let previousStart = Number.NEGATIVE_INFINITY;
    const firstOnGrid =
      Math.ceil(opens / SLOT_GRID_MINUTES) * SLOT_GRID_MINUTES;
    for (
      let minute = firstOnGrid;
      minute < closes;
      minute += SLOT_GRID_MINUTES
    ) {
      const startMs = zonedTimeToUtc(date, minute, timezone).getTime();
      // A wall-clock time inside a spring-forward gap rolls onto the next
      // real one, which the grid then reaches on its own — offer it once.
      if (startMs <= previousStart) continue;
      previousStart = startMs;

      if (startMs + footprintMs > closeMs) continue;
      if (startMs < earliestStart || startMs > latestStart) continue;

      const slotEnd = startMs + footprintMs;
      let overlapping = 0;
      for (const job of booked) {
        if (job.start < slotEnd && job.end > startMs) overlapping += 1;
      }
      if (overlapping >= concurrency) continue;

      slots.push({
        startUtc: new Date(startMs).toISOString(),
        endUtc: new Date(startMs + duration * MINUTE_MS).toISOString(),
      });
    }
  }
  return slots;
}
