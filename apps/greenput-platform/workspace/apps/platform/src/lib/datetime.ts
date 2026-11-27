/**
 * `datetime-local` helpers. A `datetime-local` input takes and gives back a
 * local `YYYY-MM-DDTHH:MM`; the API takes and gives back UTC ISO. The two
 * conversions live here so the convert panel, the job form and the job
 * detail's schedule editor agree on which way is which.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Local `YYYY-MM-DDTHH:MM`, the value a `datetime-local` input takes and
 * gives back. Built from the local getters on purpose: `toISOString()` is
 * UTC, which shows a contractor the wrong hour everywhere but Greenwich.
 */
export function toDateTimeLocal(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** The first whole local hour strictly after `from`. */
export function nextWholeHour(from: Date): Date {
  const next = new Date(from);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

/**
 * A `datetime-local` value as the UTC ISO string the API validates with
 * `z.string().datetime()`, or `null` when the input is empty or unparseable.
 */
export function dateTimeLocalToIso(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
