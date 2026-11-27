/**
 * Number formatting for a money instrument.
 *
 * The rules here are the code half of `docs/visual-language.md` §2.3. The
 * short version:
 *
 *  - **One precision per column, applied to every cell.** Decimal alignment in
 *    a right-aligned tabular column is a *consequence* of every cell carrying
 *    the same number of fraction digits — mixing `$8,000.00` and `$310,500`
 *    in one column cannot be aligned by any amount of CSS. Callers pick the
 *    precision once, per column, and use it for the nulls too.
 *  - **U+2212 MINUS SIGN, never HYPHEN-MINUS.** In tabular figures U+2212
 *    carries a full digit advance; `-` does not, so a hyphen shifts the cell
 *    sideways by a fraction of a digit and the column stops lining up.
 *  - **Nulls render as an em dash in the units position**, never blank and
 *    never `$0` — an unknown balance is not a zero balance.
 *  - **Sign is always rendered where direction is meaningful.** Colour is a
 *    second channel, never the only one (visual-language §3.4).
 */
import { NO_VALUE, parseTimestamp } from './dates.js';

/** U+2212 MINUS SIGN. Same advance width as a digit under `tabular-nums`. */
export const MINUS = '−';

/**
 * Placeholder for a missing figure. One em dash for the whole site — the
 * same mark `lib/dates.ts` falls back to, not a second copy of it.
 */
export const DASH = NO_VALUE;

function fixSign(text: string): string {
  return text.replace(/^-/, MINUS);
}

/**
 * Ledger currency. `dp` is the column's precision — 0 for balances and
 * principals (treasury scale, cents are noise at $612,400), 2 for the routing
 * waterfall (one specific transfer is being executed, so cents are the
 * instruction).
 */
export function usd(n: number | null | undefined, dp = 0): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return fixSign(
    n.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: dp,
      maximumFractionDigits: dp,
    }),
  );
}

/**
 * Currency with an explicit sign on both directions — for deltas, savings and
 * anything where the *direction* is the point. `+$4,900` / `−$18,420`.
 */
export function usdSigned(n: number | null | undefined, dp = 0): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  if (n === 0) return usd(0, dp);
  return (n > 0 ? '+' : '') + usd(n, dp);
}

/** Currency rendered as an amount owed: always negative-signed. */
export function usdOwed(n: number | null | undefined, dp = 0): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  if (n === 0) return usd(0, dp);
  return usd(-Math.abs(n), dp);
}

/**
 * A rate already expressed as a fraction (0.2449 → `24.49%`).
 *
 * APR defaults to 2 dp: 24.49% vs 24.00% changes avalanche ordering, and the
 * previous 1 dp rounded the decision variable away.
 */
export function pct(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return `${(n * 100).toFixed(dp)}%`;
}

/*
 * Both of the date helpers below parse through `lib/dates.ts`. They used to
 * carry a copy each of the normalisation — `iso.includes('T') || ...` — which
 * is the same defect `dates.ts` exists to end, one level up: a timestamp
 * shape the copy does not anticipate renders as "Invalid Date" in whichever
 * column happens to use that copy. `parseTimestamp` handles every shape the
 * API can hand back (bare SQLite, ISO with Z, ISO with an offset) and returns
 * null rather than an Invalid Date, so these two only decide how to *show* it.
 */

/** A short absolute date-time for a log column. */
export function stamp(iso: string | null | undefined): string {
  const d = parseTimestamp(iso);
  if (!d) return DASH;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Relative age of a sync timestamp, plus whether it should read as stale. */
export function age(iso: string | null | undefined): { text: string; stale: boolean } {
  const d = parseTimestamp(iso);
  if (!d) return { text: DASH, stale: false };
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60_000));
  if (mins < 60) return { text: `${mins}m ago`, stale: false };
  const hours = Math.round(mins / 60);
  if (hours < 24) return { text: `${hours}h ago`, stale: false };
  const days = Math.round(hours / 24);
  return { text: `${days}d ago`, stale: true };
}

/**
 * Clamp a value to the 0..1 fraction the CSS magnitude bars consume as `--v`.
 * A bar's length is the encoding; it is never also coloured by magnitude
 * (that would double-encode — see visual-language §5.8).
 */
export function fraction(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(1, Math.max(0, Math.abs(value) / max));
}
