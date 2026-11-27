// The one definition of "when is this workspace open" that both the Worker
// and the platform read. GP-101 stops at the data; GP-102 (slot generation)
// and GP-104 (double-booking as a capacity rule) build on these two functions
// rather than re-deriving the answer from the rows.

export interface OpeningHours {
  readonly isOpen: boolean;
  readonly opensAt?: string | undefined;
  readonly closesAt?: string | undefined;
}

export interface WeekdayHours extends OpeningHours {
  /** 0 = Sunday … 6 = Saturday, as `Date.prototype.getDay()`. */
  readonly weekday: number;
}

export interface DatedHours extends OpeningHours {
  /** Local calendar date, `YYYY-MM-DD`. */
  readonly date: string;
}

export interface AvailabilitySource {
  readonly timezone?: string | null | undefined;
  readonly week: readonly WeekdayHours[];
  readonly exceptions: readonly DatedHours[];
}

export interface ResolvedDay extends OpeningHours {
  readonly date: string;
  /** Which rule answered: a dated exception, the weekday row, or nothing. */
  readonly source: 'exception' | 'week' | 'none';
}

/**
 * Weekday (0 = Sunday) of a local `YYYY-MM-DD`, computed in UTC so the
 * caller's clock zone cannot shift the date across midnight. The date is a
 * calendar day in the workspace's zone, and a calendar day's weekday does not
 * depend on any zone.
 */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)).getUTCDay();
}

/**
 * The opening hours that apply on one date. A dated exception wins over the
 * weekday row in BOTH directions — closed on a normal working day, open on a
 * normal closed one. No row at all means closed: a workspace that has never
 * said when it works has not said it is open.
 */
export function resolveAvailabilityForDate(
  source: AvailabilitySource,
  date: string,
): ResolvedDay {
  const exception = source.exceptions.find((e) => e.date === date);
  if (exception) {
    return {
      date,
      source: 'exception',
      isOpen: exception.isOpen,
      opensAt: exception.isOpen ? exception.opensAt : undefined,
      closesAt: exception.isOpen ? exception.closesAt : undefined,
    };
  }
  const weekday = weekdayOf(date);
  const day = source.week.find((d) => d.weekday === weekday);
  if (day) {
    return {
      date,
      source: 'week',
      isOpen: day.isOpen,
      opensAt: day.isOpen ? day.opensAt : undefined,
      closesAt: day.isOpen ? day.closesAt : undefined,
    };
  }
  return { date, source: 'none', isOpen: false };
}

/**
 * Whether a booking screen may offer this workspace at all: it has said which
 * zone its hours are in AND at least one weekday is open. Exceptions alone do
 * not make a workspace bookable — they are overrides of a week, not a week.
 * No timezone means "do not guess UTC"; no open weekday means "has never said
 * when it works". Both are "not bookable", never "always open".
 */
export function isBookable(source: AvailabilitySource): boolean {
  if (!source.timezone) return false;
  return source.week.some((d) => d.isOpen);
}
