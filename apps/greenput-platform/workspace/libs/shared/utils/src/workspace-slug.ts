import { generateSlug } from './slug';

/**
 * Subdomains of `greenput.com` that `apps/tenant-site` must refuse to resolve
 * as a tenant.
 *
 * This is the Worker's refusal list, nothing more. It is deliberately NOT the
 * list of slugs allocation may hand out — see `UNAVAILABLE_WORKSPACE_SLUGS`.
 * The two are different sets and conflating them breaks a live site: `demo` is
 * a real tenant (`demo.greenput.com`, seeded by CI), so adding `demo` here
 * would 404 the only tenant micro-site that resolves today, while `demo` still
 * must never be handed to a contractor.
 *
 * `fallback` is the Cloudflare for SaaS fallback origin every contractor custom
 * domain CNAMEs at (see apps/api/src/lib/cloudflare-saas.ts).
 */
export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  'api',
  'app',
  'admin',
  'www',
  'mail',
  'staging',
  'marketing',
  'fallback',
  // Greenput's own name. Never a tenant hostname: since #147 the tenant Worker
  // holds *.greenput.com, so a workspace that somehow carried this slug would
  // serve greenput.greenput.com as a contractor micro-site. UNAVAILABLE_
  // WORKSPACE_SLUGS below already refuses to ALLOCATE it; this refuses to
  // RESOLVE it (GP-005).
  'greenput',
  // brand.greenput.com — apps/brand-assets, the Worker that draws every
  // tenant's share card and mark (GP-108). Bound as a Custom Domain plus an
  // exact route, so the tenant wildcard never sees it; reserved here so no
  // contractor is handed the slug either.
  'brand',
]);

/**
 * Every slug allocation must never hand to a new workspace: the hostnames
 * infrastructure owns, plus the names the platform has already spoken for.
 *
 * A superset of `RESERVED_SUBDOMAINS`:
 * - `demo` is Greenput's showcase tenant. It IS a workspace (slug `demo` on
 *   both live databases, seeded by .github/workflows/ci.yml) and it is the one
 *   tenant hostname bound in apps/tenant-site/wrangler.toml, so the Worker must
 *   keep resolving it — but a contractor named "Demo Electric" must not be able
 *   to claim it. Before this list existed, `workspaceSlugCandidates('Demo', id)`
 *   offered the bare `demo` and only a SELECT stood in the way.
 * - `greenput` is what apps/tenant-site derives as the slug for a request to
 *   `greenput.com` / `greenput.site` (it takes `hostname.split('.')[0]` for any
 *   host that is not `*.workers.dev`). Marketing owns that host today, so it is
 *   unreachable — but the platform owns the name either way.
 */
export const UNAVAILABLE_WORKSPACE_SLUGS: ReadonlySet<string> = new Set([
  ...RESERVED_SUBDOMAINS,
  'demo',
  'greenput',
]);

/**
 * Longest slug we will derive from a company name, before any uniqueness
 * suffix. A DNS label allows 63 characters; this leaves room for the suffix
 * and keeps `<slug>.greenput.com` short enough to say out loud.
 */
export const MAX_WORKSPACE_SLUG_BASE = 40;

/**
 * Shortest slug we will hand out bare. One and two-character labels are the
 * ones most likely to be wanted later for infrastructure, so a company whose
 * name slugifies that short gets a suffix instead of the bare label.
 */
export const MIN_WORKSPACE_SLUG_BASE = 3;

/**
 * Stand-in prefix for a company name that has nothing slug-able in it at all —
 * punctuation only, or a name written entirely in a script this file does not
 * transliterate. Always used with a uniqueness suffix, never bare.
 */
export const WORKSPACE_SLUG_FALLBACK_BASE = 'site';

/** Is this slug one of the subdomains `apps/tenant-site` refuses to resolve? */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SUBDOMAINS.has(slug.trim().toLowerCase());
}

/** Is this slug one allocation must never hand to a new workspace? */
export function isWorkspaceSlugUnavailable(slug: string): boolean {
  return UNAVAILABLE_WORKSPACE_SLUGS.has(slug.trim().toLowerCase());
}

/**
 * Characters deleted outright rather than turned into a word boundary.
 *
 * Apostrophes are the whole point. `generateSlug` maps every non-alphanumeric
 * run to a hyphen, so "Bob's Plumbing" became `bob-s-plumbing` and
 * "O’Brien Electric" became `o-brien-electric` — the curly form is the default
 * on every iOS and macOS keyboard, so this is the common case for a company
 * name, not an exotic one. Deleted, they give `bobs-plumbing` and
 * `obrien-electric`.
 *
 * ™ ® © and ℠ are deleted for a different reason: NFKD expands ™ to the letters
 * "TM", which would otherwise weld itself onto the company name
 * ("Acme™ Electric" -> `acmetm-electric`).
 */
