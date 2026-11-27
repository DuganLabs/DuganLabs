// ─────────────────────────────────────────────────────────────
// The one seam between a D1 row and a response body.
//
// Every list and detail endpoint answers through `entity()` or `entityList()`
// below, which serialize through the wire contract in libs/shared/models. No
// route maps a column name itself, and no route hands out `rows.results`
// verbatim — which is what shipped snake_case, flat rows to a platform that
// reads camelCase, nested models and left /leads, /customers, /jobs and the
// dashboard broken in production.
//
// A route that needs to attach a second query's rows composes:
//
//   entity(WIRE_JOB, job, { lineItems: toWireList(WIRE_JOB_LINE_ITEM, items) })
//
// and `checkWire` knows about those keys (WireEntity.children), so the
// contract test validates them too.
// ─────────────────────────────────────────────────────────────

import {
  toWire,
  toWireList,
  type ShareLink,
  type ShareableResponse,
  type WireEntity,
  type WireRow,
} from '@greenput/shared/models';
import { json } from './response';

export { toWire, toWireList };

/**
 * `{ data: <model> }` for one row.
 *
 * A null row answers `{ data: null }`, which is exactly what the raw
 * `json({ data: row })` it replaces did. Callers reach here only after their
 * own 404 check, or with a row they just wrote, so it is not a real branch —
 * it is here so that adopting the serializer cannot turn a missing row into a
 * new 500.
 */
export function entity(
  spec: WireEntity,
  row: WireRow | null | undefined,
  extras: Record<string, unknown> = {},
  status = 200,
): Response {
  if (row === null || row === undefined) return json({ data: null }, status);
  return json(
    { data: { ...toWire<Record<string, unknown>>(spec, row), ...extras } },
    status,
  );
}

/**
 * `{ data: <model>, share }` — one row plus the link the contractor sends
 * themselves (GP-008). `share` is omitted, not nulled, when there is no
 * public address to build one on, so `ShareableResponse.share` is optional
 * and a reader that forgets to check it fails to type-check, not at runtime.
 */
export function entityShared(
  spec: WireEntity,
  row: WireRow | null | undefined,
  share: ShareLink | null | undefined,
  extras: Record<string, unknown> = {},
  status = 200,
): Response {
  if (row === null || row === undefined) return json({ data: null }, status);
  const body: ShareableResponse<Record<string, unknown>> = {
    data: { ...toWire<Record<string, unknown>>(spec, row), ...extras },
  };
  if (share) body.share = share;
  return json(body, status);
}

/** `{ data: <model>[], meta }` for a paginated list. */
export function entityList(
  spec: WireEntity,
  rows: readonly WireRow[] | undefined | null,
  meta: { total: number; page: number; perPage: number },
): Response {
  return json({ data: toWireList(spec, rows), meta });
}

/**
 * `{ data: <model>[] }` with no pagination envelope, for the endpoints that
 * return a whole small collection (workspace users, webhook list of one
 * workspace, notification preferences).
 */
export function entityArray(
  spec: WireEntity,
  rows: readonly WireRow[] | undefined | null,
): Response {
  return json({ data: toWireList(spec, rows) });
}
