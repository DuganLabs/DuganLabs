/**
 * `workspaces.trade` → the label a homeowner reads.
 *
 * Lifted verbatim out of `apps/tenant-site/src/render.ts`, which still
 * re-exports it so every existing import site and its tests are unchanged. It
 * moved because it now has a second consumer: the share card rendered by
 * `apps/api` prints the trade under the business name, and the micro-site's
 * `og:image` URL is versioned by a hash over exactly the strings the card
 * draws. Two copies of this mapping would mean the version the micro-site
 * advertises and the card the API draws could disagree about the word "HVAC"
 * — and the disagreement would be invisible, because each side's tests would
 * pass against its own copy.
 */

const KNOWN_TRADE_LABELS: Record<string, string> = {
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  hvac: 'HVAC',
  roofing: 'Roofing',
  solar: 'Solar',
  landscaping: 'Landscaping',
  painting: 'Painting',
  general: 'General Contracting',
  handyman: 'Handyman',
  pest_control: 'Pest Control',
  drain_cleaning: 'Drain Cleaning',
};

/**
 * `workspaces.trade` is free text (default 'electrical'), so it arrives as
 * whatever the owner typed — usually a lowercase slug. Map known slugs to a
 * proper display label; anything already cased (e.g. "HVAC", "Reed's Co")
 * passes through untouched rather than risk mangling it.
 */
export function displayTrade(trade: string): string {
  const key = trade.trim().toLowerCase();
  if (KNOWN_TRADE_LABELS[key]) return KNOWN_TRADE_LABELS[key];
  if (trade === key && trade.length > 0) {
    return trade.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return trade;
}
