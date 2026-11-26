// dl-leads: the one lead store behind every DuganLabs domain.
// It has NO public route (workers_dev = false, no routes): it is reachable
// only through the LEADS service binding of the site Workers, which set the
// source tag and client IP server-side.
//   POST /lead   { email, name?, interest?, consentVersion, token, siteKey, source, host, ip, ua }
//   GET  /leads?source=&q=&format=json|csv
const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const RATE_WINDOW_MIN = 10;
const RATE_MAX = 5;

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json' } });

async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Turnstile free plan: max 10 hostnames per widget, so sites are split across
// widgets (infra/cloudflare/turnstile.tf). TURNSTILE_SECRETS is a JSON map
// {"<sitekey>": "<secret>"}; the site Worker forwards its own sitekey
// server-side. TURNSTILE_SECRET_KEY (single secret) remains for local dev.
export function secretFor(env, siteKey) {
  if (env.TURNSTILE_SECRETS) {
    try {
      const m = JSON.parse(env.TURNSTILE_SECRETS);
      if (siteKey && typeof m[siteKey] === 'string') return m[siteKey];
    } catch { /* fall through: fail closed below */ }
  }
  return env.TURNSTILE_SECRET_KEY || '';
}

export async function verifyTurnstile(env, token, ip, fetchImpl = fetch, siteKey = '') {
  const secret = secretFor(env, siteKey);
  if (!secret) return false; // fail closed
  if (!token) return false;
  const body = new FormData();
  body.set('secret', secret);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);
  const r = await fetchImpl(SITEVERIFY, { method: 'POST', body });
  const j = await r.json().catch(() => ({}));
  return j.success === true;
}

async function addLead(request, env) {
  const b = await request.json().catch(() => null);
  if (!b || typeof b.email !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(b.source ?? '')) return json({ error: 'email' }, 400);
  if (!(await verifyTurnstile(env, b.token, b.ip, fetch, b.siteKey))) return json({ error: 'verify' }, 400);
  const ipHash = b.ip ? await sha256(`${env.IP_SALT ?? 'dl'}:${b.ip}`) : null;
  if (ipHash) {
    const { n } = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM leads WHERE ip_hash = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)`,
    ).bind(ipHash, `-${RATE_WINDOW_MIN} minutes`).first();
    if (n >= RATE_MAX) return json({ error: 'rate' }, 429);
  }
  // Duplicate (same email, same site) is a silent success: no enumeration.
  await env.DB.prepare(
    `INSERT INTO leads (email, name, interest, source, host, consent_version, ip_hash, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (email, source) DO NOTHING`,
  ).bind(b.email, b.name ?? null, b.interest ?? null, b.source, b.host ?? null, b.consentVersion || 'unknown', ipHash, b.ua ?? null).run();
  return json({ ok: true });
}

const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

async function listLeads(url, env) {
  const source = url.searchParams.get('source') || '';
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const where = [];
  const args = [];
  if (source) { where.push('source = ?'); args.push(source); }
  if (q) { where.push('(email LIKE ? OR lower(name) LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { results: leads } = await env.DB.prepare(
    `SELECT id, email, name, interest, source, host, created_at FROM leads ${w} ORDER BY created_at DESC LIMIT 500`,
  ).bind(...args).all();
  if (url.searchParams.get('format') === 'csv') {
    const head = 'email,name,interest,source,host,created_at\n';
    return new Response(head + leads.map((l) => [l.email, l.name, l.interest, l.source, l.host, l.created_at].map(csvCell).join(',')).join('\n') + '\n', { headers: { 'content-type': 'text/csv' } });
  }
  const sw = source ? 'WHERE source = ?' : '';
  const sa = source ? [source] : [];
  const stats = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            SUM(created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')) AS last7,
            SUM(created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days')) AS last1,
            COUNT(DISTINCT source) AS sources
     FROM leads ${sw}`,
  ).bind(...sa).first();
  const { results: srcRows } = await env.DB.prepare('SELECT DISTINCT source FROM leads ORDER BY source').all();
  return json({
    leads,
    stats: { total: stats.total ?? 0, last7: stats.last7 ?? 0, last1: stats.last1 ?? 0, sources: stats.sources ?? 0 },
    sourceList: srcRows.map((r) => r.source),
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/lead') return await addLead(request, env);
      if (request.method === 'GET' && url.pathname === '/leads') return await listLeads(url, env);
      if (request.method === 'GET' && url.pathname === '/healthz') return json({ ok: true });
      return json({ error: 'not-found' }, 404);
    } catch (e) {
      console.error('leads error', e?.message);
      return json({ error: 'server' }, 500);
    }
  },
};
