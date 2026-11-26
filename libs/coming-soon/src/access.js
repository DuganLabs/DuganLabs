// Private area guard. Production: Cloudflare Access sits in front of
// /app/* (infra/cloudflare/access.tf) and signs every request it lets
// through. We still verify that JWT here (defense in depth: a route or
// Access-policy mistake must not open the leads view), and we check the
// email against OWNER_EMAILS. Missing config fails closed.
const enc = new TextEncoder();
const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (c) => c.charCodeAt(0));
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);

let jwksCache = { at: 0, keys: null, team: '' };
async function jwks(team, fetchImpl) {
  if (jwksCache.keys && jwksCache.team === team && Date.now() - jwksCache.at < 10 * 60 * 1000) return jwksCache.keys;
  const r = await fetchImpl(`https://${team}/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error('certs ' + r.status);
  const { keys } = await r.json();
  jwksCache = { at: Date.now(), keys, team };
  return keys;
}

export async function verifyAccessJwt(token, { team, aud, now = Date.now(), fetchImpl = fetch }) {
  const [h, p, s] = String(token).split('.');
  if (!h || !p || !s) return null;
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
  if (header.alg !== 'RS256') return null;
  const jwk = (await jwks(team, fetchImpl)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), enc.encode(`${h}.${p}`));
  if (!ok) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;
  if (payload.iss !== `https://${team}`) return null;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 < now) return null;
  return payload;
}

/** Returns { email } or { deny: reason }. */
export async function requireOwner(request, env) {
  const url = new URL(request.url);
  const owners = String(env.OWNER_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  // Local development only: wrangler dev on localhost with DEV_ACCESS_EMAIL
  // in .dev.vars. Never honoured on a real hostname.
  if (LOCAL.has(url.hostname) && env.DEV_ACCESS_EMAIL) return { email: env.DEV_ACCESS_EMAIL, dev: true };
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD || !owners.length) return { deny: 'not-configured' };
  const cookie = request.headers.get('cookie') ?? '';
  const token = request.headers.get('cf-access-jwt-assertion') ?? /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie)?.[1];
  if (!token) return { deny: 'no-token' };
  let claims = null;
  try { claims = await verifyAccessJwt(token, { team: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD }); } catch { claims = null; }
  if (!claims?.email) return { deny: 'bad-token' };
  if (!owners.includes(String(claims.email).toLowerCase())) return { deny: 'not-owner' };
  return { email: claims.email };
}