const DELETED_CHARACTERS = /['‘’‛ʼʹ´`′™®©℠]/g;

/**
 * Letters NFKD cannot decompose to ASCII, because they are not accented ASCII —
 * they are their own letters. Without these, "Müller" folds fine (ü -> u + ¨)
 * but "Blåbær Strøm" loses two letters entirely.
 */
const TRANSLITERATIONS: ReadonlyMap<string, string> = new Map(
  Object.entries({
    ß: 'ss',
    ẛ: 's',
    æ: 'ae',
    Æ: 'ae',
    œ: 'oe',
    Œ: 'oe',
    ø: 'o',
    Ø: 'o',
    đ: 'd',
    Đ: 'd',
    ð: 'd',
    Ð: 'd',
    þ: 'th',
    Þ: 'th',
    ł: 'l',
    Ł: 'l',
    ħ: 'h',
    Ħ: 'h',
    ŧ: 't',
    Ŧ: 't',
    ı: 'i',
    İ: 'i',
    ŋ: 'ng',
    Ŋ: 'ng',
    ə: 'e',
    Ə: 'e',
  }),
);

/**
 * Fold a company name to ASCII before slugifying it.
 *
 * Everything here exists because the un-folded path quietly destroyed ordinary
 * names: an accent, a curly apostrophe, an en dash or a ™ was enough to turn a
 * perfectly normal company into an unrecognisable slug. It is deliberately
 * conservative — a name in a script it cannot transliterate (Cyrillic, Greek,
 * CJK, Arabic) is left to `generateSlug`, which strips it, and the caller falls
 * back to `site-<suffix>`. Transliterating those scripts would invent a name
 * the contractor never chose, and would open a homoglyph route to a reserved
 * label.
 */
function foldToAscii(name: string): string {
  const deleted = name.replace(DELETED_CHARACTERS, '');
  const transliterated = Array.from(deleted)
    .map((ch) => TRANSLITERATIONS.get(ch) ?? ch)
    .join('');
  // NFKD splits "é" into "e" + U+0301; \p{M} then drops the mark. It also
  // normalises fullwidth and small-cap forms to plain ASCII, which is why
  // "ＡＰＩ" folds to "api" and is caught by the reserved check below rather
  // than sneaking past it.
  return transliterated.normalize('NFKD').replace(/\p{M}+/gu, '');
}

/**
 * The name-derived part of a workspace slug: lowercase ASCII, hyphenated, no
 * leading or trailing hyphen, at most `MAX_WORKSPACE_SLUG_BASE` characters.
 * Returns `''` for a name that has nothing slug-able in it.
 */
export function workspaceSlugBase(name: string): string {
  const base = generateSlug(foldToAscii(name));
  if (base.length <= MAX_WORKSPACE_SLUG_BASE) return base;
  // `generateSlug` collapses runs of non-alphanumerics, so the truncated head
  // can end in at most one hyphen.
  return base.slice(0, MAX_WORKSPACE_SLUG_BASE).replace(/-+$/, '');
}

/**
 * Deterministic uniqueness suffixes for a workspace, taken from its id.
 *
 * Derived from the id rather than from a counter over existing slugs on
 * purpose: counting is a read-then-write, and two contractors registering the
 * same company name at the same moment both read the same count. The id is
 * already unique and already generated before the insert, so a suffix cut from
 * it collides only if the ids collide.
 */
function suffixesFrom(id: string): string[] {
  const hex = id.toLowerCase().replace(/[^a-z0-9]/g, '');
  const suffixes: string[] = [];
  for (let i = 0; i + 6 <= hex.length && suffixes.length < 4; i += 6) {
    suffixes.push(hex.slice(i, i + 6));
  }
  // A caller that passes something shorter than one suffix (a test fixture id,
  // say) still gets one candidate rather than none.
  if (suffixes.length === 0) suffixes.push(hex.length > 0 ? hex : 'x');
  return suffixes;
}

/**
 * Every slug `/api/auth/register` may give a new workspace, best first.
 *
 * The caller tries them in order and lets the database arbitrate: a slug is
 * taken when the unique index on `workspaces.slug` says so, not when a SELECT a
 * moment earlier said so. That index is
 * `idx_workspaces_slug_unique` — a partial UNIQUE index created by
 * migrations/015-workspaces-slug-unique.sql and declared in schema.sql, NOT the
 * column-level `UNIQUE` a `CREATE TABLE` would give. The live databases got
 * `slug` from `ALTER TABLE workspaces ADD COLUMN slug TEXT`
 * (migrations/001-workspaces-slug.sql) and SQLite cannot attach a UNIQUE
 * constraint that way, so an index is the only form of the guarantee that a
 * long-lived database can actually be given.
 *
 * Guarantees about the returned list:
 * - never empty;
 * - every entry satisfies `isValidSlug`;
 * - no entry is in `UNAVAILABLE_WORKSPACE_SLUGS` (a bare base that is
 *   unavailable is skipped, and every suffixed candidate contains a hyphen,
 *   which no unavailable name does);
 * - entries are distinct.
 */
export function workspaceSlugCandidates(name: string, id: string): string[] {
  const base = workspaceSlugBase(name);
  const prefix = base.length > 0 ? base : WORKSPACE_SLUG_FALLBACK_BASE;
  const bareIsUsable =
    base.length >= MIN_WORKSPACE_SLUG_BASE && !isWorkspaceSlugUnavailable(base);

  const candidates = bareIsUsable ? [base] : [];
  for (const suffix of suffixesFrom(id)) {
    const candidate = `${prefix}-${suffix}`;
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}
