import type { CatalogEntry, RateCard } from './types.ts';

/**
 * Read a dotted path out of a rate card.
 *
 * A rate-card leaf is either a bare value or a `{value, note, placeholder, …}`
 * wrapper carrying provenance, and a path may pass through either form — so at
 * every step this looks for the key directly, then inside a `value` object, and
 * unwraps a `{value}` wrapper at the end. Returns `undefined` for a path that
 * does not resolve, which is what the validator checks for.
 */
export function rcGet(rc: RateCard, path: string): unknown {
  let node: unknown = rc;
  for (const p of path.split('.')) {
    if (node == null) return undefined;
    const obj = node as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(obj, p)) {
      node = obj[p];
      continue;
    }
    const wrapped = obj['value'];
    if (
      wrapped &&
      typeof wrapped === 'object' &&
      Object.prototype.hasOwnProperty.call(wrapped, p)
    ) {
      node = (wrapped as Record<string, unknown>)[p];
      continue;
    }
    return undefined;
  }
  if (
    node &&
    typeof node === 'object' &&
    !Array.isArray(node) &&
    'value' in (node as Record<string, unknown>)
  ) {
    return (node as Record<string, unknown>)['value'];
  }
  return node;
}

/** A parts-list entry by key. `undefined` when the key is not in the catalog. */
export function catGet(rc: RateCard, key: string): CatalogEntry | undefined {
  return rc.materials.catalog[key];
}

/** `rcGet` coerced to a number — every numeric rate-card read goes through this. */
export function rcNum(rc: RateCard, path: string): number {
  return Number(rcGet(rc, path));
}
