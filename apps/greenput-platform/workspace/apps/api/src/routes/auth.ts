import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import {
  json,
  error,
  unauthorized,
  newId,
  buildSessionCookie,
} from '../lib/response';
import { createSession, revokeSession } from '../lib/session';
import { NO_PASSWORD } from '../lib/password';
import { computeTrialEndsAt } from '../lib/billing';
import { validate } from '../middleware/validate';
import { RegisterSchema } from '@greenput/shared/validators';
import { DEFAULT_BRAND_PRIMARY_COLOR } from '@greenput/shared/models';
import { toE164, workspaceSlugCandidates } from '@greenput/shared/utils';
import { brandAssetUrls, generatedIdentityFor } from '@greenput/shared/design';
import { GRANDFATHERED_LEAD_FEE_USD } from '../lib/lead-rate-card';

export const authRouter = Router({ base: '/api/auth' });

// POST /api/auth/login is GONE. Sign-in is passkeys only.
//
// `/login` in apps/platform has been passkey-only for some time, but this
// endpoint still accepted an email and a password and still minted a session,
// so the product had a second front door that nothing in the product opened.
// It also carried a rehash-on-success path, which meant a legacy plaintext
// password in the column kept working and quietly upgraded itself instead of
// failing — which is how a legacy cleartext credential stayed live months
// after it was set.
//
// The way back in when no passkey works is `/api/auth/otp/*` (§6.1) — a code
// to the owner's personal recovery number — not a password. Removing this
// deletes the only guessable credential in the system, which is also why
// there is no longer anything for a password-login throttle to protect.
//
// `users.password_hash` stays as a NOT NULL column holding the NO_PASSWORD
// sentinel: dropping a NOT NULL column from a live SQLite table is a
// table rebuild, and an empty column costs nothing. `verifyPassword` stays in
// lib/password.ts with its fail-closed test, unreferenced by any route, so
// that if a password path is ever reintroduced it starts from the safe
// version rather than a fresh one.

authRouter.post('/logout', async (req: IRequest, env: Env) => {
  const cookieHeader = req.headers.get('cookie') ?? '';
  const sessionToken = getCookieValue(cookieHeader, 'gp_session');

  // revokeSession, not a bare delete. Deleting the record is not final on its
  // own — a sliding renewal already in flight writes it straight back, cookie
  // and all — so revocation gets a tombstone that every read outranks the
  // record with. See apps/api/src/lib/session.ts.
  const revoked = sessionToken ? await revokeSession(env, sessionToken) : true;

  const headers = new Headers({ 'Content-Type': 'application/json' });
  // Clear the browser's copy either way: it is the half we can always reach.
  headers.append('Set-Cookie', buildSessionCookie('', env, 0));

  if (!revoked) {
    // The tombstone did not land, so the token is still live for anyone holding
    // it — a renewal already in flight will write the record back and re-issue
    // a working cookie, and nothing outranks it. Saying "signed out" here would
    // be the one lie logout must never tell. The client clears local state
    // regardless.
    return new Response(
      JSON.stringify({
        error: {
          code: 'LOGOUT_INCOMPLETE',
          message: 'Could not revoke the session. Please try again.',
        },
      }),
      { status: 503, headers },
    );
  }

  return new Response(JSON.stringify({ data: { ok: true } }), {
    status: 200,
    headers,
  });
});

authRouter.get('/me', async (req: IRequest, env: Env) => {
  const user = (req as any).user;
  if (!user) return unauthorized();
  return json({ data: { user } });
});

