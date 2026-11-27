import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createSite, validateContent } from '../src/index.js';
import { esc } from '../src/escape.js';
import { CSS } from '../src/styles.js';

const base = { name: 'Demo', domain: 'demo.com', source: 'demo', status: 'coming-soon', headline: 'Hello', idea: 'An idea.', theme: { accent: '#112233' } };
const fakeLeads = (calls = []) => ({
  fetch: async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('format=csv')) return new Response('email,source\nx@example.com,demo\n');
    if (String(url).includes('/leads')) return new Response(JSON.stringify({ leads: [{ email: '<b>x@example.com</b>', name: null, interest: null, source: 'demo', created_at: '2026-11-26T19:00:00.000Z' }], stats: { total: 1, last7: 1, last1: 1, sources: 1 }, sourceList: ['demo'] }));
    return new Response(JSON.stringify({ ok: true }));
  },
});

test('every app content.json passes the kit contract', () => {
  for (const app of readdirSync('apps')) {
    const f = `apps/${app}/content.json`;
    if (!existsSync(f)) continue;
    assert.deepEqual(validateContent(JSON.parse(readFileSync(f, 'utf8'))), [], f);
  }
});

test('no owner email or other PII is committed in app config (public repo)', () => {
  for (const app of readdirSync('apps')) {
    for (const f of ['content.json', 'wrangler.toml', 'deploy.json']) {
      const p = `apps/${app}/${f}`;
      if (!existsSync(p)) continue;
      // Generic form placeholders (you@example.com, you@company.com) are allowed; real addresses are not.
      const text = readFileSync(p, 'utf8').replace(/\byou@(example|company)\.com\b/g, '');
      assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/, p);
    }
  }
});

test('content validation enforces optional fields, rejects unused theme.ink and literal TODO', () => {
  assert.ok(validateContent({ ...base, todo: true }).length > 0);
  assert.ok(validateContent({ ...base, points: [{ title: 'a', body: 'b' }] }).length > 0);
  assert.ok(validateContent({ ...base, theme: { accent: '#112233', ink: '#000000' } }).some((e) => e.includes('theme.ink')));
  assert.ok(validateContent({ ...base, theme: { accent: '#112233', accentDark: 'blue' } }).some((e) => e.includes('accentDark')));
  assert.ok(validateContent({ ...base, parentUrl: 'javascript:alert(1)' }).some((e) => e.includes('parentUrl')));
  assert.ok(validateContent({ ...base, monogram: 'TOO-LONG' }).some((e) => e.includes('monogram')));
  assert.ok(validateContent({ ...base, headline: 'TODO' }).some((e) => e.includes('TODO')));
  assert.deepEqual(validateContent(base), []);
});

