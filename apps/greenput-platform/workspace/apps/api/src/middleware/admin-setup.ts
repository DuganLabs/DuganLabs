import type { IRequest } from 'itty-router';
import type { Env } from '../env';
import { error } from '../lib/response';
import { timingSafeEqual } from '../lib/timing-safe';

/**
 * Header carrying the bootstrap secret for POST /api/admin/auth/setup.
 *
 * A header, not a body field: the body is parsed by `validate(AdminSetupSchema)`
 * and the gate has to run before anything reads, parses or stores caller input.
 */
export const ADMIN_SETUP_TOKEN_HEADER = 'X-Admin-Setup-Token';

/**
 * Shortest `ADMIN_SETUP_TOKEN` this gate will honour. A four-character secret
 * is not a gate, and a misconfiguration that silently weakens a bootstrap route
 * is exactly the failure this middleware exists to prevent — so a token shorter
 * than this is treated as no token at all.
 */
export const ADMIN_SETUP_TOKEN_MIN_LENGTH = 32;

/**
 * Proof-of-operator gate for platform-admin bootstrap.
 *
 * `POST /api/admin/auth/setup` mints a platform admin and a `gp_admin_session`
 * cookie. Its only guard used to be "no admin row exists yet", which on any
 * freshly provisioned environment — staging, preview — meant *whoever arrived
 * first* on a public hostname became platform admin. Production was closed only
 * by the accident that a row happened to already be there.
 *
 * Now the route answers only to a caller holding `ADMIN_SETUP_TOKEN`, which
 * reaches the Worker as a Worker secret pushed by the pipeline from a GitHub
 * Actions secret of the same name (see the "Push Cloudflare Worker secrets"
 * steps in .github/workflows/ci.yml). The org keeps secrets in Doppler as a
 * rule, but Doppler is not wired into this repo, so this one is a repository
 * secret until it is. That inverts
 * the default: an environment nobody has deliberately provisioned a bootstrap
 * secret for — every preview Worker, and staging until someone sets it — has no
 * bootstrap route at all.
 *
 * Both failures (no usable secret configured, wrong secret presented) return
 * the byte-identical 404 the top-level router returns for a path that was never
 * mounted, and both do the same HMAC work, so neither the response nor its
 * timing reveals whether the route is live on this host.
 */
export async function requireAdminSetupToken(
  req: IRequest,
  env: Env,
): Promise<Response | void> {
  // `typeof`, not `?? ''`: a non-string binding (a plain `[vars]` entry holding
  // a number, say) would otherwise have an `undefined` .length, and
  // `undefined < 32` is false — which would wave the length check through.
  const configured =
    typeof env.ADMIN_SETUP_TOKEN === 'string' ? env.ADMIN_SETUP_TOKEN : '';
  const presented = req.headers.get(ADMIN_SETUP_TOKEN_HEADER) ?? '';

  // Always compared, even when there is nothing usable to compare against, so
  // a disabled route and a wrong token cost the same.
  const matches = await timingSafeEqual(configured, presented);

  if (configured.length < ADMIN_SETUP_TOKEN_MIN_LENGTH || !matches) {
    return error('Not found', 404, 'NOT_FOUND');
  }
}
