// Local wall clock ⇄ UTC instant, without a date library.
//
// The rule is "local wall-clock window, UTC storage": a contractor says
// "08:00 to 17:00" in their zone and a job row stores an instant. The only
// thing that bridges the two is the zone's offset at a given instant, and
// `Intl.DateTimeFormat` with a `timeZone` answers that from the runtime's own
// tz database. A Workers bundle is budget-constrained (1 MB gzipped on the
// free plan), so nothing heavier is pulled in for it.

const MINUTE_MS = 60_000;

/**
 * Thrown when slot generation is asked to run without a usable zone. A
 * missing zone must never be read as UTC — a contractor in Chicago would be
 * offered 03:00 starts — so the caller has to say so rather than guess.
 */
export class InvalidTimezoneError extends Error {
  readonly reason: 'missing' | 'unknown';
  readonly timezone: string | null | undefined;

  constructor(
    reason: 'missing' | 'unknown',
    timezone: string | null | undefined,
  ) {
    super(
      reason === 'missing'
        ? 'Slot generation needs the workspace time zone; none is set'
        : `Unknown IANA time zone "${timezone}"`,
    );
    this.name = 'InvalidTimezoneError';
    this.reason = reason;
    this.timezone = timezone;
  }
}

/**
 * The zone as a string the runtime can resolve. Same probe as
 * `isIanaTimeZone` in the validators: ask `Intl` rather than keep a list.
 */
export function assertTimezone(timezone: string | null | undefined): string {
  if (!timezone) throw new InvalidTimezoneError('missing', timezone);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new InvalidTimezoneError('unknown', timezone);
  }
  return timezone;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let fmt = formatters.get(timezone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      // `h23`, not `hour12: false` — the latter prints midnight as "24" in
      // some ICU builds.
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, fmt);
  }
  return fmt;
}

function wallClockOf(instantMs: number, timezone: string): WallClock {
  const out: WallClock = {
    year: 0,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
  };
  for (const part of formatterFor(timezone).formatToParts(
    new Date(instantMs),
  )) {
    switch (part.type) {
      case 'year':
        out.year = Number(part.value);
        break;
      case 'month':
        out.month = Number(part.value);
        break;
      case 'day':
        out.day = Number(part.value);
        break;
      case 'hour':
        out.hour = Number(part.value) % 24;
        break;
      case 'minute':
        out.minute = Number(part.value);
        break;
      case 'second':
        out.second = Number(part.value);
        break;
      default:
        break;
    }
  }
  return out;
}

/** Zone offset at an instant, in ms: local wall clock minus UTC. */
function offsetAt(instantMs: number, timezone: string): number {
  const w = wallClockOf(instantMs, timezone);
  const asUtc = Date.UTC(
    w.year,
    w.month - 1,
    w.day,
    w.hour,
    w.minute,
    w.second,
  );
  // The formatter has no millisecond field, so compare at second precision.
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

const pad = (n: number): string => String(n).padStart(2, '0');

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`;
}

function splitDate(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) throw new RangeError(`Expected a YYYY-MM-DD date, got "${date}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** The local calendar date (`YYYY-MM-DD`) an instant falls on in a zone. */
export function localDateOf(instant: Date, timezone: string): string {
  const w = wallClockOf(instant.getTime(), timezone);
  return isoDate(w.year, w.month, w.day);
}

/** A calendar date shifted by whole days — no zone involved. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = splitDate(date);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return isoDate(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/** `HH:MM` as minutes after local midnight. */
export function minutesOfDay(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new RangeError(`Expected an HH:MM time, got "${hhmm}"`);
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) {
    throw new RangeError(`Expected an HH:MM time, got "${hhmm}"`);
  }
  return hours * 60 + minutes;
}

/**
 * The instant at which a local wall-clock time occurs in a zone.
 *
 * Guess the instant as if the wall clock were UTC, read the zone's offset
 * there, subtract it, then read the offset again at the result — the two
 * differ only within a few hours of a DST transition. Where they differ, the
 * candidate whose wall clock reads back as requested wins; where neither does
 * (the spring-forward gap, 02:30 on a day that jumps from 02:00 to 03:00) the
 * time rolls forward to 03:30, the way a clock does. A time that occurs twice
 * (the autumn fall-back hour) resolves to its first occurrence.
 */
export function zonedTimeToUtc(
  date: string,
  minuteOfDay: number,
  timezone: string,
): Date {
  const [y, m, d] = splitDate(date);
  const guess = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  const first = guess - offsetAt(guess, timezone);
  const second = guess - offsetAt(first, timezone);
  if (first === second) return new Date(first);
  const wanted = guess / MINUTE_MS;
  const reads = (candidate: number): number => {
    const w = wallClockOf(candidate, timezone);
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) / MINUTE_MS;
  };
  if (reads(second) === wanted) return new Date(second);
  return new Date(first);
}