test('escape', () => assert.equal(esc(`<a href="x">'&`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;'));

test('CSS uses Baseline Widely Available rules: no .glow bleed, 100svh, clip-path, forced-colors, GPU pulse', () => {
  assert.match(CSS, /\.glow\{[^}]*inset:-120px 0 auto 0/);
  assert.match(CSS, /min-height:100svh/);
  assert.match(CSS, /clip-path:inset\(50%\)/);
  assert.doesNotMatch(CSS, /clip:rect\(/);
  assert.match(CSS, /@media \(forced-colors:active\)/);
  assert.match(CSS, /\.dot::after\{/);
  assert.match(CSS, /--control-border:/);
});

test('landing renders with CSP nonce, bfcache-safe cache-control, canonical, og:image, skip link, and accessible consent', async () => {
  const site = createSite(base);
  const r = await site.fetch(new Request('https://demo.com/'), { LEADS: fakeLeads(), TURNSTILE_SITE_KEY: 'k' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-cache');
  const csp = r.headers.get('content-security-policy');
  const nonce = /nonce-([^']+)/.exec(csp)[1];
  const body = await r.text();
  assert.match(body, new RegExp(`<style nonce="${nonce.replace(/[+/=]/g, (m) => '\\' + m)}">`));
  assert.match(body, /action="\/api\/lead"/);
  assert.match(body, /href="\/login"/);
  assert.match(body, /class="skip" href="#main"/);
  assert.match(body, /<link rel="canonical" href="https:\/\/demo\.com\/">/);
  assert.match(body, /<meta property="og:image" content="https:\/\/demo\.com\/og\.svg">/);
  assert.match(body, /<label for="consent">/);
  assert.doesNotMatch(body, /<label[^>]*>(?:(?!<\/label>)[\s\S])*?<a\s/, 'no interactive <a> inside <label>');
  assert.doesNotMatch(body, /style="/, 'no inline style attributes (CSP)');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(csp, /frame-ancestors 'none'/);
});

test('SSR error state sets role="alert", aria-live="assertive", and aria-invalid="true"', async () => {
  const site = createSite(base);
  const r = await site.fetch(new Request('https://demo.com/?error=email'), { LEADS: fakeLeads() });
  const body = await r.text();
  assert.match(body, /id="email"[^>]*aria-invalid="true"/);
  assert.match(body, /id="status"[^>]*role="alert"[^>]*aria-live="assertive"/);
});

test('privacy page has noindex, omits canonical, sets explicit og:url, and includes skip link', async () => {
  const site = createSite(base);
  const r = await site.fetch(new Request('https://demo.com/privacy'), {});
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'private, no-cache');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /script-src 'none'/);
  assert.match(csp, /frame-src 'none'/);
  const body = await r.text();
  assert.match(body, /<meta name="robots" content="noindex, nofollow">/);
  assert.doesNotMatch(body, /rel="canonical"/);
  assert.match(body, /<meta property="og:url" content="https:\/\/demo\.com\/privacy">/);
  assert.match(body, /class="skip" href="#main"/);
});

test('form:false hides lead form, omits client script and Turnstile CSP, and rejects POST /api/lead', async () => {
  const site = createSite({ ...base, form: false });
  const r = await site.fetch(new Request('https://demo.com/'), {});
  const body = await r.text();
  assert.doesNotMatch(body, /id="lead"/);
  assert.doesNotMatch(body, /<script/);
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /script-src 'none'/);
  assert.match(csp, /frame-src 'none'/);
  const post = await site.fetch(new Request('https://demo.com/api/lead', { method: 'POST', body: new FormData() }), { LEADS: fakeLeads() });
  assert.equal(post.status, 404);
});

test('non-HTML endpoints include security headers, dark-mode favicon, valid ICO, OG SVG, and HEAD support', async () => {
  const site = createSite({ ...base, theme: { accent: '#112233', accentDark: '#eeeeee', accentInkDark: '#111111' } });
  for (const path of ['/', '/healthz', '/favicon.svg', '/favicon.ico', '/og.svg', '/robots.txt']) {
    const r = await site.fetch(new Request(`https://demo.com${path}`), {});
    assert.equal(r.status, 200, path);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff', path);
    assert.ok(r.headers.get('strict-transport-security'), path);
    const head = await site.fetch(new Request(`https://demo.com${path}`, { method: 'HEAD' }), {});
    assert.equal(head.status, 200, `HEAD ${path}`);
    assert.equal(await head.text(), '', `HEAD ${path} empty body`);
  }
  const svg = await (await site.fetch(new Request('https://demo.com/favicon.svg'), {})).text();
  assert.match(svg, /prefers-color-scheme:dark/);
  const ico = new Uint8Array(await (await site.fetch(new Request('https://demo.com/favicon.ico'), {})).arrayBuffer());
  assert.equal(ico[0], 0); assert.equal(ico[2], 1); assert.equal(ico[4], 1);
  const www = await site.fetch(new Request('https://www.demo.com/privacy'), {});
  assert.equal(www.status, 301);
  assert.equal(www.headers.get('location'), 'https://demo.com/privacy');
});

test('lead POST: server sets source + ip, browser cannot', async () => {
  const calls = [];
  const fd = new FormData();
  fd.set('email', 'Person@Example.com'); fd.set('consent', 'yes'); fd.set('source', 'evil'); fd.set('cf-turnstile-response', 't');
  const r = await createSite(base).fetch(new Request('https://demo.com/api/lead', { method: 'POST', body: fd, headers: { accept: 'application/json', 'cf-connecting-ip': '1.2.3.4' } }), { LEADS: fakeLeads(calls) });
  assert.equal(r.status, 200);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.source, 'demo');
  assert.equal(sent.email, 'person@example.com');
  assert.equal(sent.ip, '1.2.3.4');
});

test('lead POST rejects bad email and missing consent; no-JS gets a 303', async () => {
  const fd = new FormData(); fd.set('email', 'nope');
  const r = await createSite(base).fetch(new Request('https://demo.com/api/lead', { method: 'POST', body: fd }), { LEADS: fakeLeads() });
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location'), /error=email/);
  const fd2 = new FormData(); fd2.set('email', 'a@b.co');
  const r2 = await createSite(base).fetch(new Request('https://demo.com/api/lead', { method: 'POST', body: fd2, headers: { accept: 'application/json' } }), { LEADS: fakeLeads() });
  assert.equal((await r2.json()).error, 'consent');
});

test('private area fails closed on a real hostname without Access config and rejects non-GET/HEAD', async () => {
  const env = { LEADS: fakeLeads(), DEV_ACCESS_EMAIL: 'dev@example.com' };
  const r = await createSite(base).fetch(new Request('https://demo.com/app/leads'), env);
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const r2 = await createSite(base).fetch(new Request('https://demo.com/app/leads', { headers: { 'cf-access-jwt-assertion': 'a.b.c' } }), { ...env, ACCESS_TEAM_DOMAIN: 't.cloudflareaccess.com', ACCESS_AUD: 'x', OWNER_EMAILS: 'o@example.com' });
  assert.equal(r2.status, 403);
  const r3 = await createSite(base).fetch(new Request('https://demo.com/app', { method: 'POST' }), env);
  assert.equal(r3.status, 405);
});

test('dev bypass works only on localhost; leads view escapes data, fixes .nil ARIA, has search submit & hub link; CSV sanitizes Content-Disposition', async () => {
  const site = createSite({ ...base, leadsScope: 'all' });
  const env = { LEADS: fakeLeads(), DEV_ACCESS_EMAIL: 'dev@example.com' };
  const r = await site.fetch(new Request('http://localhost:8787/app/leads'), env);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const body = await r.text();
  assert.match(body, /&lt;b&gt;x@example.com&lt;\/b&gt;/);
  assert.doesNotMatch(body, /<b>x@example.com<\/b>/);
  assert.doesNotMatch(body, /class="nil"[^>]*aria-label/, 'no aria-label on plain <span>');
  assert.match(body, /<button class="btn ghost" type="submit">Search<\/button>/);
  assert.match(body, /href="\/app\/"[^>]*>← Private hub/);
  assert.match(body, /class="skip" href="#main"/);

  const csv = await site.fetch(new Request('http://localhost:8787/app/leads.csv?source=evil%22%0d%0aX-Bad:1'), env);
  assert.equal(csv.status, 200);
  assert.equal(csv.headers.get('content-disposition'), 'attachment; filename="leads-evilX-Bad1.csv"');
  assert.equal(csv.headers.get('x-content-type-options'), 'nosniff');
});

test('accent/ink pairs meet WCAG AA in every app theme', async () => {
  const { contrast } = await import('../src/content.js');
  for (const app of readdirSync('apps')) {
    const p = `apps/${app}/content.json`;
    if (!existsSync(p)) continue;
    const t = JSON.parse(readFileSync(p, 'utf8')).theme || {};
    for (const [bg, fg] of [['accent', 'accentInk'], ['accentDark', 'accentInkDark']]) {
      if (t[bg] && t[fg]) assert.ok(contrast(t[bg], t[fg]) >= 4.5, `${app}: ${fg} on ${bg} = ${contrast(t[bg], t[fg]).toFixed(2)}`);
    }
  }
});
