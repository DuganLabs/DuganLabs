import {
  addDays,
  assertTimezone,
  localDateOf,
  zonedTimeToUtc,
} from './timezone';

/**
 * Schedule-aware delivery slot-finding — the pure core of the delivery
 * engine (gap H3 / plan item 10b). It reads the four per-user scheduling
 * tables captured by migration 035 (availability_windows,
 * availability_blackouts, schedule_buffers, schedule_settings) — NOT the
 * workspace-level GP-101 week (workspace_availability), which answers a
 * different question ("when is the shop open") from this one ("which
 * enrolled tech can take this job, inside the scope the shop exposed to
 * auto-booking").
 *
 * Gating is the caller's job (enrollment: TIME windows exposed, SERVICE
 * enabled, TEAM member enrolled — see schedule_delivery_enrollments).
 * This function receives only the windows the shop chose to expose for
 * the enrolled techs, so anything it returns is inside configured scope
 * by construction.
 *
 * Rules for a candidate start (30-minute grid, local wall clock):
 * - the work + the service's pre/post buffers + travel buffer must fit
 *   inside ONE window (a job never straddles a window edge);
 * - the buffered footprint must not intersect a blackout for that tech;
 * - the footprint must keep `minGapMinutes` clear of the tech's other
 *   jobs that day, and the day must be under `maxJobsPerDay`;
 * - the start must satisfy the workspace's minimum notice and fall
 *   inside the maximum lead time.
 * First fit wins, scanning days outward from today and techs in the
 * order given — callers order techs by preference.
 */

export interface AutoBookWindow {
  readonly userId: string;
  /** 0 = Sunday, as Date.getDay(). */
  readonly dayOfWeek: number;
  /** Minutes after local midnight. */
  readonly startMinute: number;
  readonly endMinute: number;
}

export interface AutoBookBlackout {
  readonly userId: string;
  readonly startAt: string; // ISO instant
  readonly endAt: string; // ISO instant
}

export interface AutoBookBuffers {
  readonly preMinutes: number;
  readonly postMinutes: number;
  readonly minGapMinutes: number;
  /** Null means no per-day cap from the buffers row. */
  readonly maxJobsPerDay: number | null;
}

export interface AutoBookSettings {
  /** IANA zone; null is refused, never read as UTC. */
  readonly timezone: string | null | undefined;
  readonly minNoticeHours: number;
  /** Null means the engine default (14 days). */
  readonly maxLeadTimeDays: number | null;
  readonly travelBufferMinutes: number;
}

export interface AutoBookJob {
  readonly userId: string | null;
  readonly startUtc: string;
  readonly endUtc: string;
}

export interface AutoBookSlot {
  readonly userId: string;
  readonly startUtc: string;
  readonly endUtc: string;
}

export interface FindAutoBookSlotInput {
  readonly windows: readonly AutoBookWindow[];
  readonly blackouts: readonly AutoBookBlackout[];
  readonly buffers: AutoBookBuffers;
  readonly settings: AutoBookSettings;
  readonly jobs: readonly AutoBookJob[];
  readonly durationMinutes: number;
  /** Injected, never Date.now(). */
  readonly now: Date;
}

const MINUTE_MS = 60_000;
const GRID_MINUTES = 30;
const DEFAULT_HORIZON_DAYS = 14;

function overlaps(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function findAutoBookSlot(
  input: FindAutoBookSlotInput,
): AutoBookSlot | null {
  const timezone = assertTimezone(input.settings.timezone);
  const duration = input.durationMinutes;
  if (!Number.isFinite(duration) || duration < 1) {
    throw new RangeError(`durationMinutes must be >= 1, got ${duration}`);
  }
  const horizonDays = input.settings.maxLeadTimeDays ?? DEFAULT_HORIZON_DAYS;
  const nowMs = input.now.getTime();
  const earliestStart =
    nowMs + Math.max(0, input.settings.minNoticeHours) * 60 * MINUTE_MS;
  const latestStart = nowMs + horizonDays * 24 * 60 * MINUTE_MS;

  const travelMs = Math.max(0, input.settings.travelBufferMinutes) * MINUTE_MS;
  const preMs = Math.max(0, input.buffers.preMinutes) * MINUTE_MS;
  const postMs = Math.max(0, input.buffers.postMinutes) * MINUTE_MS;
  const gapMs = Math.max(0, input.buffers.minGapMinutes) * MINUTE_MS;

  const techOrder: string[] = [];
  for (const w of input.windows) {
    if (!techOrder.includes(w.userId)) techOrder.push(w.userId);
  }

  const firstDate = localDateOf(new Date(earliestStart), timezone);
  const lastDate = localDateOf(new Date(latestStart), timezone);

  for (let date = firstDate; date <= lastDate; date = addDays(date, 1)) {
    // The calendar date's weekday is a calendar fact, not a zone fact.
    const [y, m, d] = date.split('-').map(Number);
    const dayOfWeek = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();

    for (const userId of techOrder) {
      const dayWindows = input.windows
        .filter((w) => w.userId === userId && w.dayOfWeek === dayOfWeek)
        .sort((a, b) => a.startMinute - b.startMinute);
      if (dayWindows.length === 0) continue;

      const techJobs = input.jobs
        .filter((j) => j.userId === userId)
        .map((j) => ({
          start: Date.parse(j.startUtc),
          end: Date.parse(j.endUtc),
        }));
      const jobsThatDay = techJobs.filter(
        (j) =>
          localDateOf(new Date(j.start), timezone) === date ||
          localDateOf(new Date(j.end), timezone) === date,
      );
      if (
        input.buffers.maxJobsPerDay !== null &&
        jobsThatDay.length >= input.buffers.maxJobsPerDay
      ) {
        continue;
      }
      const techBlackouts = input.blackouts
        .filter((b) => b.userId === userId)
        .map((b) => ({
          start: Date.parse(b.startAt),
          end: Date.parse(b.endAt),
        }));

      for (const window of dayWindows) {
        const firstGrid =
          Math.ceil(window.startMinute / GRID_MINUTES) * GRID_MINUTES;
        for (
          let minute = firstGrid;
          minute < window.endMinute;
          minute += GRID_MINUTES
        ) {
          const startMs = zonedTimeToUtc(date, minute, timezone).getTime();
          if (startMs < earliestStart || startMs > latestStart) continue;
          const workEndMs = startMs + duration * MINUTE_MS;
          const footStart = startMs - preMs;
          const footEnd = workEndMs + postMs + travelMs;
          // The whole footprint must sit inside this window.
          const windowStartMs = zonedTimeToUtc(
            date,
            window.startMinute,
            timezone,
          ).getTime();
          const windowEndMs = zonedTimeToUtc(
            date,
            window.endMinute,
            timezone,
          ).getTime();
          if (footStart < windowStartMs || footEnd > windowEndMs) continue;
          if (
            techBlackouts.some((b) =>
              overlaps(footStart, footEnd, b.start, b.end),
            )
          ) {
            continue;
          }
          if (
            techJobs.some((j) =>
              overlaps(footStart - gapMs, footEnd + gapMs, j.start, j.end),
            )
          ) {
            continue;
          }
          return {
            userId,
            startUtc: new Date(startMs).toISOString(),
            endUtc: new Date(workEndMs).toISOString(),
          };
        }
      }
    }
  }
  return null;
}