// POST /api/auth/register — Create workspace + owner account
authRouter.post(
  '/register',
  validate(RegisterSchema),
  async (req: IRequest, env: Env) => {
    const body = (req as any).validatedBody as {
      firstName: string;
      lastName: string;
      email: string;
      password?: string;
      workspaceName: string;
      trade: string;
      phone: string;
      street: string;
      city: string;
      state: string;
      zip: string;
      serviceTypes: string[];
      serviceArea: string;
      serviceRadiusMiles?: number;
      brandColor?: string;
      logoUrl?: string;
    };

    // Check if email is already taken
    const existingUser = await env.DB.prepare(
      'SELECT id FROM users WHERE email = ?',
    )
      .bind(body.email.toLowerCase().trim())
      .first();

    if (existingUser) {
      return error(
        'An account with this email already exists',
        409,
        'DUPLICATE',
      );
    }

    const now = new Date().toISOString();
    const workspaceId = newId();
    const userId = newId();
    // Passwordless signup stores NO_PASSWORD, not NULL: the live `users` table
    // declares `password_hash TEXT NOT NULL`, so NULL fails the insert and the
    // whole request 500s — which is exactly what it did in production. The
    // other two account-creation paths (otp.ts, workspace.ts) already wrote
    // the empty sentinel; this one did not. verifyPassword fails closed on it.
    // Always the sentinel. Sign-in is passkeys only (see the note where
    // POST /login used to be), so a password collected here would be a
    // credential nothing can ever present — and the one thing an attacker
    // could guess.
    const passwordHash = NO_PASSWORD;

    // Normalise the company phone to E.164 at the point it is STORED, not
    // only at the point something reads it. This route used to write the
    // number exactly as typed — "9495550187" — while every lookup normalised
    // first, so the two spellings of one number never met.
    //
    // A number we cannot normalise is kept verbatim rather than discarded:
    // `workspaces.phone` is a display field (micro-site, estimates), and
    // losing what the contractor typed is worse than storing it unnormalised.
    // migrations/012 applies the same rule to the rows written before this.
    const workspacePhone = toE164(body.phone) ?? body.phone.trim();

    // The whole service list, not its first entry (GP-039). The wizard's
    // "pick all that apply" grid used to reach this route as one string —
    // `trade: serviceTypes[0]` — and a contractor who does HVAC and plumbing
    // is the normal case. `trade` stays the first entry, because
    // apps/tenant-site and the brand card still read one string; it leads the
    // list even when a caller sends it and lists it later, so the two columns
    // can never disagree about what the contractor does first.
    const serviceTypes = [
      body.trade,
      ...body.serviceTypes.filter((service) => service !== body.trade),
    ];
    // NULL, not '', for the two the contractor did not give: the columns are
    // nullable and the API omits an absent value rather than inventing one.
    const serviceArea = body.serviceArea.trim() || null;
    const serviceRadiusMiles = body.serviceRadiusMiles ?? null;

    // Create workspace with a fresh 14-day trial.
    //
    // All four writes go through a single D1 batch, which runs as one
    // transaction. Previously they were three separate .run() calls: when the
    // users insert failed, the workspace insert had already committed, so every
    // failed signup leaked an orphan workspace row with no owner. Production
    // accumulated one per attempt.
    const trialEndsAt = computeTrialEndsAt(new Date(now));
    const brandingId = newId();

    const signupBatch = (slug: string) => [
      env.DB.prepare(
        `INSERT INTO workspaces (
           id, name, slug, trade, phone, email,
           street, city, state, zip,
           service_area, service_radius_miles, service_types,
           billing_status, trial_started_at, trial_ends_at,
           lead_fee_override_usd, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'trialing', ?, ?, ?, ?)`,
      ).bind(
        workspaceId,
        body.workspaceName,
        slug,
        body.trade,
        workspacePhone,
        body.email.toLowerCase().trim(),
        body.street,
        body.city,
        body.state,
        body.zip,
        serviceArea,
        serviceRadiusMiles,
        JSON.stringify(serviceTypes),
        now,
        trialEndsAt,
        // Grandfathered pilot rate, recorded on the row so a later edit
        // of the slug map does not silently reprice this workspace.
        // Null for everyone else — they pay the rate card.
        GRANDFATHERED_LEAD_FEE_USD[slug] ?? null,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'owner', ?, ?, ?)`,
      ).bind(
        userId,
        workspaceId,
        body.firstName,
        body.lastName,
        body.email.toLowerCase().trim(),
        passwordHash,
        now,
        now,
      ),
      env.DB.prepare(
        `INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
         VALUES (?, ?, ?, 'workspace', ?, 'created', ?)`,
      ).bind(newId(), workspaceId, userId, workspaceId, now),
      // The brand colour and logo go to `branding` — the table the micro-site
      // and Settings → Branding already read — and they go in THIS batch. The
      // wizard collected a colour and wrote nothing, so Settings showed the
      // schema default instead of the green the contractor picked (GP-039).
      // A separate write after the batch would reintroduce exactly the
      // half-signup this batch exists to prevent (see the reasoning in
      // otp.ts): a failure between the two would leave a workspace with no
      // branding row and no way to tell it from one that never chose. The
      // other colours and the font take the table's defaults; `logo_url` is
      // `branding.logo_url`, not `workspaces.logo_url`, which stays NULL (see
      // the note above `brandIdentity` below).
      env.DB.prepare(
        `INSERT INTO branding (id, workspace_id, logo_url, primary_color, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        brandingId,
        workspaceId,
        body.logoUrl ?? null,
        body.brandColor ?? DEFAULT_BRAND_PRIMARY_COLOR,
        now,
      ),
    ];

    // The workspace gets its slug here, at creation, because no other code path
    // writes `workspaces.slug`: a workspace created through the product carried
    // slug NULL, and the tenant lookups key on it — apps/tenant-site resolves a
    // tenant by `WHERE slug = ?` and `/api/public/workspace/:slug` serves the
    // public JSON.
    //
    // SCOPE, because the column is not the whole story: a slug does NOT yet
    // give the contractor a reachable site. `*.greenput.com` is NXDOMAIN and
    // apps/tenant-site/wrangler.toml binds exactly one tenant hostname
    // (demo.greenput.com), so `<slug>.greenput.com` resolves nowhere until a
    // wildcard DNS record and a wildcard route exist. What works today is
    // `/api/public/workspace/<slug>` and `?slug=<slug>` against the tenant
    // Worker. See CLAUDE.md §4.2.
    //
    // Uniqueness is decided by the database, not by the SELECT below: the
    // candidate that inserts is the one that was actually free at the instant it
    // was written. The enforcement is `idx_workspaces_slug_unique`, the partial
    // UNIQUE index from migrations/015-workspaces-slug-unique.sql — NOT a
    // column-level UNIQUE, which the live databases cannot have because `slug`
    // arrived by ALTER TABLE ADD COLUMN. Trusting the SELECT instead would leave
    // a window in which two simultaneous "Acme Electric" signups both saw the
    // bare slug as free and the second one 500'd; here both succeed — one takes
    // `acme-electric`, the other the next candidate.
    //
    // Retrying the whole batch is safe because D1 runs a batch in a transaction
    // — a rejected insert commits nothing, so there is no half-written workspace
    // to clean up before the next attempt.
    const slugCandidates = workspaceSlugCandidates(
      body.workspaceName,
      workspaceId,
    );

    // Drop the candidates that are already taken in one query, so the ordinary
    // case — a company name some earlier contractor already used — costs one
    // extra SELECT and never depends on being able to read a constraint error.
    // This is a filter, not the decision: it can be stale by the time the
    // insert runs, which is what the retry below is for.
    const takenRows = await env.DB.prepare(
      `SELECT slug FROM workspaces WHERE slug IN (${slugCandidates
        .map(() => '?')
        .join(', ')})`,
    )
      .bind(...slugCandidates)
      .all<{ slug: string }>();
    const taken = new Set((takenRows.results ?? []).map((row) => row.slug));
    const attempts = slugCandidates.filter(
      (candidate) => !taken.has(candidate),
    );

    let slug: string | null = null;
    for (const candidate of attempts) {
      try {
        await env.DB.batch(signupBatch(candidate));
        slug = candidate;
        break;
      } catch (err) {
        if (!isSlugTaken(err)) throw err;
      }
    }

    if (slug === null) {
      // Every candidate was taken. The suffixes come from the workspace's
      // freshly generated UUID, so this needs four independent collisions
      // against slugs that already exist — report it rather than pretend.
      return error(
        'Could not assign a site address for this company name. Please try a slightly different name.',
        409,
        'SLUG_UNAVAILABLE',
      );
    }

    // ── The generated logo ────────────────────────────────────────────────
    //
    // This is the moment a contractor's mark exists, and it is minted WITHOUT
    // writing a logo: `workspaces.logo_url` is left NULL, and the mark is
    // derived from the two fields the row above already carries.
    //
    //   colour  ← `slug`, allocated a few lines up and never rewritten by any
    //             code path in this repo. So the colourway is fixed at signup,
    //             exactly as a stored column would fix it, and a contractor who
    //             renames their business keeps the mark that is already on the
    //             cards people have shared.
    //   letters ← `name`. They have to follow a rename; they ARE the name.
    //
    // Why not store it. `logo_url` carries one bit that nothing else in this
    // codebase carries: whether the contractor gave us an image. Six call sites
    // branch on it — the micro-site nav, hero and about block, the invoice PDF,
    // the LocalBusiness JSON-LD, `GET /api/workspace`. Writing a generated URL
    // into it would answer "yes" to all of them and there would be no way back:
    // "generated must never overwrite uploaded" stops being a rule anyone can
    // break and becomes a string-prefix test on a URL, forever. It would also
    // be blocked in the browser on every micro-site page view, because
    // apps/tenant-site sends `img-src 'self' data:`.
    //
    // The cost a stored column would have bought off is invalidation on rename,
    // and seeding the colour on the slug buys that off instead — for free, and
    // with no migration for the rows that already exist. The two brand-asset
    // URLs below are addressable from the moment this row is committed; nothing
    // has to be backfilled for an existing workspace either.
    const brandIdentity = generatedIdentityFor({
      name: body.workspaceName,
      slug,
    });
    // The brand Worker's origin, from a var: since GP-108 these two URLs are
    // answered by apps/brand-assets at brand.greenput.com, not by this Worker.
    // Staging and preview leave it empty and the response omits the URLs.
    const brandAssets = brandAssetUrls(env.BRAND_ORIGIN, {
      name: body.workspaceName,
      slug,
      trade: body.trade,
      city: body.city,
      state: body.state,
      logo_url: null,
    });

    // Create session
    const session = await createSession(env, {
      id: userId,
      workspaceId,
      email: body.email.toLowerCase().trim(),
      role: 'owner',
      firstName: body.firstName,
      lastName: body.lastName,
    });

    const response = json(
      {
        data: {
          user: {
            id: userId,
            email: body.email.toLowerCase().trim(),
            firstName: body.firstName,
            lastName: body.lastName,
            role: 'owner',
          },
          workspace: {
            id: workspaceId,
            name: body.workspaceName,
            slug,
            // The generated identity this signup just minted. `logo_url` stays
            // NULL — see the note above `brandIdentity`.
            logo: {
              generated: true,
              initials: brandIdentity.initials,
              color: brandIdentity.variant.bg,
              onColor: brandIdentity.variant.fg,
              ...(brandAssets
                ? { markUrl: brandAssets.markUrl, cardUrl: brandAssets.cardUrl }
                : {}),
            },
          },
        },
      },
      201,
    );

    const headers = new Headers(response.headers);
    headers.append('Set-Cookie', session.cookie);

    return new Response(response.body, { status: 201, headers });
  },
);

/**
 * Did this write fail because the slug was already taken, as opposed to any
 * other constraint?
 *
 * Only a `workspaces.slug` conflict may be retried with a different slug. A
 * `users.email` conflict, say, means the caller is racing another signup for
 * the same account and must surface, not silently retry under a new slug.
 *
 * SQLite names the column for a UNIQUE index over plain columns, partial or not
 * — verified on the exact DDL migrations/015 installs, where the message is
 * `UNIQUE constraint failed: workspaces.slug` and not the index name. The index
 * name is accepted as well, because a version that reports the index instead
 * would otherwise turn a retryable collision into a 500, and nothing but a slug
 * conflict can name that index.
 */
function isSlugTaken(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /unique constraint failed/i.test(message) &&
    (/workspaces\.slug/i.test(message) ||
      /idx_workspaces_slug_unique/i.test(message))
  );
}

function getCookieValue(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
