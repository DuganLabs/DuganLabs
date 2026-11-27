// ─────────────────────────────────────────────────────────────
// Reading an estimate line item back out of `estimates.line_items`.
//
// Line items are stored as a JSON array, not a table, so nothing constrains
// their shape but the writer. Before `type` existed on the model, the
// platform's estimate editor smuggled the labor/material split into the
// description as a `[labor] ` / `[material] ` prefix, and the customer's
// proposal printed it verbatim (GP-038). Those rows are not migrated — the
// proposal a customer already opened must keep rendering the same text — so
// the ONE read path here lifts the prefix into `type` instead.
// ─────────────────────────────────────────────────────────────

import { ESTIMATE_LINE_ITEM_TYPES, type EstimateLineItemType } from './enums';
import type { EstimateLineItem } from './index';

/** A line item as it sits in the JSON column: `type` may be missing. */
export interface StoredEstimateLineItem {
  id?: string;
  type?: string;
  description?: string;
  quantity?: number;
  unitPrice?: number;
  total?: number;
}

const LEGACY_TYPE_PREFIX = /^\[(labor|material)\]\s*/;

function isLineItemType(value: unknown): value is EstimateLineItemType {
  return (ESTIMATE_LINE_ITEM_TYPES as readonly unknown[]).includes(value);
}

/**
 * One stored line item as the model declares it. A legacy `[labor] ` /
 * `[material] ` prefix is stripped from `description` and, when the row has
 * no `type` of its own, becomes it. A row with neither is labor.
 */
export function readEstimateLineItem(
  stored: StoredEstimateLineItem,
): EstimateLineItem {
  let description = String(stored.description ?? '');
  let type: EstimateLineItemType | undefined = isLineItemType(stored.type)
    ? stored.type
    : undefined;
  const legacy = LEGACY_TYPE_PREFIX.exec(description);
  if (legacy) {
    description = description.slice(legacy[0].length);
    type ??= legacy[1] as EstimateLineItemType;
  }
  return {
    ...(typeof stored.id === 'string' && stored.id ? { id: stored.id } : {}),
    type: type ?? 'labor',
    description,
    quantity: Number(stored.quantity) || 0,
    unitPrice: Number(stored.unitPrice) || 0,
    total: Number(stored.total) || 0,
  };
}

/**
 * The whole `line_items` column: the JSON text D1 hands back (or the array
 * once parsed), or `[]` for anything that is not a list of objects.
 */
export function readEstimateLineItems(column: unknown): EstimateLineItem[] {
  let parsed: unknown = column;
  if (typeof column === 'string') {
    try {
      parsed = JSON.parse(column);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (item): item is StoredEstimateLineItem =>
        typeof item === 'object' && item !== null,
    )
    .map(readEstimateLineItem);
}
