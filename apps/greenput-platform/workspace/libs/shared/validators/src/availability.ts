import { z } from 'zod';

// PUT /api/availability — the whole week, the dated exceptions and the booking
// policy, replaced together. A partial week is not a meaningful state, so this
// is a full replacement rather than a patch: every field is required and the
// week must name each of the seven weekdays exactly once.

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Local wall-clock time, `HH:MM`, 24-hour. */
export const LocalTimeSchema = z
  .string()
  .regex(HHMM, 'Expected a time as HH:MM (24-hour)');

/**
 * `new Date()` rolls an out-of-range month or day forward instead of
 * rejecting it, so a date only counts if it reads back as written.
 */
function isCalendarDate(value: string): boolean {
  const match = LOCAL_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  );
}

/** A local calendar date, `YYYY-MM-DD`, that actually exists. */
export const LocalDateSchema = z
  .string()
  .regex(LOCAL_DATE, 'Expected a date as YYYY-MM-DD')
  .refine(isCalendarDate, 'That date does not exist');

/**
 * An IANA zone name the runtime can resolve (`America/Chicago`). Checked by
 * asking `Intl` to format in it rather than against a hand-kept list — the
 * list would go stale, and the runtime is the thing that has to agree.
 */
export function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const TimeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(isIanaTimeZone, 'Expected an IANA time zone such as America/Chicago');

interface Hours {
  isOpen: boolean;
  opensAt?: string | undefined;
  closesAt?: string | undefined;
}

/**
 * An open day needs both times and they must be in order. A closed day may
 * carry times (the form keeps them so re-opening the day restores them) or
 * not — either way they are not asserted.
 */
function requireHoursWhenOpen(hours: Hours, ctx: z.RefinementCtx): void {
  if (!hours.isOpen) return;
  if (!hours.opensAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['opensAt'],
      message: 'An open day needs an opening time',
    });
  }
  if (!hours.closesAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['closesAt'],
      message: 'An open day needs a closing time',
    });
  }
  if (hours.opensAt && hours.closesAt && hours.opensAt >= hours.closesAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['closesAt'],
      message: 'Closing time must be after opening time',
    });
  }
}

const hoursShape = {
  isOpen: z.boolean(),
  opensAt: LocalTimeSchema.optional(),
  closesAt: LocalTimeSchema.optional(),
};

/** 0 = Sunday … 6 = Saturday, as `Date.prototype.getDay()`. */
export const AvailabilityDaySchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    ...hoursShape,
  })
  .superRefine(requireHoursWhenOpen);

export const AvailabilityExceptionSchema = z
  .object({
    date: LocalDateSchema,
    ...hoursShape,
    reason: z.string().trim().max(200).optional(),
  })
  .superRefine(requireHoursWhenOpen);

export const MAX_AVAILABILITY_EXCEPTIONS = 100;

export const UpdateAvailabilitySchema = z.object({
  timezone: TimeZoneSchema.nullable(),
  bookingLeadHours: z
    .number()
    .int()
    .min(0)
    .max(24 * 30),
  bookingHorizonDays: z.number().int().min(1).max(365),
  travelBufferMinutes: z
    .number()
    .int()
    .min(0)
    .max(8 * 60),
  concurrentJobs: z.number().int().min(1).max(50),
  week: z
    .array(AvailabilityDaySchema)
    .length(7, 'The week must have exactly seven days')
    .refine(
      (days) => new Set(days.map((d) => d.weekday)).size === 7,
      'The week must name each weekday exactly once',
    ),
  exceptions: z
    .array(AvailabilityExceptionSchema)
    .max(MAX_AVAILABILITY_EXCEPTIONS)
    .refine(
      (list) => new Set(list.map((e) => e.date)).size === list.length,
      'Each date may have only one exception',
    ),
});

export type AvailabilityDayInput = z.infer<typeof AvailabilityDaySchema>;
export type AvailabilityExceptionInput = z.infer<
  typeof AvailabilityExceptionSchema
>;
export type UpdateAvailabilityInput = z.infer<typeof UpdateAvailabilitySchema>;
