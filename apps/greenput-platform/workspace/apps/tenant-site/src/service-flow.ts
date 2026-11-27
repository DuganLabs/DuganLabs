/**
 * Which published quote flow, if any, a Services-page card prices.
 *
 * The Services page lists free-text `leads.service_type` names ("EV Charger
 * Installation", "Panel Upgrade", sometimes a raw vertical like
 * "ev_charger"); quote flows are keyed by slug and vertical. They share no
 * id, so this maps by name. It is deliberately conservative: a card that
 * maps starts that flow in one click, so a wrong match would put a homeowner
 * in the wrong questions. Anything unmatched falls back to the /quote picker.
 *
 * Only flows the tenant actually publishes are candidates — a match can never
 * point at a flow /quote/start would 404.
 */
export interface FlowKey {
  slug: string;
  name: string;
  vertical: string;
}

/** Words that, in a service name, mean this vertical's flow. */
const VERTICAL_PATTERNS: Record<string, RegExp> = {
  ev_charger: /\bev\b|\bcharg(er|ing)\b|wall connector/,
  panel_service: /\bpanel (upgrade|replacement|service)\b|\bservice upgrade\b/,
  circuits: /\b(outlet|receptacle|circuit)s?\b/,
  surge_protection: /\bsurge\b/,
  troubleshooting: /\btroubleshoot(ing)?\b|\bcall[- ]?out\b/,
};

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9& ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function flowForService<F extends FlowKey>(
  service: string,
  flows: readonly F[],
): F | null {
  const s = norm(service);
  if (!s) return null;

  // Exact identifiers first: a slug, a vertical, or the flow's own name.
  const exact = flows.find(
    (f) => s === norm(f.slug) || s === norm(f.vertical) || s === norm(f.name),
  );
  if (exact) return exact;

  // Then the vertical's own words — and only when exactly one vertical
  // claims the name, so "EV charger circuit" is not guessed at.
  const hits = flows.filter((f) => VERTICAL_PATTERNS[f.vertical]?.test(s));
  const verticals = new Set(hits.map((f) => f.vertical));
  if (verticals.size !== 1) return null;
  // A tenant may publish more than one flow per vertical; only an
  // unambiguous one is safe to start without asking.
  return hits.length === 1 ? hits[0] : null;
}
