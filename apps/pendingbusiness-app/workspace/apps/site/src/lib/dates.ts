/**
 * Timestamp formatting for values that come back from D1.
 *
 * Three call sites each did `new Date(value + 'Z').toLocaleString()`
 * (main.ts's saved-scenarios column, settings.ts's last-sync column and its
 * Plaid credentials line). That works on exactly one input shape — SQLite's
 * `datetime('now')`, which emits `2026-09-01 10:00:00` with no zone — and
 * breaks on every other: appending `Z` to a string that already ends in `Z`
 * gives `2026-09-01T10:00:00ZZ`, which V8 rejects, and the UI printed
 * "Invalid Date". Driven in a browser with a valid ISO-8601 `createdAt`, both
 * rows of the Saved scenarios table read "Invalid Date".
 *
 * Nothing guarantees the column keeps its current shape — a `CURRENT_TIMESTAMP`
 * default, a Plaid field passed through, or a future migration to ISO storage
 * all produce the offset form — so parsing is done once, here, for both.
 */

/** Does this timestamp already say what zone it is in? */
function hasTimezone(value: string): boolean {
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim());
}

/**
 * Parse a timestamp from the API. A value that carries a zone is parsed as
 * written; a bare `YYYY-MM-DD HH:MM:SS` (SQLite's form) is read as UTC, which
 * is what `datetime('now')` actually stores. Returns `null` rather than an
 * Invalid Date, so callers have to decide what to show.
 */
export function parseTimestamp(value: string | null | undefined): Date | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (raw === '') return null;
  const normalised = hasTimezone(raw) ? raw : `${raw.replace(' ', 'T')}Z`;
  const date = new Date(normalised);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** An em dash, the site's "no value" mark — see the `td('—')` calls. */
export const NO_VALUE = '—';

/**
 * Format a timestamp for display, or `—` when it is missing or unparseable.
 * Never returns the string "Invalid Date".
 */
export function formatTimestamp(value: string | null | undefined): string {
  const date = parseTimestamp(value);
  return date ? date.toLocaleString() : NO_VALUE;
}
